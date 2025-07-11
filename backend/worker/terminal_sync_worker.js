// backend/worker/terminal_sync_worker.js
const { pool } = require('../db');
const axios = require('axios');
const { sendErrorToAdmin } = require('../utils/adminErrorNotifier');
const { decrypt } = require('../utils/security');

const VENDISTA_API_URL = process.env.VENDISTA_API_URL || 'https://api.vendista.ru:99';
const SYNC_DELAY_MS = 1100; // Пауза 1.1 секунды между запросами к API для разных пользователей

// Утилита для создания паузы
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function syncTerminalsForUser(userId, plainVendistaToken) {
    console.log(`[Terminal Sync] Starting terminal sync for user ${userId}...`);
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        const vendistaResponse = await axios.get(`${VENDISTA_API_URL}/terminals`, {
            params: { token: plainVendistaToken, ItemsOnPage: 500 }
        });

        const vendistaTerminals = vendistaResponse.data.items || [];
        const vendistaTerminalIds = vendistaTerminals.map(t => t.id);

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
                    userId, 
                    terminal.id, 
                    terminal.comment, 
                    terminal.serial_number, 
                    terminal.last_online_time, 
                    terminal.last_hour_online > 0
                ]
            );
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

        await client.query('COMMIT');
        console.log(`[Terminal Sync] Successfully synced terminals for user ${userId}. Found ${vendistaTerminals.length} terminals.`);
        return { success: true, count: vendistaTerminals.length };

    } catch (error) {
        await client.query('ROLLBACK');
        const errorMessage = error.response ? JSON.stringify(error.response.data) : error.message;
        console.error(`[Terminal Sync] Failed to sync terminals for user ${userId}:`, errorMessage);
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
        const usersRes = await client.query('SELECT id, vendista_api_token FROM users WHERE vendista_api_token IS NOT NULL');

        for (const user of usersRes.rows) {
            try {
                const token = decrypt(user.vendista_api_token);
                if (!token) {
                    console.warn(`[Terminal Sync Worker] Could not decrypt token for user ${user.id}. Skipping.`);
                    continue;
                }
                
                // Используем новую функцию для конкретного пользователя
                await syncTerminalsForUser(user.id, token);

            } catch (userSyncError) {
                const errorMessage = userSyncError.message;
                console.error(`[Terminal Sync Worker] Failed to sync terminals for user ${user.id}:`, errorMessage);
                sendErrorToAdmin({ userId: user.id, errorContext: 'Terminal Sync Worker Loop', errorMessage: errorMessage });
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

module.exports = { syncAllTerminals, syncTerminalsForUser }; 