const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const cron = require('node-cron');
const pool = require('../db');
const { importTransactionsForPeriod } = require('./vendista_import_worker');
const moment = require('moment-timezone');
const crypto = require('crypto'); // Добавлено для дешифрования

const TIMEZONE = 'Europe/Moscow';
const importingUsers = new Set();

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;
const ALGORITHM = 'aes-256-cbc';
const IV_LENGTH = 16;

if (!ENCRYPTION_KEY) {
    console.error("[FATAL ERROR in schedule_imports.js] ENCRYPTION_KEY is not defined in .env file. Worker cannot decrypt tokens.");
    process.exit(1); // Завершаем работу, если ключ шифрования отсутствует
}

// Функция дешифрования (аналогична той, что в auth.js)
function decrypt(text) {
    if (!ENCRYPTION_KEY) { // Дополнительная проверка, хотя уже есть глобальная
        console.error('ENCRYPTION_KEY is not set. Cannot decrypt.');
        throw new Error('Encryption key not set for decrypt function.');
    }
    if (!text || typeof text !== 'string' || !text.includes(':')) {
        console.error('Invalid text format for decryption:', text);
        return null;
    }
    try {
        const key = Buffer.from(ENCRYPTION_KEY, 'hex');
        const textParts = text.split(':');
        const iv = Buffer.from(textParts.shift(), 'hex');
        const encryptedText = Buffer.from(textParts.join(':'), 'hex');
        const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
        let decrypted = decipher.update(encryptedText);
        decrypted = Buffer.concat([decrypted, decipher.final()]);
        return decrypted.toString('utf8');
    } catch (error) {
        console.error('Decryption failed:', error);
        return null;
    }
}

async function logJobStatus(userId, jobName, status, result, errorMessage = null) {
  try {
    await pool.query(`
      INSERT INTO worker_logs (user_id, job_name, last_run_at, status, processed_items, added_items, updated_items, error_message)
      VALUES ($1, $2, NOW(), $3, $4, $5, $6, $7)
    `, [
      userId, jobName, status,
      result?.processed || 0, result?.added || 0, result?.updated || 0,
      errorMessage
    ]);
  } catch (logErr) {
    console.error(`[Cron ${moment().tz(TIMEZONE).format()}] [${jobName}] Ошибка записи лога для User ${userId}: ${logErr.message}`);
  }
}

async function scheduleSafeImport(params, jobName) { // params should include plain vendistaApiToken
  if (importingUsers.has(params.user_id)) {
    const message = `Пропуск для User ${params.user_id}: предыдущий импорт еще не завершен.`;
    console.log(`[Cron ${moment().tz(TIMEZONE).format()}] [${jobName}] ${message}`);
    await logJobStatus(params.user_id, jobName, 'skipped_due_to_lock', null, message);
    return;
  }

  importingUsers.add(params.user_id);
  console.log(`[Cron ${moment().tz(TIMEZONE).format()}] [${jobName}] Запуск для User ${params.user_id} с ${params.dateFrom} по ${params.dateTo}`);
  let importResult;
  try {
    // `params.vendistaApiToken` здесь уже должен быть дешифрован
    importResult = await importTransactionsForPeriod(params);
    if (importResult.success) {
      await logJobStatus(params.user_id, jobName, 'success', importResult);
    } else {
      await logJobStatus(params.user_id, jobName, 'failure', importResult, importResult.error);
       if (importResult.error && importResult.error.toLowerCase().includes('token')) {
            console.error(`[Cron ${moment().tz(TIMEZONE).format()}] [${jobName}] User ${params.user_id} Vendista token might be invalid (after decryption).`);
       }
    }
  } catch (e) {
    console.error(`[Cron ${moment().tz(TIMEZONE).format()}] [${jobName}] Ошибка для User ${params.user_id}: ${e.message}`);
    await logJobStatus(params.user_id, jobName, 'failure', null, e.message);
  } finally {
    importingUsers.delete(params.user_id);
    console.log(`[Cron ${moment().tz(TIMEZONE).format()}] [${jobName}] Завершение для User ${params.user_id}`);
  }
}

async function runScheduledJob(jobName, dateSubtractArgs, fetchAllPages) {
  console.log(`[Cron ${moment().tz(TIMEZONE).format()}] Запуск ${jobName}...`);
  try {
    const usersRes = await pool.query('SELECT id, vendista_api_token FROM users WHERE vendista_api_token IS NOT NULL');
    if (usersRes.rows.length === 0) {
      console.log(`[Cron ${moment().tz(TIMEZONE).format()}] [${jobName}] Нет пользователей для импорта.`);
      return;
    }

    const dateTo = moment().tz(TIMEZONE).format('YYYY-MM-DD');
    const dateFrom = moment().tz(TIMEZONE).subtract(...dateSubtractArgs).format('YYYY-MM-DD');

    for (const user of usersRes.rows) {
      const encryptedToken = user.vendista_api_token;
      let plainVendistaToken;

      if (!encryptedToken) {
          console.warn(`[Cron ${moment().tz(TIMEZONE).format()}] [${jobName}] User ${user.id} не имеет vendista_api_token. Пропуск.`);
          await logJobStatus(user.id, jobName, 'skipped_no_token', null, 'User has no vendista_api_token in DB');
          continue;
      }

      try {
        plainVendistaToken = decrypt(encryptedToken);
        if (!plainVendistaToken) {
            console.error(`[Cron ${moment().tz(TIMEZONE).format()}] [${jobName}] Не удалось дешифровать токен для User ${user.id}. Пропуск.`);
            await logJobStatus(user.id, jobName, 'failure', null, 'Token decryption failed');
            continue;
        }
      } catch (decryptionError) {
        console.error(`[Cron ${moment().tz(TIMEZONE).format()}] [${jobName}] Ошибка дешифрования токена для User ${user.id}: ${decryptionError.message}. Пропуск.`);
        await logJobStatus(user.id, jobName, 'failure', null, `Token decryption error: ${decryptionError.message}`);
        continue;
      }

      await scheduleSafeImport({
        user_id: user.id,
        vendistaApiToken: plainVendistaToken, // Используем дешифрованный токен
        dateFrom,
        dateTo,
        fetchAllPages
      }, jobName);
    }
  } catch (e) {
    console.error(`[Cron ${moment().tz(TIMEZONE).format()}] [${jobName}] Глобальная ошибка: ${e.message}`);
  }
}

