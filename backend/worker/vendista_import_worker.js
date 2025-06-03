// backend/worker/vendista_import_worker.js
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const axios = require('axios');
const pool = require('../db');
const moment = require('moment-timezone');
const { sendErrorToAdmin } = require('../utils/adminErrorNotifier'); // Импорт уведомителя

const VENDISTA_API_URL = process.env.VENDISTA_API_BASE_URL || 'https://api.vendista.ru:99';
const MAX_RETRIES = 5; // Максимальное количество повторных попыток
const INITIAL_RETRY_DELAY_MS = 2000; // Начальная задержка перед повтором (2 секунды)
const PAGE_FETCH_DELAY_MS = 750; // Задержка между запросами страниц (0.75 секунды)

// Утилита для задержки
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function importTransactionsForPeriod({
  user_id,
  vendistaApiToken,
  dateFrom, // YYYY-MM-DD
  dateTo,   // YYYY-MM-DD
  fetchAllPages = true
}) {
  const logPrefix = `[Worker] User ${user_id} (Period: ${dateFrom} to ${dateTo})`;
  console.log(`${logPrefix}: Запуск импорта.`);

  if (!vendistaApiToken) {
    const errorMsg = 'Отсутствует Vendista API токен для импорта.';
    console.error(`${logPrefix}: ${errorMsg}`);
    await sendErrorToAdmin({ userId: user_id, errorContext: `Import Setup ${logPrefix}`, errorMessage: errorMsg });
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
          timeout: 45000 // Увеличен таймаут до 45 секунд
        });

        retries = 0; // Сброс счетчика попыток при успешном запросе

        if (!resp.data.items || resp.data.items.length === 0) {
          console.log(`${logPrefix}: Страница ${currentPage} пуста или нет больше данных.`);
          break;
        }

        const transactions = resp.data.items;
        transactionsProcessed += transactions.length;

        for (const tr of transactions) {
          let dbMachineItemId = null;
          if (tr.machine_item && Array.isArray(tr.machine_item) && tr.machine_item.length > 0 && tr.machine_item[0]) {
            if (typeof tr.machine_item[0].machine_item_id !== 'undefined') {
              dbMachineItemId = tr.machine_item[0].machine_item_id;
            }
          }

          const result = await pool.query(`
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
            RETURNING xmax;
          `, [
            tr.id, tr.term_id || null, tr.sum || 0, tr.time,
            String(tr.result || '0'), tr.reverse_id || 0, tr.terminal_comment || '',
            tr.card_number || '', String(tr.status || '0'), tr.bonus || 0,
            tr.left_sum || 0, tr.left_bonus || 0, user_id, 
            dbMachineItemId
          ]);

          if (result.rows[0].xmax === '0') {
              newTransactionsAdded++;
          } else {
              transactionsUpdated++;
          }
        }
        
        console.log(`${logPrefix}: Страница ${currentPage} обработана. Всего: ${transactionsProcessed}, Новых: ${newTransactionsAdded}, Обновлено: ${transactionsUpdated}.`);

        if (!fetchAllPages || transactions.length < itemsPerPage) {
          break; // Выход, если это не полный импорт или если данных на странице меньше, чем запрашивали
        }
        currentPage++;
        await delay(PAGE_FETCH_DELAY_MS); // Задержка перед запросом следующей страницы

      } catch (pageError) {
        if (pageError.response && pageError.response.status === 429 && retries < MAX_RETRIES) {
          retries++;
          let retryAfterDelay = INITIAL_RETRY_DELAY_MS * Math.pow(2, retries -1); // Exponential backoff
          retryAfterDelay += Math.random() * 1000; // Jitter
          
          const retryAfterHeader = pageError.response.headers['retry-after'];
          if (retryAfterHeader) {
            const secondsToWait = parseInt(retryAfterHeader, 10);
            if (!isNaN(secondsToWait) && secondsToWait > 0) {
              retryAfterDelay = Math.max(retryAfterDelay, secondsToWait * 1000);
            }
          }
          console.warn(`${logPrefix}: Ошибка 429 (Rate Limit) на странице ${currentPage}. Попытка ${retries}/${MAX_RETRIES} через ${Math.round(retryAfterDelay/1000)}с. Сообщение: ${pageError.response.data?.error || pageError.message}`);
          await sendErrorToAdmin({ 
            userId: user_id, 
            errorContext: `Rate Limit ${logPrefix}, Page ${currentPage}`, 
            errorMessage: `Vendista API 429: ${pageError.response.data?.error || pageError.message}`,
            additionalInfo: { retryAttempt: retries, delayMs: retryAfterDelay }
          });
          await delay(retryAfterDelay);
          continue; // Повторяем текущую страницу
        }
        // Если другая ошибка или превышены попытки retry для 429
        throw pageError; // Перебрасываем ошибку выше для общей обработки
      }
    }
    console.log(`${logPrefix}: Импорт успешно завершен. Обработано: ${transactionsProcessed}, Добавлено: ${newTransactionsAdded}, Обновлено: ${transactionsUpdated}.`);
    return { success: true, processed: transactionsProcessed, added: newTransactionsAdded, updated: transactionsUpdated };

  } catch (e) {
    const errorMsg = `Общая ошибка импорта транзакций: ${e.message}`;
    console.error(`${logPrefix}: ${errorMsg}`, e.response?.data || e.stack);
    await sendErrorToAdmin({
        userId: user_id,
        errorContext: `Critical Import Error ${logPrefix}`,
        errorMessage: e.message,
        errorStack: e.stack,
        additionalInfo: e.response?.data
    });
    return { success: false, error: errorMsg, processed: transactionsProcessed, added: newTransactionsAdded, updated: transactionsUpdated };
  }
}

async function startImport({ user_id, vendistaApiToken, first_coffee_date }) { // Переименовал для ясности, что это оригинальная функция
    console.log(`[Worker] startImport для User ${user_id} с ${first_coffee_date}, используя API токен.`);
    const dateFrom = moment(first_coffee_date).tz('Europe/Moscow').format('YYYY-MM-DD');
    const dateTo = moment().tz('Europe/Moscow').format('YYYY-MM-DD'); // Всегда до текущего дня для полного исторического
    return importTransactionsForPeriod({ user_id, vendistaApiToken, dateFrom, dateTo, fetchAllPages: true });
}

module.exports = { importTransactionsForPeriod, startImport };