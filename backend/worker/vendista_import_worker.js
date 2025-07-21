// backend/worker/vendista_import_worker.js
const path = require('path');
const axios = require('axios');
const pool = require('../db');
const moment = require('moment-timezone');
const { sendErrorToAdmin } = require('../utils/adminErrorNotifier');
const { sendPriorityNotification } = require('../utils/botNotifier');
const { sendBulkNotifications, getAdminsAndOwner } = require('../utils/botHelpers');

const VENDISTA_API_URL = process.env.VENDISTA_API_BASE_URL || 'https://api.vendista.ru:99';
const WEB_APP_URL = process.env.TELEGRAM_WEB_APP_URL || '';
const MAX_RETRIES = 5;
const INITIAL_RETRY_DELAY_MS = 2000;
// ИЗМЕНЕНО: Увеличиваем задержку между запросами страниц до 1.5 секунд
const PAGE_FETCH_DELAY_MS = 1500;
// Новые константы для batch обработки
const NOTIFICATION_BATCH_SIZE = 10; // Максимум уведомлений в одной группе
const NOTIFICATION_BATCH_DELAY_MS = 2000; // Задержка между группами уведомлений

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function handleVendistaPaymentError(userId, errorMessage) {
    try {
        console.log(`[Import Worker] Handling payment error for user ${userId}: ${errorMessage}`);
        
        // Получаем информацию о пользователе
        const userResult = await pool.query('SELECT telegram_id, first_name, user_name, vendista_payment_status FROM users WHERE id = $1', [userId]);
        if (userResult.rows.length === 0) {
            console.warn(`[Import Worker] User ${userId} not found when handling payment error.`);
            return;
        }

        const user = userResult.rows[0];

        // Если пользователь еще не уведомлен об ошибке оплаты
        if (user.vendista_payment_status === 'active') {
            // Обновляем статус на 'payment_required' и отправляем уведомление
            await pool.query(
                `UPDATE users SET 
                    vendista_payment_status = 'payment_required',
                    vendista_payment_notified_at = NOW(),
                    updated_at = NOW()
                 WHERE id = $1`,
                [userId]
            );

            // Отправляем уведомление администратору ОДИН раз с высоким приоритетом
            await sendErrorToAdmin({
                userId: userId,
                errorContext: `Vendista Payment Required for User ${userId}`,
                errorMessage: `⚠️ ТРЕБУЕТСЯ ОПЛАТА VENDISTA ⚠️\n\nПользователь: ${user.first_name || 'N/A'} (@${user.user_name || 'N/A'})\nTelegram ID: ${user.telegram_id}\nОшибка: ${errorMessage}\n\nИмпорт транзакций будет приостановлен до оплаты услуг Vendista.`,
                errorStack: null
            });

            console.log(`[Import Worker] User ${userId} marked as payment_required. Notification sent.`);
        } else {
            // Если пользователь уже уведомлен, просто логируем
            console.log(`[Import Worker] User ${userId} already marked as payment_required. Skipping notification.`);
        }

    } catch (error) {
        console.error(`[Import Worker] Error handling payment error for user ${userId}:`, error);
    }
}

