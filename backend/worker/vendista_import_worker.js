// backend/worker/vendista_import_worker.js
const path = require('path');
const envPath = process.env.NODE_ENV === 'development' ? '.env.development' : '.env';
require('dotenv').config({ path: path.resolve(__dirname, `../${envPath}`) });
const axios = require('axios');
const pool = require('../db');
const moment = require('moment-timezone');
const { sendErrorToAdmin } = require('../utils/adminErrorNotifier');
const { sendNotification } = require('../utils/botNotifier'); // <-- НОВЫЙ ИМПОРТ
const { sendNotificationWithKeyboard } = require('../utils/botHelpers'); // <-- НОВЫЙ ИМПОРТ

const VENDISTA_API_URL = process.env.VENDISTA_API_BASE_URL || 'https://api.vendista.ru:99';
const MAX_RETRIES = 5;
const INITIAL_RETRY_DELAY_MS = 2000;
// ИЗМЕНЕНО: Увеличиваем задержку между запросами страниц до 1.5 секунд
const PAGE_FETCH_DELAY_MS = 1500; 

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// Функция для получения всех админов и владельца
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
    return [...new Set(adminIds)]; // Возвращаем уникальные ID
}

// НОВАЯ ФУНКЦИЯ для проверки остатков и создания задачи
async function checkStockAndCreateTask(ownerUserId, internalTerminalId, updatedItems, client) {
    if (!updatedItems || updatedItems.length === 0) return;

    try {
        const settingsRes = await client.query(
            `SELECT cleaning_frequency, restock_thresholds, assignee_ids FROM stand_service_settings WHERE terminal_id = $1`,
            [internalTerminalId]
        );
        // Если настроек для терминала нет, задачи не создаем
        if (settingsRes.rowCount === 0 || !settingsRes.rows[0].assignee_ids || settingsRes.rows[0].assignee_ids.length === 0) {
            return;
        }
        const { restock_thresholds, assignee_ids } = settingsRes.rows[0];

        // Получаем текущие остатки и крит. значения для измененных товаров
        const itemNames = updatedItems.map(i => i.item_name);
        const stockRes = await client.query(
            `SELECT item_name, current_stock, critical_stock FROM inventories WHERE terminal_id = $1 AND item_name = ANY($2::text[]) AND location = 'machine' AND critical_stock IS NOT NULL`,
            [internalTerminalId, itemNames]
        );

        let itemsToRestock = [];
        for (const stockItem of stockRes.rows) {
            // Проверяем, нужно ли пополнять
            if (stockItem.current_stock > 0 && stockItem.critical_stock > 0 && stockItem.current_stock <= stockItem.critical_stock * 2) {
                itemsToRestock.push(stockItem.item_name);
            }
        }
        
        if (itemsToRestock.length === 0) return;

        // Проверяем, есть ли уже активная задача на пополнение для этой стойки
        const existingTaskRes = await client.query(
            `SELECT id FROM service_tasks WHERE terminal_id = $1 AND task_type = 'restock' AND status = 'pending'`,
            [internalTerminalId]
        );

        if (existingTaskRes.rowCount > 0) {
            // Уже есть активная задача, ничего не делаем
            return;
        }

        // --- Создаем задачу ---
        const terminalDetails = await client.query('SELECT name FROM terminals WHERE id = $1', [internalTerminalId]);
        const terminalName = terminalDetails.rows[0]?.name || `Терминал #${internalTerminalId}`;

        const taskDetails = { items: itemsToRestock.join(', ') };
        const insertRes = await client.query(
            `INSERT INTO service_tasks (terminal_id, owner_user_id, task_type, status, details, assignee_ids)
             VALUES ($1, $2, 'restock', 'pending', $3, $4) RETURNING id`,
            [internalTerminalId, ownerUserId, JSON.stringify(taskDetails), assignee_ids]
        );
        const newTaskId = insertRes.rows[0].id;
        console.log(`[Worker] User ${ownerUserId} - Created restock task #${newTaskId} for terminal ${terminalName}`);

        // --- Отправляем уведомления ---
        // 1. Исполнителям
        const assigneeMessage = `<b>Новая задача: Пополнение</b>\n\nСтойка: <b>${terminalName}</b>\nТребуется пополнить: ${taskDetails.items}`;
        const keyboard = {
            inline_keyboard: [[{ text: '✅ Выполнено', callback_data: `task_complete_${newTaskId}` }]]
        };
        for (const telegramId of assignee_ids) {
            sendNotificationWithKeyboard(telegramId, assigneeMessage, keyboard).catch(console.error);
        }

        // 2. Владельцу и админам
        const adminIds = await getAdminsAndOwner(ownerUserId, client);
        const assigneesInfo = await client.query('SELECT name FROM users WHERE telegram_id = ANY($1::bigint[])', [assignee_ids]);
        const assigneeNames = assigneesInfo.rows.map(r => r.name).join(', ');
        
        const adminMessage = `ℹ️ Поставлена задача на пополнение стойки "<b>${terminalName}</b>".\n\nНазначены: ${assigneeNames || 'не указаны'}`;
        for (const adminId of adminIds) {
            // Не отправляем дубликат, если админ и есть исполнитель
            if (!assignee_ids.includes(adminId)) {
                sendNotification(adminId, adminMessage).catch(console.error);
            }
        }
    } catch (e) {
        console.error(`[Worker] User ${ownerUserId} - Failed to check stock and create task for terminal ${internalTerminalId}:`, e.message);
        sendErrorToAdmin({
            userId: ownerUserId,
            errorContext: `Check Stock & Create Task for Terminal ${internalTerminalId}`,
            errorMessage: e.message
        }).catch(console.error);
    }
}


