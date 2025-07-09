// backend/worker/cleaning_task_worker.js
const path = require('path');
const envPath = process.env.NODE_ENV === 'development' ? '.env.development' : '.env';
require('dotenv').config({ path: path.resolve(__dirname, `../${envPath}`) });

const pool = require('../db');
const moment = require('moment-timezone');
const { sendErrorToAdmin } = require('../utils/adminErrorNotifier');
const { sendNotification } = require('../utils/botNotifier');
const { sendNotificationWithKeyboard } = require('../utils/botHelpers');

// Функция для получения всех админов и владельца (дублируется для автономности воркера)
async function getAdminsAndOwner(ownerUserId, client) {
    const adminRes = await client.query(
        `SELECT shared_with_telegram_id FROM user_access_rights WHERE owner_user_id = $1 AND access_level = 'admin'`,
        [ownerUserId]
    );
    const ownerRes = await client.query('SELECT telegram_id FROM users WHERE id = $1', [ownerUserId]);
    
    const adminIds = adminRes.rows.map(r => r.shared_with_telegram_id);
    if (ownerRes.rowCount > 0) {
        adminIds.push(ownerRes.rows[0].telegram_id);
    }
    return [...new Set(adminIds)];
}


async function createCleaningTasks() {
    console.log('[Cleaning Worker] Starting job to create cleaning tasks...');
    const client = await pool.connect();

    try {
        const yesterday = moment().tz('Europe/Moscow').subtract(1, 'days');
        const dateFrom = yesterday.startOf('day').toISOString();
        const dateTo = yesterday.endOf('day').toISOString();

        // 1. Получаем все настройки, где указана частота чистки
        const settingsRes = await client.query(
            `SELECT terminal_id, owner_user_id, cleaning_frequency, assignee_ids 
             FROM stand_service_settings 
             WHERE cleaning_frequency IS NOT NULL AND cleaning_frequency > 0 AND assignee_ids IS NOT NULL AND array_length(assignee_ids, 1) > 0`
        );
        if (settingsRes.rowCount === 0) {
            console.log('[Cleaning Worker] No terminals with cleaning settings found. Exiting.');
            return;
        }

        const settings = settingsRes.rows;

        // 2. Для каждого терминала считаем кол-во успешных продаж за вчера
        for (const setting of settings) {
            const { terminal_id, owner_user_id, cleaning_frequency, assignee_ids } = setting;

            const terminal = await client.query('SELECT vendista_terminal_id, name FROM terminals WHERE id = $1', [terminal_id]);
            if (terminal.rowCount === 0) continue;
            
            const vendistaTerminalId = terminal.rows[0].vendista_terminal_id;
            const terminalName = terminal.rows[0].name;

            const salesCountRes = await client.query(
                `SELECT COUNT(*) as count FROM transactions 
                 WHERE user_id = $1 AND coffee_shop_id = $2 AND result = '1' AND reverse_id = 0 AND transaction_time BETWEEN $3 AND $4`,
                [owner_user_id, vendistaTerminalId, dateFrom, dateTo]
            );

            const salesCount = parseInt(salesCountRes.rows[0].count, 10);
            
            console.log(`[Cleaning Worker] Terminal "${terminalName}" (ID: ${terminal_id}) had ${salesCount} sales. Threshold is ${cleaning_frequency}.`);

            // 3. Если кол-во продаж >= порога, создаем задачу
            if (salesCount >= cleaning_frequency) {
                // Проверяем, нет ли уже активной задачи на чистку
                const existingTask = await client.query(
                    `SELECT id FROM service_tasks WHERE terminal_id = $1 AND task_type = 'cleaning' AND status = 'pending'`,
                    [terminal_id]
                );

                if (existingTask.rowCount === 0) {
                    const insertRes = await client.query(
                        `INSERT INTO service_tasks (terminal_id, owner_user_id, task_type, status, assignee_ids, details)
                         VALUES ($1, $2, 'cleaning', 'pending', $3, $4) RETURNING id`,
                        [terminal_id, owner_user_id, assignee_ids, JSON.stringify({ salesCount })]
                    );
                    const newTaskId = insertRes.rows[0].id;
                    console.log(`[Cleaning Worker] CREATED cleaning task #${newTaskId} for "${terminalName}".`);
                    
                    // --- Отправляем уведомления ---
                    // 1. Исполнителям
                    const assigneeMessage = `<b>Новая задача: Чистка</b>\n\nСтойка: <b>${terminalName}</b>\n(Плановая чистка по достижению ${salesCount} продаж)`;
                    const keyboard = {
                        inline_keyboard: [[{ text: '✅ Выполнено', callback_data: `task_complete_${newTaskId}` }]]
                    };
                    for (const telegramId of assignee_ids) {
                        sendNotificationWithKeyboard(telegramId, assigneeMessage, keyboard).catch(console.error);
                    }

                    // 2. Владельцу и админам
                    const adminIds = await getAdminsAndOwner(owner_user_id, client);
                    const assigneesInfo = await client.query('SELECT name FROM users WHERE telegram_id = ANY($1::bigint[])', [assignee_ids]);
                    const assigneeNames = assigneesInfo.rows.map(r => r.name).join(', ');

                    const adminMessage = `ℹ️ Поставлена задача на чистку стойки "<b>${terminalName}</b>".\n\nНазначены: ${assigneeNames || 'не указаны'}`;
                    for (const adminId of adminIds) {
                        if (!assignee_ids.includes(adminId)) {
                            sendNotification(adminId, adminMessage).catch(console.error);
                        }
                    }

                } else {
                    console.log(`[Cleaning Worker] SKIPPED task creation for "${terminalName}", active task already exists.`);
                }
            }
        }

        console.log('[Cleaning Worker] Job finished.');

    } catch (err) {
        console.error('[Cleaning Worker] CRITICAL ERROR:', err);
        sendErrorToAdmin({
            errorContext: 'createCleaningTasks Worker',
            errorMessage: err.message,
            errorStack: err.stack,
        }).catch(console.error);
    } finally {
        client.release();
    }
}

// Если файл запущен напрямую, выполнить задачу
if (require.main === module) {
    createCleaningTasks().then(() => {
        console.log('Manual run of cleaning worker completed.');
        process.exit(0);
    }).catch(err => {
        console.error('Manual run of cleaning worker failed:', err);
        process.exit(1);
    });
}

module.exports = { createCleaningTasks }; 