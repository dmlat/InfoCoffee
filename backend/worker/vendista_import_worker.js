const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const axios = require('axios');
const pool = require('../db');
const moment = require('moment-timezone');

const VENDISTA_API_URL = process.env.VENDISTA_API_BASE_URL || 'https://api.vendista.ru:99';

/**
 * Imports or updates transactions using Vendista API Token.
 * @param {object} params
 * @param {number} params.user_id ID пользователя
 * @param {string} params.vendistaApiToken Vendista API Token (должен быть НЕШИФРОВАННЫМ)
 * @param {string} params.dateFrom Начальная дата импорта (YYYY-MM-DD)
 * @param {string} params.dateTo Конечная дата импорта (YYYY-MM-DD)
 * @param {boolean} [params.fetchAllPages=true]
 */
async function importTransactionsForPeriod({
  user_id,
  vendistaApiToken,
  dateFrom,
  dateTo,
  fetchAllPages = true
}) {
  console.log(`[Worker] User ${user_id}: Запуск импорта с ${dateFrom} по ${dateTo} используя API токен.`);

  if (!vendistaApiToken) {
    console.error(`[Worker] User ${user_id}: Отсутствует Vendista API токен. Импорт прерван.`);
    return { success: false, error: 'Отсутствует Vendista API токен для импорта.' };
  }

  let currentPage = 1;
  const itemsPerPage = 500;
  let transactionsProcessed = 0;
  let newTransactionsAdded = 0;
  let transactionsUpdated = 0;

  const apiDateFrom = `${dateFrom}T00:00:00`;
  const apiDateTo = `${dateTo}T23:59:59`;

  try {
    while (true) {
      console.log(`[Worker] User ${user_id}: Запрос страницы ${currentPage} (с ${apiDateFrom} по ${apiDateTo})`);
      const resp = await axios.get(`${VENDISTA_API_URL}/transactions`, {
        params: {
          token: vendistaApiToken,
          DateFrom: apiDateFrom,
          DateTo: apiDateTo,
          PageNumber: currentPage,
          ItemsOnPage: itemsPerPage
        },
        timeout: 30000 // 30 секунд таймаут
      });

      if (!resp.data.items || resp.data.items.length === 0) {
        console.log(`[Worker] User ${user_id}: Страница ${currentPage} пуста или нет больше данных.`);
        break;
      }

      const transactions = resp.data.items;
      transactionsProcessed += transactions.length;

      for (const tr of transactions) {
        // --- ИСПРАВЛЕНИЕ ДЛЯ machine_item_id ---
        let dbMachineItemId = null;
        if (tr.machine_item && Array.isArray(tr.machine_item) && tr.machine_item.length > 0 && tr.machine_item[0]) {
          if (typeof tr.machine_item[0].machine_item_id !== 'undefined') {
            dbMachineItemId = tr.machine_item[0].machine_item_id;
          }
        }
        // --- КОНЕЦ ИСПРАВЛЕНИЯ ---

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
            user_id = EXCLUDED.user_id, -- Добавлено user_id в UPDATE для полноты
            machine_item_id = EXCLUDED.machine_item_id, // COALESCE здесь не нужен, т.к. EXCLUDED уже будет правильным значением
            last_updated_at = NOW()
          RETURNING xmax;
        `, [
          tr.id, tr.term_id || null, tr.sum || 0, tr.time,
          String(tr.result || '0'), tr.reverse_id || 0, tr.terminal_comment || '',
          tr.card_number || '', String(tr.status || '0'), tr.bonus || 0,
          tr.left_sum || 0, tr.left_bonus || 0, user_id, 
          dbMachineItemId // Используем извлеченное значение
        ]);

        if (result.rows[0].xmax === '0') { // xmax = 0 означает INSERT
            newTransactionsAdded++;
        } else { // иначе UPDATE
            transactionsUpdated++;
        }
      }

      if (!fetchAllPages || transactions.length < itemsPerPage) {
        break; // Выходим, если загрузили не все страницы или это была последняя страница
      }
      currentPage++;
    }
    console.log(`[Worker] User ${user_id}: Импорт с ${dateFrom} по ${dateTo} завершен. Обработано: ${transactionsProcessed}, Добавлено: ${newTransactionsAdded}, Обновлено: ${transactionsUpdated}.`);
    return { success: true, processed: transactionsProcessed, added: newTransactionsAdded, updated: transactionsUpdated };
  } catch (e) {
    console.error(`[Worker] User ${user_id}: Ошибка импорта транзакций с ${dateFrom} по ${dateTo}: ${e.message}`, e.response?.data);
    let errorDetail = `Ошибка импорта: ${e.message}`;
    // Проверяем, содержит ли сообщение об ошибке от API Vendista слово "token" или типичный текст ошибки авторизации
    if (e.response?.status === 401 || (e.response?.data?.error && (e.response.data.error.toLowerCase().includes('token') || e.response.data.error.toLowerCase().includes('авторизаци')))) {
        errorDetail = 'Ошибка токена Vendista. Возможно, он недействителен, истек или был неверно дешифрован.';
    }
    return { success: false, error: errorDetail, processed: transactionsProcessed, added: newTransactionsAdded, updated: transactionsUpdated };
  }
}

async function startImportLegacy({ user_id, vendistaApiToken, first_coffee_date }) {
    console.log(`[Worker] Legacy startImport для User ${user_id} с ${first_coffee_date}, используя API токен.`);
    const dateFrom = moment(first_coffee_date).tz('Europe/Moscow').format('YYYY-MM-DD');
    const dateTo = moment().tz('Europe/Moscow').format('YYYY-MM-DD');
    // vendistaApiToken здесь должен быть уже дешифрован вызывающей стороной (например, import_all.js)
    return importTransactionsForPeriod({ user_id, vendistaApiToken, dateFrom, dateTo, fetchAllPages: true });
}

module.exports = { importTransactionsForPeriod, startImport: startImportLegacy };