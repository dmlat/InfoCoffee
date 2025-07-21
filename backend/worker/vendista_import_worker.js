// backend/worker/vendista_import_worker.js
const path = require('path');
const axios = require('axios');
const { pool } = require('../db');
const moment = require('moment-timezone');
const { sendErrorToAdmin } = require('../utils/adminErrorNotifier');
const { sendPriorityNotification } = require('../utils/botNotifier');
const { sendBulkNotifications, getAdminsAndOwner } = require('../utils/botHelpers');
const { decrypt } = require('../utils/security');
const { getNewVendistaToken, refreshToken } = require('../utils/vendista');

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
        // ИСПРАВЛЕНО: Изменены имена полей согласно DB.txt схеме
        const settingsRes = await pool.query(
            `SELECT
                s.cleaning_frequency,
                s.assignee_id_cleaning,
                s.assignee_id_restock,
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
        // ИСПРАВЛЕНО: Изменены имена переменных согласно БД схеме (единичные поля)
        const { cleaning_frequency, assignee_id_cleaning, assignee_id_restock, sales_since_cleaning, terminal_name, owner_telegram_id } = settings;
        ownerTelegramId = owner_telegram_id;

        // --- Логика для пополнения (Restock) ---
        // ИСПРАВЛЕНО: Проверяем единичное поле, а не массив
        if (assignee_id_restock) {
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
                    // ИСПРАВЛЕНО: Используем assignee_id (единичное поле) вместо assignee_ids
                    const taskRes = await pool.query(
                        `INSERT INTO service_tasks (terminal_id, task_type, assignee_id, status, created_at, details)
                         VALUES ($1, $2, $3, $4, NOW(), $5) RETURNING id`,
                        [internalTerminalId, 'restock', assignee_id_restock, 'pending', JSON.stringify({ 
                            terminal_name, 
                            items_to_restock: itemsToRestock,
                            created_by_import: true
                        })]
                    );

                    createdTasksInfo.push({
                        type: 'restock',
                        taskId: taskRes.rows[0].id,
                        // ИСПРАВЛЕНО: Единичный assignee вместо массива
                        assignee: assignee_id_restock,
                        terminalName: terminal_name,
                        itemsToRestock
                    });
                }
            }
        }

        // --- Логика для уборки (Cleaning) ---
        // ИСПРАВЛЕНО: Проверяем единичное поле, а не массив
        if (assignee_id_cleaning && cleaning_frequency && sales_since_cleaning >= cleaning_frequency) {
            const existingCleaningTaskRes = await pool.query(
                'SELECT id FROM service_tasks WHERE terminal_id = $1 AND task_type = $2 AND status = $3',
                [internalTerminalId, 'cleaning', 'pending']
            );

            if (existingCleaningTaskRes.rows.length === 0) {
                // ИСПРАВЛЕНО: Используем assignee_id (единичное поле) вместо assignee_ids
                const cleaningTaskRes = await pool.query(
                    `INSERT INTO service_tasks (terminal_id, task_type, assignee_id, status, created_at, details)
                     VALUES ($1, $2, $3, $4, NOW(), $5) RETURNING id`,
                    [internalTerminalId, 'cleaning', assignee_id_cleaning, 'pending', JSON.stringify({ 
                        terminal_name, 
                        sales_count: sales_since_cleaning,
                        created_by_import: true
                    })]
                );

                createdTasksInfo.push({
                    type: 'cleaning',
                    taskId: cleaningTaskRes.rows[0].id,
                    // ИСПРАВЛЕНО: Единичный assignee вместо массива
                    assignee: assignee_id_cleaning,
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
            // ИСПРАВЛЕНО: Используем assignee вместо assignee_ids
            if (!assigneeGroups.has(taskInfo.assignee)) {
                assigneeGroups.set(taskInfo.assignee, []);
            }
            assigneeGroups.get(taskInfo.assignee).push(taskInfo);
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
                adminMessage += `   Назначено: ${taskInfo.assignee}\n`;
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

async function fetchTransactionPage(api, page, retries = 2) {
    const requestUrl = `${VENDISTA_API_URL}/transactions`;
    
    // We need to extract the plain token for the request params,
    // but the api object holds the full 'Bearer <token>' header.
    const currentToken = api.defaults.headers.Authorization.split(' ')[1];

    const requestParams = {
        token: currentToken,
        PageNumber: page,
        DateFrom: api.dateFrom,
        DateTo: api.dateTo,
        ItemsOnPage: 500 // Max items per page as per good practice
    };
    
    if (page === 1) {
        console.log(`[Import Worker] Requesting page 1 for user ${api.user_id}`);
    }

    try {
        const response = await axios.get(requestUrl, {
            params: requestParams,
            timeout: 30000,
        });
        return response.data; // Success
    } catch (error) {
        if (!error.response) {
            console.error(`[Import Worker] Network error or timeout for user ${api.user_id} on page ${page}.`, error.message);
            // Throw a generic error to be handled by a potential outer retry mechanism if any
            throw new Error(`Network error for user ${api.user_id}`);
        }

        const status = error.response.status;
        console.error(`[Import Worker] User ${api.user_id} request failed on page ${page} with status ${status}.`);

        if (status === 402) {
            // Payment required is a terminal failure for this user.
            const paymentError = new Error('VENDISTA_PAYMENT_REQUIRED');
            paymentError.userId = api.user_id;
            throw paymentError;
        }

        // For 401 (Unauthorized) or 404 (Not Found), we attempt a token refresh.
        if ((status === 401 || status === 404) && retries > 0) {
            console.log(`[User ${api.user_id}] Token might be expired (status ${status}). Attempting refresh. Retries left: ${retries}`);
            
            // Mark token as expired before attempting refresh
            await pool.query("UPDATE users SET vendista_token_status = 'expired' WHERE id = $1", [api.user_id]);

            const refreshResult = await refreshToken(api.user_id);

            if (refreshResult.success) {
                console.log(`[User ${api.user_id}] Token refreshed successfully. Retrying the request.`);
                // Update the Authorization header in the existing axios instance for the retry
                api.defaults.headers.common['Authorization'] = `Bearer ${refreshResult.token}`;
                return fetchTransactionPage(api, page, retries - 1); // Recursive call with one less retry
            } else {
                console.error(`[User ${api.user_id}] Failed to refresh token. Aborting import for this user. Error: ${refreshResult.error}`);
                // Return a specific structure to indicate a terminal failure for this user.
                return { items: [], error: 'token_refresh_failed' };
            }
        }
        
        // If all retries are exhausted or it's another error code, throw a specific error.
        const vendistaError = new Error(`VENDISTA_${status}: API error after all retries.`);
        vendistaError.userId = api.user_id;
        throw vendistaError;
    }
}

async function importTransactionsForPeriod(user, days, fullHistory = false) {
    const logPrefix = `[Import Worker] [User ${user.id}] [${days} days]`;
    console.log(`${logPrefix}: Starting transaction import...`);

    const plainToken = decrypt(user.vendista_api_token);
    if (!plainToken) {
        console.error(`${logPrefix}: Decryption of Vendista token failed. Skipping user.`);
        await pool.query("UPDATE users SET vendista_token_status = 'invalid_creds' WHERE id = $1", [user.id]);
        return { processed: 0, added: 0, updated: 0, errors: ['Token decryption failed'] };
    }

    const dateTo = moment().tz('Europe/Moscow').format('YYYY-MM-DD');
    const dateFrom = fullHistory 
        ? moment(user.setup_date).format('YYYY-MM-DD')
        : moment().subtract(days, 'days').format('YYYY-MM-DD');

    // Create a dedicated axios instance for this user's import session
    const api = axios.create({
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${plainToken}`,
        },
    });
    // Attach metadata to the instance for use in fetchTransactionPage
    api.user_id = user.id;
    api.dateFrom = dateFrom;
    api.dateTo = dateTo;

    const results = { processed: 0, added: 0, updated: 0, errors: [] };
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        let currentPage = 1;
        let hasMore = true;

        while (hasMore) {
            // ИСПРАВЛЕНИЕ: Передаем созданный 'api' объект, а не undefined
            const response = await fetchTransactionPage(api, currentPage);

            if (response.error === 'token_refresh_failed') {
                console.error(`${logPrefix}: Halting import for user due to token refresh failure.`);
                results.errors.push('Token refresh failed');
                break; // Exit the while loop for this user
            }

            const transactions = response.items;
            const totalPages = response._meta ? response._meta.pageCount : currentPage;

            if (!transactions || transactions.length === 0) {
                hasMore = false;
                continue;
            }
            
            await processTransactions(user.id, transactions, client, results);

            hasMore = currentPage < totalPages;
            currentPage++;

            if (hasMore) {
                await delay(PAGE_FETCH_DELAY_MS);
            }
        }
        
        await client.query('COMMIT');
        console.log(`${logPrefix}: Import completed. Processed: ${results.processed}, Added: ${results.added}, Updated: ${results.updated}`);

    } catch (error) {
        await client.query('ROLLBACK');
        console.error(`${logPrefix}: Import failed with transaction rollback. Error:`, error.message);
        results.errors.push(`Import failed: ${error.message}`);
        
        if (error.message === 'VENDISTA_PAYMENT_REQUIRED' && error.userId) {
             await handleVendistaPaymentError(error.userId, 'Vendista payment required - HTTP 402 error');
        } else {
             await sendErrorToAdmin({
                userId: user.id,
                errorContext: `Vendista Import Worker - User ${user.id}`,
                errorMessage: error.message,
                errorStack: error.stack,
             });
        }
    } finally {
        client.release();
    }
    return results;
}

