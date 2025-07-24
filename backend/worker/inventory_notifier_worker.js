// backend/worker/inventory_notifier_worker.js

// Конфигурация загружается централизованно в app.js
// require('dotenv').config({ path: __dirname + '/../.env' }); 

const { pool } = require('../db');
const { getAdminsAndOwner } = require('../utils/botHelpers');
const { queueMessage } = require('../utils/botQueue');

const BATCH_SIZE = 100; // Обрабатывать по 100 записей за раз для контроля нагрузки
const TELEGRAM_MESSAGE_LIMIT = 4096;

/**
 * Разделяет длинное сообщение на части, не превышающие лимит Telegram.
 * @param {string[]} lines - Массив строк для объединения.
 * @param {string} header - Заголовок, который будет добавлен в начало каждого сообщения.
 * @returns {string[]} - Массив сообщений (чанков).
 */
function splitMessage(lines, header) {
    const chunks = [];
    let currentChunk = header;

    for (const line of lines) {
        if (currentChunk.length + line.length + 1 > TELEGRAM_MESSAGE_LIMIT) {
            chunks.push(currentChunk);
            currentChunk = header + line;
        } else {
            currentChunk += '\n' + line;
        }
    }
    chunks.push(currentChunk);
    return chunks;
}

async function processInventoryChanges() {
    console.log('[Worker/InventoryNotifier] Starting inventory change notification process...');
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const logsToProcessRes = await client.query(
            `SELECT id FROM inventory_change_log 
             WHERE is_notified = false 
             ORDER BY change_timestamp ASC 
             LIMIT $1 FOR UPDATE SKIP LOCKED`,
            [BATCH_SIZE]
        );

        if (logsToProcessRes.rows.length === 0) {
            await client.query('COMMIT');
            return;
        }

        const logIds = logsToProcessRes.rows.map(r => r.id);

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
        
        const groupedByOwner = fullLogsRes.rows.reduce((acc, log) => {
            if (!acc[log.owner_user_id]) {
                acc[log.owner_user_id] = {};
            }
            const changerKey = log.changed_by_telegram_id;
            if (!acc[log.owner_user_id][changerKey]) {
                acc[log.owner_user_id][changerKey] = {
                    changer_name: log.changer_name || `ID: ${log.changed_by_telegram_id}`,
                    changes: []
                };
            }
            acc[log.owner_user_id][changerKey].changes.push(log);
            return acc;
        }, {});

        for (const ownerId in groupedByOwner) {
            for (const changerId in groupedByOwner[ownerId]) {
                const group = groupedByOwner[ownerId][changerId];
                
                const aggregatedChanges = group.changes.reduce((acc, change) => {
                    const locationKey = change.terminal_id === null 
                        ? 'warehouse' 
                        : `stand:${change.terminal_id}:${change.terminal_name || 'Unknown Stand'}`;
                    
                    if (!acc[locationKey]) acc[locationKey] = {};
                    
                    const diff = parseFloat(change.quantity_after) - parseFloat(change.quantity_before);
                    if (!acc[locationKey][change.item_name]) acc[locationKey][change.item_name] = 0;
                    acc[locationKey][change.item_name] += diff;

                    return acc;
                }, {});

                const messageLines = [];
                // 1. Склад
                if (aggregatedChanges.warehouse) {
                    messageLines.push('<b>📦 Склад</b>');
                    for (const [item, total] of Object.entries(aggregatedChanges.warehouse)) {
                        if (total === 0) continue;
                        const sign = total > 0 ? '+' : '';
                        messageLines.push(`• ${item}: ${sign}${total.toLocaleString('ru-RU')}`);
                    }
                    messageLines.push(''); // Пустая строка для отступа
                }

                // 2. Стойки
                const standKeys = Object.keys(aggregatedChanges).filter(k => k.startsWith('stand:'));
                if (standKeys.length > 0) {
                     messageLines.push('<b>☕️ Стойки</b>');
                     standKeys.forEach(key => {
                        const [, , standName] = key.split(':');
                        messageLines.push(`\n<b>${standName}</b>`);
                        for (const [item, total] of Object.entries(aggregatedChanges[key])) {
                            if (total === 0) continue;
                            const sign = total > 0 ? '+' : '';
                            messageLines.push(`• ${item}: ${sign}${total.toLocaleString('ru-RU')}`);
                        }
                    });
                }

                if (messageLines.length === 0) continue;

                const header = `👤 <b>${group.changer_name}</b> внёс изменения в остатки:\n`;
                const messageChunks = splitMessage(messageLines, header);
                
                const recipients = await getAdminsAndOwner(ownerId);
                const finalRecipients = new Set();

                if (process.env.NODE_ENV === 'development') {
                    const ownerDevId = process.env.DEV_OWNER_TELEGRAM_ID;
                    console.log(`[Worker/InventoryNotifier] DEV MODE: Rerouting all notifications to OWNER (${ownerDevId})`);
                    finalRecipients.add(ownerDevId);
                } else {
                    recipients.forEach(id => finalRecipients.add(id.toString()));
                }

                for (const recipientId of finalRecipients) {
                    for (const chunk of messageChunks) {
                         await queueMessage(recipientId, chunk, { parse_mode: 'HTML' }, false, 'inventory_change');
                    }
                }
            }
        }

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