async function checkAndCreateTasks(ownerUserId, internalTerminalId) {
    const createdTasksInfo = [];
    let ownerTelegramId;

    try {
        // 1. Получаем настройки и текущее состояние терминала
        const settingsRes = await pool.query(
            `SELECT
                s.cleaning_frequency,
                s.assignee_ids_cleaning,
                s.assignee_ids_restock,
                t.sales_since_cleaning,
                t.name as terminal_name,
                u.telegram_id as owner_telegram_id
            FROM terminals t
            LEFT JOIN stand_service_settings s ON t.id = s.terminal_id
            LEFT JOIN users u ON t.user_id = u.id
            WHERE t.id = $1`,
            [internalTerminalId]
        );

        if (settingsRes.rowCount === 0) return;
        
        const settings = settingsRes.rows[0];
        const { cleaning_frequency, assignee_ids_cleaning, assignee_ids_restock, sales_since_cleaning, terminal_name, owner_telegram_id } = settings;
        ownerTelegramId = owner_telegram_id;

        // --- Логика для пополнения (Restock) ---
        if (assignee_ids_restock && assignee_ids_restock.length > 0) {
            const stockRes = await pool.query(
                `SELECT item_name, current_stock, critical_stock FROM inventories 
                 WHERE terminal_id = $1 AND location = 'machine' AND critical_stock IS NOT NULL AND current_stock <= critical_stock`,
                [internalTerminalId]
            );
            
            const itemsToRestock = stockRes.rows.map(r => r.item_name);

            if (itemsToRestock.length > 0) {
                const existingTaskRes = await pool.query(
                    'SELECT id FROM service_tasks WHERE terminal_id = $1 AND task_type = $2 AND status = $3',
                    [internalTerminalId, 'restock', 'pending']
                );

                if (existingTaskRes.rows.length === 0) {
                    const taskRes = await pool.query(
                        `INSERT INTO service_tasks (terminal_id, task_type, assignee_ids, status, created_at, details)
                         VALUES ($1, $2, $3, $4, NOW(), $5) RETURNING id`,
                        [internalTerminalId, 'restock', assignee_ids_restock, 'pending', JSON.stringify({ 
                            terminal_name, 
                            items_to_restock: itemsToRestock,
                            created_by_import: true
                        })]
                    );

                    createdTasksInfo.push({
                        type: 'restock',
                        taskId: taskRes.rows[0].id,
                        assignees: assignee_ids_restock,
                        terminalName: terminal_name,
                        itemsToRestock
                    });
                }
            }
        }

        // --- Логика для уборки (Cleaning) ---
        if (assignee_ids_cleaning && assignee_ids_cleaning.length > 0 && cleaning_frequency && sales_since_cleaning >= cleaning_frequency) {
            const existingCleaningTaskRes = await pool.query(
                'SELECT id FROM service_tasks WHERE terminal_id = $1 AND task_type = $2 AND status = $3',
                [internalTerminalId, 'cleaning', 'pending']
            );

            if (existingCleaningTaskRes.rows.length === 0) {
                const cleaningTaskRes = await pool.query(
                    `INSERT INTO service_tasks (terminal_id, task_type, assignee_ids, status, created_at, details)
                     VALUES ($1, $2, $3, $4, NOW(), $5) RETURNING id`,
                    [internalTerminalId, 'cleaning', assignee_ids_cleaning, 'pending', JSON.stringify({ 
                        terminal_name, 
                        sales_count: sales_since_cleaning,
                        created_by_import: true
                    })]
                );

                createdTasksInfo.push({
                    type: 'cleaning',
                    taskId: cleaningTaskRes.rows[0].id,
                    assignees: assignee_ids_cleaning,
                    terminalName: terminal_name,
                    salesCount: sales_since_cleaning
                });
            }
        }

    } catch (error) {
        console.error(`[Import Worker] Error in checkAndCreateTasks for terminal ${internalTerminalId}:`, error);
        return [];
    }

    // === ОПТИМИЗИРОВАННАЯ ОТПРАВКА УВЕДОМЛЕНИЙ ===
    if (createdTasksInfo.length > 0) {
        await sendTaskNotificationsBatch(createdTasksInfo, ownerUserId, ownerTelegramId);
    }

    return createdTasksInfo;
}

/**
 * Отправляет уведомления о созданных задачах группами для оптимизации
 */
async function sendTaskNotificationsBatch(tasksInfo, ownerUserId, ownerTelegramId) {
    try {
        // Группируем задачи по назначенным пользователям для оптимизации
        const assigneeGroups = new Map();
        
        for (const taskInfo of tasksInfo) {
            for (const assigneeId of taskInfo.assignees) {
                if (!assigneeGroups.has(assigneeId)) {
                    assigneeGroups.set(assigneeId, []);
                }
                assigneeGroups.get(assigneeId).push(taskInfo);
            }
        }

        // Отправляем уведомления назначенным исполнителям по группам
        const assigneeNotifications = [];
        for (const [assigneeId, tasks] of assigneeGroups) {
            let message = '🔔 <b>Новые задачи назначены вам:</b>\n\n';
            
            for (const task of tasks) {
                const taskTypeEmoji = task.type === 'restock' ? '📦' : '🧽';
                const taskTypeName = task.type === 'restock' ? 'Пополнение' : 'Уборка';
                
                message += `${taskTypeEmoji} <b>${taskTypeName}</b> - ${task.terminalName}\n`;
                
                if (task.type === 'restock') {
                    message += `   Требуют пополнения: ${task.itemsToRestock.join(', ')}\n`;
                } else if (task.type === 'cleaning') {
                    message += `   Продано с последней уборки: ${task.salesCount}\n`;
                }
            }
            
            message += `\nОткройте приложение для выполнения задач 👇`;
            
            const keyboard = {
                inline_keyboard: [[
                    { text: '📱 Открыть приложение', web_app: { url: WEB_APP_URL } }
                ]]
            };
            
            assigneeNotifications.push({ telegramId: assigneeId, message, keyboard });
        }

        // Отправляем уведомления исполнителям группами
        await sendNotificationsBatch(assigneeNotifications, false, 'task_assignments');

        // Отправляем информационные уведомления администраторам
        const adminTelegramIds = await getAdminsAndOwner(ownerUserId);
        const uniqueAdminIds = [...new Set(adminTelegramIds)];
        
        if (uniqueAdminIds.length > 0) {
            let adminMessage = '📋 <b>Созданы новые сервисные задачи:</b>\n\n';
            
            for (const taskInfo of tasksInfo) {
                const taskTypeEmoji = taskInfo.type === 'restock' ? '📦' : '🧽';
                const taskTypeName = taskInfo.type === 'restock' ? 'Пополнение' : 'Уборка';
                
                adminMessage += `${taskTypeEmoji} <b>${taskTypeName}</b> - ${taskInfo.terminalName}\n`;
                adminMessage += `   Назначено: ${taskInfo.assignees.length} исполнителя(ей)\n`;
            }
            
            // Отправляем админам простые уведомления без клавиатуры
            await sendBulkNotifications(uniqueAdminIds, adminMessage, null, false, 'admin_task_info');
        }

        console.log(`[Import Worker] Task notifications queued: ${assigneeNotifications.length} to assignees, ${uniqueAdminIds.length} to admins`);

    } catch (error) {
        console.error('[Import Worker] Error sending task notifications:', error);
    }
}