// A new helper function to isolate the transaction processing logic
async function processTransactions(ownerUserId, transactions, client, results) {
    for (const transaction of transactions) {
        // Use a SAVEPOINT to isolate each transaction's processing
        await client.query('SAVEPOINT process_transaction_sp');
        try {
            // Logic to extract machine_item_id from the nested structure
            let dbMachineItemId = null;
            if (transaction.machine_item && Array.isArray(transaction.machine_item) && transaction.machine_item.length > 0) {
                dbMachineItemId = transaction.machine_item[0]?.machine_item_id;
            }

            // Correctly use ON CONFLICT with the transaction ID from Vendista
            const insertResult = await client.query(`
                INSERT INTO transactions (
                    id, user_id, coffee_shop_id, machine_item_id, amount, transaction_time,
                    result, reverse_id, terminal_comment, status, card_number, bonus, left_sum, left_bonus
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
                ON CONFLICT (id) DO UPDATE SET
                    user_id = EXCLUDED.user_id,
                    coffee_shop_id = EXCLUDED.coffee_shop_id,
                    machine_item_id = EXCLUDED.machine_item_id,
                    amount = EXCLUDED.amount,
                    transaction_time = EXCLUDED.transaction_time,
                    result = EXCLUDED.result,
                    reverse_id = EXCLUDED.reverse_id,
                    terminal_comment = EXCLUDED.terminal_comment,
                    status = EXCLUDED.status,
                    card_number = EXCLUDED.card_number,
                    bonus = EXCLUDED.bonus,
                    left_sum = EXCLUDED.left_sum,
                    left_bonus = EXCLUDED.left_bonus,
                    last_updated_at = NOW()
                RETURNING xmax;
            `, [
                transaction.id, // Primary key from Vendista
                ownerUserId,
                transaction.term_id || null,
                dbMachineItemId,
                transaction.sum || 0,
                new Date(transaction.time),
                String(transaction.result || '0'),
                transaction.reverse_id || 0,
                transaction.terminal_comment || 'Unknown',
                String(transaction.status || '0'),
                transaction.card_number || null,
                transaction.bonus || 0,
                transaction.left_sum || 0,
                transaction.left_bonus || 0
            ]);

            if (insertResult.rows[0].xmax === '0') {
                results.added++;
            } else {
                results.updated++;
            }

            // --- REINSTATED LOGIC: Inventory Update & Task Creation on Sale ---
            const isSale = String(transaction.result) === '1' && (transaction.reverse_id === 0 || transaction.reverse_id === null);
            if (isSale && transaction.term_id && dbMachineItemId) {
                const terminalRes = await client.query(
                    'SELECT id FROM terminals WHERE vendista_terminal_id = $1 AND user_id = $2',
                    [transaction.term_id, ownerUserId]
                );

                if (terminalRes.rows.length > 0) {
                    const internalTerminalId = terminalRes.rows[0].id;
                    
                    // 1. Update sales count
                    await client.query(
                        'UPDATE terminals SET sales_since_cleaning = sales_since_cleaning + 1, sales_since_last_service = sales_since_last_service + 1 WHERE id = $1',
                        [internalTerminalId]
                    );

                    // 2. Deduct ingredients based on recipe
                    const recipeRes = await client.query(
                        `SELECT ri.item_name, ri.quantity FROM recipes r 
                         JOIN recipe_items ri ON r.id = ri.recipe_id 
                         WHERE r.terminal_id = $1 AND r.machine_item_id = $2`,
                        [internalTerminalId, dbMachineItemId]
                    );

                    if (recipeRes.rows.length > 0) {
                        for (const item of recipeRes.rows) {
                            if (item.quantity > 0) {
                                await client.query(
                                    `UPDATE inventories
                                     SET current_stock = GREATEST(0, current_stock - $1), updated_at = NOW()
                                     WHERE terminal_id = $2 AND item_name = $3 AND location = 'machine'`,
                                    [item.quantity, internalTerminalId, item.item_name]
                                );
                            }
                        }
                    }
                    
                    // 3. Check if a new task needs to be created
                    await checkAndCreateTasks(ownerUserId, internalTerminalId);
                }
            }
            // --- END REINSTATED LOGIC ---

            results.processed++;
            await client.query('RELEASE SAVEPOINT process_transaction_sp');
        } catch (transactionError) {
            await client.query('ROLLBACK TO SAVEPOINT process_transaction_sp');
            console.error(`[Import Worker] Error processing transaction ID (from Vendista): ${transaction.id}. Rolled back.`, transactionError);
            results.errors.push(`Transaction ${transaction.id}: ${transactionError.message}`);
        }
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