// ФУНКЦИЯ для обработки транзакций (продаж и возвратов)
async function processInventoryUpdate(ownerUserId, transaction, client) {
    if (!transaction.term_id || !transaction.machine_item_id) {
        return; // Нечего обрабатывать
    }
    
    // Определяем, продажа это или возврат
    const isSale = String(transaction.result) === '1' && transaction.reverse_id === 0;
    const isRefund = String(transaction.result) !== '1' && transaction.reverse_id > 0;
    
    if (!isSale && !isRefund) {
        return; // Нас интересуют только продажи и возвраты
    }

    const operation = isSale ? -1 : 1; // -1 для списания, +1 для возврата
    const logPrefix = isSale ? 'Sale' : 'Refund';

    try {
        const terminalRes = await client.query(
            'SELECT id FROM terminals WHERE user_id = $1 AND vendista_terminal_id = $2',
            [ownerUserId, transaction.term_id]
        );
        if (terminalRes.rowCount === 0) return; // Терминал не найден
        const internalTerminalId = terminalRes.rows[0].id;

        const recipeRes = await client.query(
            'SELECT ri.item_name, ri.quantity FROM recipes r JOIN recipe_items ri ON r.id = ri.recipe_id WHERE r.terminal_id = $1 AND r.machine_item_id = $2',
            [internalTerminalId, transaction.machine_item_id]
        );
        if (recipeRes.rowCount === 0) return; // Рецепт не найден

        for (const item of recipeRes.rows) {
            if (item.quantity > 0) {
                const quantityChange = item.quantity * operation;
                await client.query(
                    `UPDATE inventories
                     SET current_stock = current_stock + $1, updated_at = NOW()
                     WHERE terminal_id = $2 AND item_name = $3 AND location = 'machine'`,
                    [quantityChange, internalTerminalId, item.item_name]
                );
            }
        }
        
        // --- ВЫЗОВ НОВОЙ ФУНКЦИИ ---
        // Проверяем остатки только после списания (продажи)
        if (isSale) {
            await checkStockAndCreateTask(ownerUserId, internalTerminalId, recipeRes.rows, client);
        }

        console.log(`[Worker] User ${ownerUserId} - Processed inventory for Tx ${transaction.id} (${logPrefix})`);
    } catch (e) {
        console.error(`[Worker] User ${ownerUserId} - Failed to process inventory for Tx ${transaction.id}:`, e.message);
        // Ошибку не пробрасываем, чтобы не остановить весь импорт
        sendErrorToAdmin({
            userId: ownerUserId,
            errorContext: `Process Inventory for Tx ${transaction.id}`,
            errorMessage: e.message
        }).catch(console.error);
    }
}


