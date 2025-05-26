// backend/worker/vendista_import_worker.js
const axios = require('axios');
const pool = require('../db'); // Используем pool из db.js
const moment = require('moment-timezone');

/**
 * Импортирует или обновляет транзакции для пользователя за указанный диапазон дат.
 * @param {object} params
 * @param {number} params.user_id ID пользователя
 * @param {string} params.vendistaLogin Логин Vendista
 * @param {string} params.vendistaPass Пароль Vendista
 * @param {string} params.dateFrom Начальная дата импорта (YYYY-MM-DD)
 * @param {string} params.dateTo Конечная дата импорта (YYYY-MM-DD)
 * @param {boolean} [params.fetchAllPages=true] Флаг, нужно ли проходить по всем страницам (для больших диапазонов)
 */
async function importTransactionsForPeriod({
  user_id,
  vendistaLogin,
  vendistaPass,
  dateFrom, // Ожидаем YYYY-MM-DD
  dateTo,   // Ожидаем YYYY-MM-DD
  fetchAllPages = true // По умолчанию стараемся забрать все
}) {
  console.log(`[Worker] User ${user_id}: Запуск импорта с ${dateFrom} по ${dateTo}`);
  let token;
  try {
    const tokenResp = await axios.get('https://api.vendista.ru:99/token', {
      params: { login: vendistaLogin, password: vendistaPass },
      timeout: 10000 // Таймаут для получения токена
    });
    token = tokenResp.data.token;
    if (!token) {
      console.error(`[Worker] User ${user_id}: Не удалось получить токен Vendista.`);
      return { success: false, error: 'Не удалось получить токен Vendista' };
    }
  } catch (e) {
    console.error(`[Worker] User ${user_id}: Ошибка при получении токена Vendista: ${e.message}`);
    return { success: false, error: `Ошибка токена Vendista: ${e.message}` };
  }

  let currentPage = 1;
  const itemsPerPage = 500; // Vendista API может иметь лимит, уточни его (100-1000 обычно)
  let transactionsProcessed = 0;
  let newTransactionsAdded = 0;
  let transactionsUpdated = 0;

  // Преобразуем даты в нужный формат для API Vendista (с временем)
  const apiDateFrom = `${dateFrom}T00:00:00`;
  const apiDateTo = `${dateTo}T23:59:59`;

  try {
    while (true) {
      console.log(`[Worker] User ${user_id}: Запрос страницы ${currentPage} (с ${apiDateFrom} по ${apiDateTo})`);
      const resp = await axios.get('https://api.vendista.ru:99/transactions', {
        params: {
          token,
          DateFrom: apiDateFrom,
          DateTo: apiDateTo,
          PageNumber: currentPage,
          ItemsOnPage: itemsPerPage
        },
        timeout: 30000 // Таймаут для запроса транзакций
      });

      if (!resp.data.items || resp.data.items.length === 0) {
        console.log(`[Worker] User ${user_id}: Страница ${currentPage} пуста или нет больше данных.`);
        break; // Нет больше транзакций на этой или последующих страницах
      }

      const transactions = resp.data.items;
      transactionsProcessed += transactions.length;

      for (const tr of transactions) {
        // Предполагаем, что tr.machine_item_id может приходить от API
        // Если его нет, оно будет null или undefined, что нормально для SQL
        const result = await pool.query(`
          INSERT INTO transactions (
            id, coffee_shop_id, amount, transaction_time, result, 
            reverse_id, terminal_comment, card_number, status, bonus, 
            left_sum, left_bonus, user_id, machine_item_id
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14
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
            -- Обновляем machine_item_id только если новое значение не NULL (или по твоей логике)
            -- Чтобы случайно не затереть уже имеющееся значение на NULL, если оно пришло позже
            machine_item_id = COALESCE(EXCLUDED.machine_item_id, transactions.machine_item_id),
            -- user_id не обновляем, он по user_id из WHERE в ON CONFLICT неявно
            -- Другие поля можно добавить по аналогии
            last_updated_at = NOW() -- Добавим поле для отслеживания обновлений (нужно добавить в таблицу)
          RETURNING xmax; -- xmax = 0 для INSERT, не 0 для UPDATE
        `, [
          tr.id, // ID от Vendista как первичный ключ
          tr.term_id || null,
          tr.sum || 0,
          tr.time, // Предполагается, что это корректный TIMESTAMP формат
          String(tr.result || '0'), // Приводим к строке, если result в БД VARCHAR
          tr.reverse_id || 0,
          tr.terminal_comment || '',
          tr.card_number || '',
          String(tr.status || '0'), // Приводим к строке, если status в БД VARCHAR
          tr.bonus || 0,
          tr.left_sum || 0,
          tr.left_bonus || 0,
          user_id,
          tr.machine_item_id || null // Поле для machine_item_id
        ]);

        if (result.rows[0].xmax === '0') {
            newTransactionsAdded++;
        } else {
            transactionsUpdated++;
        }
      }

      if (!fetchAllPages || transactions.length < itemsPerPage) {
        // Если не нужно получать все страницы или если текущая страница не полная, значит, это последняя
        break;
      }
      currentPage++;
    }
    console.log(`[Worker] User ${user_id}: Импорт с ${dateFrom} по ${dateTo} завершен. Обработано: ${transactionsProcessed}, Добавлено: ${newTransactionsAdded}, Обновлено: ${transactionsUpdated}.`);
    return { success: true, processed: transactionsProcessed, added: newTransactionsAdded, updated: transactionsUpdated };
  } catch (e) {
    console.error(`[Worker] User ${user_id}: Ошибка импорта транзакций с ${dateFrom} по ${dateTo}: ${e.message}`, e.response?.data);
    return { success: false, error: `Ошибка импорта: ${e.message}` };
  }
}

// Старая функция startImport, которую использовал auth.js, может быть оберткой
// или ее логика должна быть перенесена в новый планировщик.
// Для обратной совместимости с твоим auth.js и import_all.js, сделаем обертку.
async function startImportLegacy({ user_id, vendistaLogin, vendistaPass, first_coffee_date }) {
    console.log(`[Worker] Legacy startImport для User ${user_id} с ${first_coffee_date}`);
    const dateFrom = moment(first_coffee_date).tz('Europe/Moscow').format('YYYY-MM-DD');
    const dateTo = moment().tz('Europe/Moscow').format('YYYY-MM-DD'); // До сегодняшнего дня
    // При первой регистрации импортируем все страницы
    return importTransactionsForPeriod({ user_id, vendistaLogin, vendistaPass, dateFrom, dateTo, fetchAllPages: true });
}


module.exports = { importTransactionsForPeriod, startImport: startImportLegacy };