// --- ЗАДАЧА 1: Каждые 15 минут (вчерашний + сегодняшний день, только первая страница) ---
cron.schedule('*/15 * * * *', () => runScheduledJob('15-Min Import', [1, 'days'], false), { scheduled: true, timezone: TIMEZONE });
console.log('15-минутный планировщик импорта транзакций запущен.');

// --- ЗАДАЧА 2: Ежедневно (Пн-Сб) в 23:00 МСК (последние 2 дня, все страницы) ---
cron.schedule('0 23 * * 1-6', () => runScheduledJob('Daily Update (48h)', [2, 'days'], true), { scheduled: true, timezone: TIMEZONE });
console.log('Ежедневный (48ч, Пн-Сб) планировщик запущен на 23:00 МСК.');

// --- ЗАДАЧА 3: Еженедельно (Вс) в 23:00 МСК (последние 7 дней, все страницы) ---
cron.schedule('0 23 * * 0', () => runScheduledJob('Weekly Update (7d)', [7, 'days'], true), { scheduled: true, timezone: TIMEZONE });
console.log('Еженедельный (7д, Вс) планировщик запущен на 23:00 МСК.');


async function manualImportLastNDays(days, specificUserId = null) {
    const jobName = `Manual Import (${days}d)${specificUserId ? ` for User ${specificUserId}` : ''}`;
    console.log(`[Manual Trigger ${moment().tz(TIMEZONE).format()}] Запуск ${jobName}...`);
    try {
        let queryText = 'SELECT id, vendista_api_token FROM users WHERE vendista_api_token IS NOT NULL';
        const queryParams = [];
        if (specificUserId) {
            queryText += ' AND id = $1';
            queryParams.push(specificUserId);
        }
        const usersRes = await pool.query(queryText, queryParams);

        if (usersRes.rows.length === 0) {
            console.log(`[Manual Trigger] Нет пользователей для импорта (ID: ${specificUserId || 'all'}).`);
            return;
        }
        const dateTo = moment().tz(TIMEZONE).format('YYYY-MM-DD');
        const dateFrom = moment().tz(TIMEZONE).subtract(days, 'days').format('YYYY-MM-DD');

        for (const user of usersRes.rows) {
            const encryptedToken = user.vendista_api_token;
            let plainVendistaToken;

            if (!encryptedToken) {
                console.warn(`[Manual Trigger] [${jobName}] User ${user.id} не имеет vendista_api_token. Пропуск.`);
                await logJobStatus(user.id, jobName, 'skipped_no_token', null, 'User has no vendista_api_token in DB');
                continue;
            }

            try {
                plainVendistaToken = decrypt(encryptedToken);
                if (!plainVendistaToken) {
                    console.error(`[Manual Trigger] [${jobName}] Не удалось дешифровать токен для User ${user.id}. Пропуск.`);
                    await logJobStatus(user.id, jobName, 'failure', null, 'Token decryption failed');
                    continue;
                }
            } catch (decryptionError) {
                console.error(`[Manual Trigger] [${jobName}] Ошибка дешифрования токена для User ${user.id}: ${decryptionError.message}. Пропуск.`);
                await logJobStatus(user.id, jobName, 'failure', null, `Token decryption error: ${decryptionError.message}`);
                continue;
            }

            await scheduleSafeImport({
                user_id: user.id,
                vendistaApiToken: plainVendistaToken, // Используем дешифрованный токен
                dateFrom, dateTo, fetchAllPages: true
            }, jobName);
        }
        console.log(`[Manual Trigger] ${jobName} завершен.`);
    } catch (e) {
        console.error(`[Manual Trigger] Ошибка в ${jobName}: ${e.message}`);
    }
}

if (require.main === module) {
    const args = process.argv.slice(2);
    const manualArg = args.find(arg => arg.startsWith('manualImport:'));
    if (manualArg) {
        const parts = manualArg.split(':');
        const daysToImport = parseInt(parts[1], 10);
        const userIdToImport = parts.length > 2 ? parseInt(parts[2], 10) : null;

        if (!isNaN(daysToImport) && daysToImport > 0) {
            manualImportLastNDays(daysToImport, userIdToImport)
                .then(() => { console.log('Ручной импорт завершен.'); process.exit(0); })
                .catch(e => { console.error('Критическая ошибка при ручном импорте:', e); process.exit(1); });
        } else {
            console.log("Для ручного импорта укажите количество дней, например: manualImport:7 или manualImport:7:123 (для userID 123)");
            process.exit(1);
        }
    } else {
        console.log('Файл schedule_imports.js запущен, cron-задачи настроены.');
        console.log('Для ручного импорта: node backend/worker/schedule_imports.js manualImport:DAYS[:USER_ID]');
        // Не завершаем процесс, если он запущен без аргументов, чтобы cron-задачи продолжали работать
    }
}

module.exports = { manualImportLastNDays }; // Экспортируем, если нужно вызывать из другого места