async function importTransactionsForPeriod({
  ownerUserId, // <-- ИЗМЕНЕНИЕ
  vendistaApiToken,
  dateFrom,
  dateTo,
  fetchAllPages = true
}) {
  const logPrefix = `[Worker] User ${ownerUserId} (Period: ${dateFrom} to ${dateTo})`;
  console.log(`${logPrefix}: Запуск импорта.`);

  if (!vendistaApiToken) {
    const errorMsg = 'Отсутствует Vendista API токен для импорта.';
    console.error(`${logPrefix}: ${errorMsg}`);
    await sendErrorToAdmin({ userId: ownerUserId, errorContext: `Import Setup ${logPrefix}`, errorMessage: errorMsg });
    return { success: false, error: errorMsg };
  }

  let currentPage = 1;
  const itemsPerPage = 500;
  let transactionsProcessed = 0;
  let newTransactionsAdded = 0;
  let transactionsUpdated = 0;
  let retries = 0;

  const apiDateFrom = `${dateFrom}T00:00:00`;
  const apiDateTo = `${dateTo}T23:59:59`;

  try {
    while (true) {
      console.log(`${logPrefix}: Запрос страницы ${currentPage} (Retries: ${retries})`);
      try {
        const resp = await axios.get(`${VENDISTA_API_URL}/transactions`, {
          params: {
            token: vendistaApiToken,
            DateFrom: apiDateFrom,
            DateTo: apiDateTo,
            PageNumber: currentPage,
            ItemsOnPage: itemsPerPage
          },
          timeout: 45000
        });

        retries = 0;

        if (!resp.data.items || resp.data.items.length === 0) {
          console.log(`${logPrefix}: Страница ${currentPage} пуста или нет больше данных.`);
          break;
        }

        const transactions = resp.data.items;
        transactionsProcessed += transactions.length;

        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            for (const tr of transactions) {
                let dbMachineItemId = null;
                if (tr.machine_item && Array.isArray(tr.machine_item) && tr.machine_item.length > 0 && tr.machine_item[0]) {
                    if (typeof tr.machine_item[0].machine_item_id !== 'undefined') {
                        dbMachineItemId = tr.machine_item[0].machine_item_id;
                    }
                }
    
                const result = await client.query(`
                    INSERT INTO transactions (
                        id, coffee_shop_id, amount, transaction_time, result, 
                        reverse_id, terminal_comment, card_number, status, bonus, 
                        left_sum, left_bonus, user_id, machine_item_id, last_updated_at
                    ) VALUES (
                        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW()
                    )
                    ON CONFLICT (id) DO UPDATE SET
                        coffee_shop_id = EXCLUDED.coffee_shop_id,
                        amount = EXCLUDED.amount,
                        transaction_time = EXCLUDED.transaction_time,
                        result = EXCLUDED.result,
                        reverse_id = EXCLUDED.reverse_id,
                        terminal_comment = EXCLUDED.terminal_comment,
                        card_number = EXCLUDED.card_number,
                        status = EXCLUDED.status,
                        bonus = EXCLUDED.bonus,
                        left_sum = EXCLUDED.left_sum,
                        left_bonus = EXCLUDED.left_bonus,
                        user_id = EXCLUDED.user_id,
                        machine_item_id = EXCLUDED.machine_item_id,
                        last_updated_at = NOW()
                    RETURNING xmax, (SELECT status FROM transactions WHERE id = $1) as old_status;
                `, [
                    tr.id, tr.term_id || null, tr.sum || 0, tr.time,
                    String(tr.result || '0'), tr.reverse_id || 0, tr.terminal_comment || '',
                    tr.card_number || '', String(tr.status || '0'), tr.bonus || 0,
                    tr.left_sum || 0, tr.left_bonus || 0, ownerUserId, 
                    dbMachineItemId
                ]);
              
                const isNew = result.rows[0].xmax === '0';
                const oldStatus = result.rows[0].old_status;

                // Обрабатываем инвентарь если это новая транзакция, или если статус изменился
                // (например, была продажа, а стал возврат)
                if (isNew || oldStatus !== String(tr.status)) {
                    await processInventoryUpdate(ownerUserId, tr, client);
                }
    
                if (isNew) {
                    newTransactionsAdded++;
                } else {
                    transactionsUpdated++;
                }
            }
            await client.query('COMMIT');
        } finally {
            client.release();
        }
        
        console.log(`${logPrefix}: Страница ${currentPage} обработана. Всего: ${transactionsProcessed}, Новых: ${newTransactionsAdded}, Обновлено: ${transactionsUpdated}.`);

        if (!fetchAllPages || transactions.length < itemsPerPage) {
          break;
        }
        currentPage++;
        await delay(PAGE_FETCH_DELAY_MS);

      } catch (pageError) {
        if (pageError.response && pageError.response.status === 429 && retries < MAX_RETRIES) {
          retries++;
          let retryAfterDelay = INITIAL_RETRY_DELAY_MS * Math.pow(2, retries -1);
          retryAfterDelay += Math.random() * 1000; 
          
          const retryAfterHeader = pageError.response.headers['retry-after'];
          if (retryAfterHeader) {
            const secondsToWait = parseInt(retryAfterHeader, 10);
            if (!isNaN(secondsToWait) && secondsToWait > 0) {
              retryAfterDelay = Math.max(retryAfterDelay, secondsToWait * 1000);
            }
          }
          console.warn(`${logPrefix}: Ошибка 429 (Rate Limit) на странице ${currentPage}. Попытка ${retries}/${MAX_RETRIES} через ${Math.round(retryAfterDelay/1000)}с.`);
          await sendErrorToAdmin({ 
            userId: ownerUserId, 
            errorContext: `Rate Limit ${logPrefix}, Page ${currentPage}`, 
            errorMessage: `Vendista API 429: ${pageError.response.data?.error || pageError.message}`,
            additionalInfo: { retryAttempt: retries, delayMs: retryAfterDelay }
          });
          await delay(retryAfterDelay);
          continue;
        }
        throw pageError;
      }
    }
    console.log(`${logPrefix}: Импорт успешно завершен. Обработано: ${transactionsProcessed}, Добавлено: ${newTransactionsAdded}, Обновлено: ${transactionsUpdated}.`);
    return { success: true, processed: transactionsProcessed, added: newTransactionsAdded, updated: transactionsUpdated };

  } catch (e) {
    const errorMsg = `Общая ошибка импорта транзакций: ${e.message}`;
    console.error(`${logPrefix}: ${errorMsg}`, e.response?.data || e.stack);
    await sendErrorToAdmin({
        userId: ownerUserId,
        errorContext: `Critical Import Error ${logPrefix}`,
        errorMessage: e.message,
        errorStack: e.stack,
        additionalInfo: e.response?.data
    });
    return { success: false, error: errorMsg, processed: transactionsProcessed, added: newTransactionsAdded, updated: transactionsUpdated };
  }
}

async function startImport({ user_id, vendistaApiToken, first_coffee_date }) {
    console.log(`[Worker] startImport для User ${user_id} с ${first_coffee_date}.`);
    const dateFrom = moment(first_coffee_date).tz('Europe/Moscow').format('YYYY-MM-DD');
    const dateTo = moment().tz('Europe/Moscow').format('YYYY-MM-DD');
    return importTransactionsForPeriod({ ownerUserId: user_id, vendistaApiToken, dateFrom, dateTo, fetchAllPages: true });
}

module.exports = { importTransactionsForPeriod, startImport, processInventoryUpdate, checkStockAndCreateTask };