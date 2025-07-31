// backend/worker/terminal_sync_worker.js
const { pool } = require('../db');
const axios = require('axios');
const { sendErrorToAdmin } = require('../utils/adminErrorNotifier');
const { decrypt } = require('../utils/security');

const VENDISTA_API_URL = process.env.VENDISTA_API_URL || 'https://api.vendista.ru:99';
const SYNC_DELAY_MS = 1100; // Пауза 1.1 секунды между запросами к API для разных пользователей

const DEFAULT_MACHINE_INVENTORY = [
    { item_name: 'Кофе', max_stock: 1500, critical_stock: 500 },
    { item_name: 'Вода', max_stock: 38000, critical_stock: 10000 },
    { item_name: 'Сливки', max_stock: 2000, critical_stock: 300 },
    { item_name: 'Какао', max_stock: 2000, critical_stock: 300 },
    { item_name: 'Раф', max_stock: 2000, critical_stock: 300 },
    { item_name: 'Стаканы', max_stock: 100, critical_stock: 30 },
    { item_name: 'Крышки', max_stock: 100, critical_stock: 30 },
    { item_name: 'Размешиватели', max_stock: 100, critical_stock: 30 },
    { item_name: 'Сахар', max_stock: 100, critical_stock: 30 },
    { item_name: 'Трубочки', max_stock: 250, critical_stock: 50 },
    { item_name: 'Сироп 1', max_stock: 1500, critical_stock: 500 },
    { item_name: 'Сироп 2', max_stock: 1500, critical_stock: 500 },
    { item_name: 'Сироп 3', max_stock: 1500, critical_stock: 500 },
];

async function addDefaultInventories(client, userId, terminalId) {
    console.log(`[Terminal Sync] Adding default inventories for new terminal ${terminalId} for user ${userId}`);
    for (const item of DEFAULT_MACHINE_INVENTORY) {
        await client.query(
            `INSERT INTO inventories (user_id, terminal_id, item_name, location, max_stock, critical_stock)
             VALUES ($1, $2, $3, 'machine', $4, $5)
             ON CONFLICT (user_id, terminal_id, item_name, location) DO NOTHING`,
            [userId, terminalId, item.item_name, item.max_stock, item.critical_stock]
        );
    }
}

// Утилита для создания паузы
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Функция для обработки ошибки оплаты Vendista
async function handleVendistaPaymentError(userId, errorMessage) {
    const client = await pool.connect();
    try {
        // Проверяем текущий статус пользователя
        const userResult = await client.query(
            `SELECT vendista_payment_status, vendista_payment_notified_at, telegram_id, first_name, user_name 
             FROM users WHERE id = $1`,
            [userId]
        );

        if (userResult.rows.length === 0) {
            console.warn(`[Terminal Sync] User ${userId} not found in database`);
            return;
        }

        const user = userResult.rows[0];
        const now = new Date();

        // Если пользователь еще не уведомлен об ошибке оплаты
        if (user.vendista_payment_status === 'active') {
            // Обновляем статус на 'payment_required' и отправляем уведомление
            await client.query(
                `UPDATE users SET 
                    vendista_payment_status = 'payment_required',
                    vendista_payment_notified_at = NOW(),
                    updated_at = NOW()
                 WHERE id = $1`,
                [userId]
            );

            // Отправляем уведомление администратору ОДИН раз
            await sendErrorToAdmin({
                userId: userId,
                errorContext: `Vendista Payment Required for User ${userId}`,
                errorMessage: `⚠️ ТРЕБУЕТСЯ ОПЛАТА VENDISTA ⚠️\n\nПользователь: ${user.first_name || 'N/A'} (@${user.user_name || 'N/A'})\nTelegram ID: ${user.telegram_id}\nОшибка: ${errorMessage}\n\nСинхронизация данных будет приостановлена до оплаты услуг Vendista.`,
                errorStack: null
            });

            console.log(`[Terminal Sync] User ${userId} marked as payment_required. Notification sent.`);
        } else {
            // Если пользователь уже уведомлен, просто логируем
        }

    } catch (error) {
        console.error(`[Terminal Sync] Error handling payment error for user ${userId}:`, error);
    } finally {
        client.release();
    }
}