/**
 * Отправляет уведомления группами с контролем rate limiting
 */
async function sendNotificationsBatch(notifications, priority = false, context = 'batch') {
    const { sendBulkNotifications } = require('../utils/botHelpers');
    
    for (let i = 0; i < notifications.length; i += NOTIFICATION_BATCH_SIZE) {
        const batch = notifications.slice(i, i + NOTIFICATION_BATCH_SIZE);
        
        // Отправляем текущую группу
        const promises = batch.map(notification => {
            const { sendNotificationWithKeyboard } = require('../utils/botHelpers');
            return sendNotificationWithKeyboard(
                notification.telegramId, 
                notification.message, 
                notification.keyboard, 
                priority
            );
        });
        
        await Promise.all(promises);
        
        // Задержка между группами если есть еще уведомления
        if (i + NOTIFICATION_BATCH_SIZE < notifications.length) {
            console.log(`[Import Worker] Sent batch ${Math.floor(i / NOTIFICATION_BATCH_SIZE) + 1}, waiting before next batch...`);
            await delay(NOTIFICATION_BATCH_DELAY_MS);
        }
    }
}

async function fetchTransactionPage(vendistaToken, page, dateFrom, dateTo, coffeeShopFilter, maxRetries) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const response = await axios.get(`${VENDISTA_API_URL}/transaction/report`, {
                params: {
                    token: vendistaToken,
                    page,
                    date_from: dateFrom,
                    date_to: dateTo,
                    coffee_shop: coffeeShopFilter || undefined,
                },
                timeout: 30000,
            });

            return response.data;
        } catch (error) {
            console.error(`[Import Worker] Error on page ${page}, attempt ${attempt}:`, error.message);

            if (error.response?.status === 402) {
                throw new Error('VENDISTA_PAYMENT_REQUIRED');
            }

            if (attempt === maxRetries) {
                throw error;
            }

            const backoffDelay = INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt - 1);
            console.log(`[Import Worker] Retrying page ${page} in ${backoffDelay}ms...`);
            await delay(backoffDelay);
        }
    }
}

