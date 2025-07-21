// backend/worker/inventory_notifier_worker.js
require('dotenv').config({ path: __dirname + '/../.env' });
const { pool } = require('../db');
const { getAdminsAndOwner } = require('../utils/botHelpers');
const { sendNotification } = require('../utils/botNotifier');

const BATCH_SIZE = 100; // Обрабатывать по 100 записей за раз для контроля нагрузки

async function processInventoryChanges() {
    console.log('[Worker/InventoryNotifier] Starting inventory change notification process...');
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // 1. Выбрать ID необработанных логов и заблокировать их
        const logsToProcessRes = await client.query(
            `SELECT id FROM inventory_change_log 
             WHERE is_notified = false 
             ORDER BY change_timestamp ASC 
             LIMIT $1 FOR UPDATE SKIP LOCKED`,
            [BATCH_SIZE]
        );

        if (logsToProcessRes.rows.length === 0) {
            console.log('[Worker/InventoryNotifier] No new inventory changes to notify.');
            await client.query('COMMIT');
            return;
        }

        const logIds = logsToProcessRes.rows.map(r => r.id);

        // 2. Получить полную информацию по выбранным логам
        const fullLogsRes = await client.query(
            `SELECT 
                l.id, l.owner_user_id, l.changed_by_telegram_id, l.item_name,
                l.quantity_before, l.quantity_after, l.terminal_id, t.name as terminal_name,
                COALESCE(uar.shared_with_name, u.first_name, u.user_name) as changer_name
             FROM inventory_change_log l
             LEFT JOIN terminals t ON l.terminal_id = t.id
             LEFT JOIN user_access_rights uar ON l.changed_by_telegram_id = uar.shared_with_telegram_id AND l.owner_user_id = uar.owner_user_id
             LEFT JOIN users u ON l.changed_by_telegram_id = u.telegram_id AND l.owner_user_id = u.id
             WHERE l.id = ANY($1::int[])`,
            [logIds]
        );
        
        // 3. Сгруппировать по владельцу и исполнителю
        const groupedLogs = fullLogsRes.rows.reduce((acc, log) => {
            const key = `${log.owner_user_id}_${log.changed_by_telegram_id}`;
            if (!acc[key]) {
                acc[key] = {
                    owner_user_id: log.owner_user_id,
                    changer_name: log.changer_name || `ID: ${log.changed_by_telegram_id}`,
                    changes: []
                };
            }
            acc[key].changes.push(log);
            return acc;
        }, {});

        // 4. Сформировать и отправить уведомления
        for (const groupKey in groupedLogs) {
            const group = groupedLogs[groupKey];
            let message = `👤 <b>${group.changer_name}</b> внёс изменения в остатки:\n\n`;

            group.changes.forEach(change => {
                const diff = parseFloat(change.quantity_after) - parseFloat(change.quantity_before);
                const sign = diff > 0 ? '+' : '';
                const location = change.terminal_name ? `(Стойка: ${change.terminal_name})` : '(Склад)';
                message += `• <b>${change.item_name}</b>: ${sign}${diff.toLocaleString()} ${location}\n`;
            });

            const recipients = await getAdminsAndOwner(group.owner_user_id);
            for (const recipientId of recipients) {
                try {
                    await sendNotification(recipientId, message);
                } catch (sendError) {
                    console.error(`[Worker/InventoryNotifier] Failed to send notification to ${recipientId} for owner ${group.owner_user_id}`, sendError);
                }
            }
        }

        // 5. Пометить логи как обработанные
        await client.query(
            `UPDATE inventory_change_log SET is_notified = true WHERE id = ANY($1::int[])`,
            [logIds]
        );

        console.log(`[Worker/InventoryNotifier] Successfully processed and sent notifications for ${logIds.length} log entries.`);
        await client.query('COMMIT');

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('[Worker/InventoryNotifier] Error during inventory change notification process:', error);
    } finally {
        client.release();
    }
}

// Для ручного запуска
if (require.main === module) {
    processInventoryChanges().then(() => {
        console.log('Manual run of InventoryNotifier finished.');
        pool.end();
    }).catch(err => {
        console.error('Manual run of InventoryNotifier failed:', err);
        pool.end();
    });
}

module.exports = { processInventoryChanges }; 