async function syncTerminalsForUser(userId, plainVendistaToken) {
    console.log(`[Terminal Sync] Starting terminal sync for user ${userId}...`);
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        const vendistaResponse = await axios.get(`${VENDISTA_API_URL}/terminals`, {
            params: { token: plainVendistaToken, ItemsOnPage: 1000 }
        });

        const vendistaTerminals = vendistaResponse.data.items || [];
        const vendistaTerminalIds = vendistaTerminals.map(t => t.id);

        for (const terminal of vendistaTerminals) {
            const existingTerminal = await client.query(
                'SELECT id FROM terminals WHERE user_id = $1 AND vendista_terminal_id = $2',
                [userId, terminal.id]
            );

            if (existingTerminal.rows.length === 0) {
                // Новый терминал
                const newTerminalRes = await client.query(
                    `INSERT INTO terminals (user_id, vendista_terminal_id, name, serial_number, is_active, last_online_time, last_synced_at, is_online)
                     VALUES ($1, $2, $3, $4, true, $5, NOW(), $6)
                     RETURNING id`,
                    [
                        userId, 
                        terminal.id, 
                        terminal.comment, 
                        terminal.serial_number, 
                        terminal.last_online_time, 
                        terminal.last_hour_online > 0
                    ]
                );
                const newInternalId = newTerminalRes.rows[0].id;
                await addDefaultInventories(client, userId, newInternalId);
            } else {
                // Существующий терминал
                await client.query(
                    `UPDATE terminals SET
                        name = $1,
                        serial_number = $2,
                        is_active = true,
                        last_online_time = $3,
                        is_online = $4,
                        last_synced_at = NOW(),
                        updated_at = NOW()
                     WHERE user_id = $5 AND vendista_terminal_id = $6`,
                    [
                        terminal.comment, 
                        terminal.serial_number, 
                        terminal.last_online_time, 
                        terminal.last_hour_online > 0,
                        userId,
                        terminal.id
                    ]
                );
            }
        }

        if (vendistaTerminalIds.length > 0) {
            await client.query(
                `UPDATE terminals 
                 SET is_active = false, updated_at = NOW() 
                 WHERE user_id = $1 AND NOT (vendista_terminal_id = ANY($2::int[]))`,
                [userId, vendistaTerminalIds]
            );
        } else {
            await client.query(
                `UPDATE terminals SET is_active = false, updated_at = NOW() WHERE user_id = $1 AND is_active = true`,
                [userId]
            );
        }

        // Если синхронизация прошла успешно, сбрасываем статус оплаты на active
        await client.query(
            `UPDATE users SET 
                vendista_payment_status = 'active', 
                vendista_payment_notified_at = NULL,
                updated_at = NOW()
             WHERE id = $1 AND vendista_payment_status != 'active'`,
            [userId]
        );

        await client.query('COMMIT');
        console.log(`[Terminal Sync] Successfully synced terminals for user ${userId}. Found ${vendistaTerminals.length} terminals.`);
        return { success: true, count: vendistaTerminals.length };

    } catch (error) {
        await client.query('ROLLBACK');
        const errorMessage = error.response ? JSON.stringify(error.response.data) : error.message;
        console.error(`[Terminal Sync] Failed to sync terminals for user ${userId}:`, errorMessage);
        
        // Специальная обработка ошибки 402 "Требуется оплата"
        if (error.response && error.response.status === 402) {
            await handleVendistaPaymentError(userId, errorMessage);
            return { success: false, error: errorMessage, paymentRequired: true };
        }

        sendErrorToAdmin({ userId: userId, errorContext: `Terminal Sync for User ${userId}`, errorMessage: errorMessage, errorStack: error.stack });
        return { success: false, error: errorMessage };
    } finally {
        client.release();
    }
}


async function syncAllTerminals() {
    console.log('[Terminal Sync Worker] Starting synchronization job...');
    const client = await pool.connect();
    try {
        // Получаем только пользователей с активным статусом оплаты
        const usersRes = await client.query(`
            SELECT id, vendista_api_token, vendista_payment_status, first_name, user_name 
            FROM users 
            WHERE vendista_api_token IS NOT NULL
        `);

        let activeUsers = 0;
        let skippedUsers = 0;

        for (const user of usersRes.rows) {
            // Пропускаем пользователей с неоплаченным статусом
            if (user.vendista_payment_status === 'payment_required') {
                console.log(`[Terminal Sync Worker] Skipping user ${user.id} (${user.first_name || 'N/A'}) - payment required`);
                skippedUsers++;
                continue;
            }

            try {
                const token = decrypt(user.vendista_api_token);
                if (!token) {
                    console.warn(`[Terminal Sync Worker] Could not decrypt token for user ${user.id}. Skipping.`);
                    continue;
                }
                
                // Используем новую функцию для конкретного пользователя
                const result = await syncTerminalsForUser(user.id, token);
                
                if (result.success) {
                    activeUsers++;
                } else if (result.paymentRequired) {
                    skippedUsers++;
                }

            } catch (userSyncError) {
                const errorMessage = userSyncError.message;
                console.error(`[Terminal Sync Worker] Failed to sync terminals for user ${user.id}:`, errorMessage);
                sendErrorToAdmin({ userId: user.id, errorContext: 'Terminal Sync Worker Loop', errorMessage: errorMessage });
            }
            
            // Пауза после обработки каждого пользователя, чтобы не превысить лимиты API
            await sleep(SYNC_DELAY_MS);
        }

        console.log(`[Terminal Sync Worker] Processed ${activeUsers} active users, skipped ${skippedUsers} users with payment issues`);
    } catch (e) {
        console.error('[Terminal Sync Worker] Critical error:', e);
        sendErrorToAdmin({ errorContext: 'Terminal Sync Worker - Global', errorMessage: e.message, errorStack: e.stack });
    } finally {
        client.release();
        console.log('[Terminal Sync Worker] Synchronization job finished.');
    }
}

module.exports = { syncAllTerminals, syncTerminalsForUser }; 