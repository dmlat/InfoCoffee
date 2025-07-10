// backend/worker/terminal_sync_worker.js
const pool = require('../db');
const axios = require('axios');
const { sendErrorToAdmin } = require('../utils/adminErrorNotifier');
const { decrypt } = require('../utils/security');

const VENDISTA_API_URL = process.env.VENDISTA_API_URL || 'https://api.vendista.ru:99';
const SYNC_DELAY_MS = 1100; // Пауза 1.1 секунды между запросами к API для разных пользователей

// Утилита для создания паузы
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function syncAllTerminals() {
    console.log('[Terminal Sync Worker] Starting synchronization job...');
    // ИСПРАВЛЕНИЕ: Используем pool.pool.connect() для получения клиента
    const client = await pool.pool.connect();
    try {
        // ИСПРАВЛЕНИЕ: Убираем условие "is_active", так как его нет в таблице users.
        const usersRes = await client.query('SELECT id, vendista_api_token FROM users WHERE vendista_api_token IS NOT NULL');

        for (const user of usersRes.rows) {
            try {
                const token = decrypt(user.vendista_api_token);
                if (!token) {
                    console.warn(`[Terminal Sync Worker] Could not decrypt token for user ${user.id}. Skipping.`);
                    continue;
                }

                const vendistaResponse = await axios.get(`${VENDISTA_API_URL}/terminals`, {
                    params: { token, ItemsOnPage: 500 } // Get all terminals in one go
                });

                const vendistaTerminals = vendistaResponse.data.items || [];
                const vendistaTerminalIds = vendistaTerminals.map(t => t.id);

                // Update or insert terminals from Vendista
                for (const terminal of vendistaTerminals) {
                    await client.query(
                        `INSERT INTO terminals (user_id, vendista_terminal_id, name, serial_number, is_active, last_online_time, last_synced_at, is_online)
                         VALUES ($1, $2, $3, $4, true, $5, NOW(), $6)
                         ON CONFLICT (user_id, vendista_terminal_id) DO UPDATE SET
                            name = EXCLUDED.name,
                            serial_number = EXCLUDED.serial_number,
                            is_active = true,
                            last_online_time = EXCLUDED.last_online_time,
                            is_online = EXCLUDED.is_online,
                            last_synced_at = NOW(),
                            updated_at = NOW()
                        `,
                        [
                            user.id, 
                            terminal.id, 
                            terminal.comment, 
                            terminal.serial_number, 
                            terminal.last_online_time, 
                            terminal.last_hour_online > 0
                        ]
                    );
                }

                // Deactivate terminals that are no longer in the Vendista response
                if (vendistaTerminalIds.length > 0) {
                    await client.query(
                        `UPDATE terminals 
                         SET is_active = false, updated_at = NOW() 
                         WHERE user_id = $1 AND NOT (vendista_terminal_id = ANY($2::int[]))`,
                        [user.id, vendistaTerminalIds]
                    );
                } else {
                    // If Vendista returns no terminals, deactivate all for this user
                    await client.query(
                        `UPDATE terminals SET is_active = false, updated_at = NOW() WHERE user_id = $1 AND is_active = true`,
                        [user.id]
                    );
                }
                 console.log(`[Terminal Sync Worker] Successfully synced terminals for user ${user.id}. Found ${vendistaTerminals.length} terminals.`);
            } catch (userSyncError) {
                const errorMessage = userSyncError.response ? JSON.stringify(userSyncError.response.data) : userSyncError.message;
                console.error(`[Terminal Sync Worker] Failed to sync terminals for user ${user.id}:`, errorMessage);
                sendErrorToAdmin({ userId: user.id, errorContext: 'Terminal Sync Worker', errorMessage: errorMessage });
            }
            
            // Пауза после обработки каждого пользователя, чтобы не превысить лимиты API
            await sleep(SYNC_DELAY_MS);
        }
    } catch (e) {
        console.error('[Terminal Sync Worker] Critical error:', e);
        sendErrorToAdmin({ errorContext: 'Terminal Sync Worker - Global', errorMessage: e.message, errorStack: e.stack });
    } finally {
        client.release();
        console.log('[Terminal Sync Worker] Synchronization job finished.');
    }
}

module.exports = { syncAllTerminals }; 