async function importTransactionsForPeriod({ ownerUserId, vendistaApiToken, appToken, dateFrom, dateTo, fetchAllPages = false }) {
    const logPrefix = `[Import Worker] [User ${ownerUserId}] [${dateFrom} to ${dateTo}]`;
    console.log(`${logPrefix}: Starting transaction import...`);

    // CRITICAL FIX: Assign vendistaApiToken to vendistaToken for use in fetchTransactionPage
    const vendistaToken = vendistaApiToken;

    const results = { processed: 0, added: 0, updated: 0, errors: [] };

    try {
        let currentPage = 1;
        let hasMorePages = true;

        while (hasMorePages) {
            console.log(`${logPrefix}: Fetching page ${currentPage}...`);

            try {
                const resp = await fetchTransactionPage(vendistaToken, currentPage, dateFrom, dateTo, null, MAX_RETRIES);

                if (!resp.items || resp.items.length === 0) {
                    console.log(`${logPrefix}: Page ${currentPage} is empty or no more data.`);
                    break;
                }

                console.log(`${logPrefix}: Processing ${resp.items.length} transactions from page ${currentPage}...`);

                const client = await pool.connect();
                try {
                    await client.query('BEGIN');

                    for (const transaction of resp.items) {
                        try {
                            const existingTransaction = await client.query(
                                'SELECT id FROM transactions WHERE vendista_transaction_id = $1 AND user_id = $2',
                                [transaction.id, ownerUserId]
                            );

                            if (existingTransaction.rows.length === 0) {
                                await client.query(`
                                    INSERT INTO transactions (
                                        user_id, vendista_transaction_id, coffee_shop_id, machine_item_id, 
                                        name, price, payment_method, transaction_time
                                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                                `, [
                                    ownerUserId,
                                    transaction.id,
                                    transaction.coffee_shop_id || null,
                                    transaction.machine_item_id || null,
                                    transaction.name || 'Unknown',
                                    parseFloat(transaction.price) || 0,
                                    transaction.payment_method || 'unknown',
                                    new Date(transaction.date)
                                ]);

                                results.added++;

                                // Увеличиваем счетчик продаж для терминала
                                if (transaction.coffee_shop_id) {
                                    const terminalRes = await client.query(
                                        'SELECT id FROM terminals WHERE vendista_terminal_id = $1 AND user_id = $2',
                                        [transaction.coffee_shop_id, ownerUserId]
                                    );

                                    if (terminalRes.rows.length > 0) {
                                        const terminalId = terminalRes.rows[0].id;
                                        
                                        await client.query(
                                            'UPDATE terminals SET sales_since_cleaning = sales_since_cleaning + 1 WHERE id = $1',
                                            [terminalId]
                                        );

                                        // Списание инвентаря и проверка задач будет после коммита
                                    }
                                }
                            } else {
                                results.updated++;
                            }

                            results.processed++;

                        } catch (transactionError) {
                            console.error(`${logPrefix}: Error processing transaction ${transaction.id}:`, transactionError);
                            results.errors.push(`Transaction ${transaction.id}: ${transactionError.message}`);
                        }
                    }

                    await client.query('COMMIT');
                    console.log(`${logPrefix}: Page ${currentPage} committed to database.`);

                } catch (dbError) {
                    await client.query('ROLLBACK');
                    throw dbError;
                } finally {
                    client.release();
                }

                // Проверяем создание задач для всех терминалов
                const terminalRes = await pool.query(
                    'SELECT id FROM terminals WHERE user_id = $1 AND is_active = true',
                    [ownerUserId]
                );

                for (const terminal of terminalRes.rows) {
                    await checkAndCreateTasks(ownerUserId, terminal.id);
                }

                // Определяем, есть ли еще страницы
                if (!fetchAllPages) {
                    hasMorePages = false;
                } else {
                    hasMorePages = resp.items.length >= 100; // Предполагаем, что полная страница содержит 100 записей
                    currentPage++;

                    if (hasMorePages) {
                        await delay(PAGE_FETCH_DELAY_MS);
                    }
                }

            } catch (pageError) {
                if (pageError.message === 'VENDISTA_PAYMENT_REQUIRED') {
                    await handleVendistaPaymentError(ownerUserId, 'Vendista payment required - HTTP 402 error');
                    throw new Error('Vendista payment required');
                }
                throw pageError;
            }
        }

        console.log(`${logPrefix}: Import completed. Processed: ${results.processed}, Added: ${results.added}, Updated: ${results.updated}`);
        return results;

    } catch (error) {
        console.error(`${logPrefix}: Import failed:`, error.message);
        results.errors.push(`Import failed: ${error.message}`);
        throw error;
    }
}

async function startImport({ ownerUserId, vendistaApiToken, appToken, dateFrom, dateTo }) {
    console.log(`[Import Worker] Starting import for user ${ownerUserId}: ${dateFrom} to ${dateTo}`);
    
    try {
        const result = await importTransactionsForPeriod({
            ownerUserId,
            vendistaApiToken, 
            appToken,
            dateFrom,
            dateTo,
            fetchAllPages: true
        });
        
        console.log(`[Import Worker] Import completed for user ${ownerUserId}:`, result);
        return result;
    } catch (error) {
        console.error(`[Import Worker] Import failed for user ${ownerUserId}:`, error);
        throw error;
    }
}

module.exports = {
    importTransactionsForPeriod,
    startImport,
    checkAndCreateTasks,
    handleVendistaPaymentError,
    // Экспортируем для тестирования
    _internal: {
        sendTaskNotificationsBatch,
        sendNotificationsBatch
    }
};