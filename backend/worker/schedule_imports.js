// backend/worker/schedule_imports.js
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const cron = require('node-cron');
const pool = require('../db');
const { importTransactionsForPeriod } = require('./vendista_import_worker');
const moment = require('moment-timezone');
const crypto = require('crypto');
const { sendErrorToAdmin } = require('../utils/adminErrorNotifier'); // Импорт уведомителя

const TIMEZONE = 'Europe/Moscow';
const USER_PROCESSING_DELAY_MS = 10000; // 10 секунд задержки между обработкой разных пользователей
const MAX_CONCURRENT_IP_IMPORTS = 2; // Ограничение на количество одновременных импортов с нашего IP

let activeIpImports = 0; // Счетчик активных импортов с нашего IP
const importQueue = []; // Очередь для пользователей, ожидающих импорта

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;
const ALGORITHM = 'aes-256-cbc';

if (!ENCRYPTION_KEY) {
    console.error("[FATAL ERROR in schedule_imports.js] ENCRYPTION_KEY is not defined. Worker cannot decrypt.");
    process.exit(1);
}

function decrypt(text) {
    // ... (функция decrypt остается такой же, как в предыдущей версии файла)
    if (!ENCRYPTION_KEY) {
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
    const logTime = moment().tz(TIMEZONE).format();
    console.error(`[Cron ${logTime}] [${jobName}] Ошибка записи лога для User ${userId}: ${logErr.message}`);
  }
}

async function processImportQueue() {
    if (activeIpImports >= MAX_CONCURRENT_IP_IMPORTS || importQueue.length === 0) {
        return;
    }

    activeIpImports++;
    const { params, jobName } = importQueue.shift();
    const logTime = moment().tz(TIMEZONE).format();
    
    console.log(`[Cron ${logTime}] [${jobName}] Извлечение из очереди для User ${params.user_id}. Активных импортов: ${activeIpImports}. В очереди: ${importQueue.length}`);

    try {
        const importResult = await importTransactionsForPeriod(params);
        if (importResult.success) {
            await logJobStatus(params.user_id, jobName, 'success', importResult);
        } else {
            await logJobStatus(params.user_id, jobName, 'failure', importResult, importResult.error);
            if (importResult.error && importResult.error.toLowerCase().includes('token')) {
                console.error(`[Cron ${logTime}] [${jobName}] User ${params.user_id} Vendista token might be invalid (after decryption).`);
                // Уведомление уже должно отправляться из importTransactionsForPeriod
            }
        }
    } catch (e) {
        console.error(`[Cron ${logTime}] [${jobName}] КРИТИЧЕСКАЯ Ошибка для User ${params.user_id}: ${e.message}`);
        await logJobStatus(params.user_id, jobName, 'critical_failure', null, e.message);
        await sendErrorToAdmin({
            userId: params.user_id,
            errorContext: `Critical scheduleSafeImport ${jobName} for User ${params.user_id}`,
            errorMessage: e.message,
            errorStack: e.stack
        });
    } finally {
        activeIpImports--;
        console.log(`[Cron ${logTime}] [${jobName}] Завершение для User ${params.user_id}. Активных импортов: ${activeIpImports}.`);
        // Задержка перед обработкой следующего из очереди, если он есть
        if (importQueue.length > 0) {
             setTimeout(processImportQueue, USER_PROCESSING_DELAY_MS);
        } else {
            processImportQueue(); // Проверить, не появились ли новые задачи, пока этот выполнялся
        }
    }
}

function addToImportQueue(params, jobName) {
    importQueue.push({ params, jobName });
    console.log(`[Cron ${moment().tz(TIMEZONE).format()}] [${jobName}] User ${params.user_id} добавлен в очередь. Всего в очереди: ${importQueue.length}`);
    processImportQueue(); // Попытаться запустить обработку очереди
}


async function runScheduledJob(jobName, dateSubtractArgs, fetchAllPages) {
  const logTime = moment().tz(TIMEZONE).format();
  console.log(`[Cron ${logTime}] Запуск джоба: ${jobName}...`);
  try {
    const usersRes = await pool.query('SELECT id, vendista_api_token, first_name, user_name, telegram_id FROM users WHERE vendista_api_token IS NOT NULL AND setup_date IS NOT NULL');
    if (usersRes.rows.length === 0) {
      console.log(`[Cron ${logTime}] [${jobName}] Нет пользователей для импорта.`);
      return;
    }

    const dateTo = moment().tz(TIMEZONE).format('YYYY-MM-DD');
    const dateFrom = moment().tz(TIMEZONE).subtract(...dateSubtractArgs).format('YYYY-MM-DD');

    // Сортируем пользователей по user_id для более предсказуемого порядка добавления в очередь
    const sortedUsers = usersRes.rows.sort((a, b) => a.id - b.id);

    for (const user of sortedUsers) {
      const encryptedToken = user.vendista_api_token;
      let plainVendistaToken;

      if (!encryptedToken) {
          console.warn(`[Cron ${logTime}] [${jobName}] User ${user.id} не имеет vendista_api_token. Пропуск.`);
          await logJobStatus(user.id, jobName, 'skipped_no_token', null, 'User has no vendista_api_token in DB');
          continue;
      }

      try {
        plainVendistaToken = decrypt(encryptedToken);
        if (!plainVendistaToken) {
            console.error(`[Cron ${logTime}] [${jobName}] Не удалось дешифровать токен для User ${user.id}. Пропуск.`);
            await logJobStatus(user.id, jobName, 'failure', null, 'Token decryption failed');
            await sendErrorToAdmin({
                userId: user.id,
                telegramId: user.telegram_id,
                userFirstName: user.first_name,
                userUsername: user.user_name,
                errorContext: `Token Decryption in ${jobName} for User ${user.id}`,
                errorMessage: "Token decryption failed prior to import."
            });
            continue;
        }
      } catch (decryptionError) {
        console.error(`[Cron ${logTime}] [${jobName}] Ошибка дешифрования токена для User ${user.id}: ${decryptionError.message}. Пропуск.`);
        await logJobStatus(user.id, jobName, 'failure', null, `Token decryption error: ${decryptionError.message}`);
        await sendErrorToAdmin({
            userId: user.id,
            telegramId: user.telegram_id,
            userFirstName: user.first_name,
            userUsername: user.user_name,
            errorContext: `Token Decryption Error in ${jobName} for User ${user.id}`,
            errorMessage: decryptionError.message,
            errorStack: decryptionError.stack
        });
        continue;
      }

      addToImportQueue({
        user_id: user.id,
        vendistaApiToken: plainVendistaToken,
        dateFrom, dateTo, fetchAllPages,
        // Передаем доп. инфо для логов и уведомлений
        user_telegram_id: user.telegram_id,
        user_first_name: user.first_name,
        user_user_name: user.user_name
      }, jobName);
    }
  } catch (e) {
    console.error(`[Cron ${logTime}] [${jobName}] Глобальная ошибка: ${e.message}`);
    await sendErrorToAdmin({
        errorContext: `Global error in scheduled job: ${jobName}`,
        errorMessage: e.message,
        errorStack: e.stack
    });
  }
}

// --- ЗАДАЧИ CRON ---
// Каждые 15 минут (вчерашний + сегодняшний день, только первая страница)
cron.schedule('*/15 * * * *', () => runScheduledJob('15-Min Import', [1, 'days'], false), { scheduled: true, timezone: TIMEZONE });
console.log('15-минутный планировщик импорта транзакций запущен.');

// Ежедневно (Пн-Сб) в 23:05 МСК (последние 3 дня, все страницы) - сдвинул на 5 минут и увеличил окно на 1 день
cron.schedule('5 23 * * 1-6', () => runScheduledJob('Daily Update (72h)', [3, 'days'], true), { scheduled: true, timezone: TIMEZONE });
console.log('Ежедневный (72ч, Пн-Сб) планировщик запущен на 23:05 МСК.');

// Еженедельно (Вс) в 23:10 МСК (последние 8 дней, все страницы) - сдвинул на 10 минут и увеличил окно на 1 день
cron.schedule('10 23 * * 0', () => runScheduledJob('Weekly Update (8d)', [8, 'days'], true), { scheduled: true, timezone: TIMEZONE });
console.log('Еженедельный (8д, Вс) планировщик запущен на 23:10 МСК.');


// ... (остальная часть файла с manualImportLastNDays и if (require.main === module) остается без изменений)

async function manualImportLastNDays(days, specificUserId = null) {
    const jobName = `Manual Import (${days}d)${specificUserId ? ` for User ${specificUserId}` : ''}`;
    const logTime = moment().tz(TIMEZONE).format();
    console.log(`[Manual Trigger ${logTime}] Запуск ${jobName}...`);
    try {
        let queryText = 'SELECT id, vendista_api_token, first_name, user_name, telegram_id FROM users WHERE vendista_api_token IS NOT NULL AND setup_date IS NOT NULL';
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
                console.warn(`[Manual Trigger ${logTime}] [${jobName}] User ${user.id} не имеет vendista_api_token. Пропуск.`);
                await logJobStatus(user.id, jobName, 'skipped_no_token', null, 'User has no vendista_api_token in DB');
                continue;
            }

            try {
                plainVendistaToken = decrypt(encryptedToken);
                if (!plainVendistaToken) {
                    const errMsg = `Не удалось дешифровать токен для User ${user.id}.`;
                    console.error(`[Manual Trigger ${logTime}] [${jobName}] ${errMsg} Пропуск.`);
                    await logJobStatus(user.id, jobName, 'failure', null, 'Token decryption failed');
                    await sendErrorToAdmin({ userId: user.id, telegramId: user.telegram_id, userFirstName: user.first_name, userUsername: user.user_name, errorContext: `Manual Import Token Decryption for User ${user.id}`, errorMessage: errMsg });
                    continue;
                }
            } catch (decryptionError) {
                const errMsg = `Ошибка дешифрования токена для User ${user.id}: ${decryptionError.message}.`;
                console.error(`[Manual Trigger ${logTime}] [${jobName}] ${errMsg} Пропуск.`);
                await logJobStatus(user.id, jobName, 'failure', null, `Token decryption error: ${decryptionError.message}`);
                await sendErrorToAdmin({ userId: user.id, telegramId: user.telegram_id, userFirstName: user.first_name, userUsername: user.user_name, errorContext: `Manual Import Token Decryption Error for User ${user.id}`, errorMessage: decryptionError.message, errorStack: decryptionError.stack });
                continue;
            }

            addToImportQueue({
                user_id: user.id,
                vendistaApiToken: plainVendistaToken,
                dateFrom, dateTo, fetchAllPages: true,
                user_telegram_id: user.telegram_id,
                user_first_name: user.first_name,
                user_user_name: user.user_name
            }, jobName);
        }
        console.log(`[Manual Trigger ${logTime}] ${jobName} задачи добавлены в очередь.`);
    } catch (e) {
        console.error(`[Manual Trigger ${logTime}] Ошибка в ${jobName}: ${e.message}`);
        await sendErrorToAdmin({ errorContext: `Global error in manual import: ${jobName}`, errorMessage: e.message, errorStack: e.stack });
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
                .then(() => { 
                    console.log('Ручной импорт завершен (задачи добавлены в очередь). Для полного завершения дождитесь обработки очереди.');
                    // Не выходим сразу, даем очереди шанс обработаться
                    // process.exit(0); 
                })
                .catch(e => { console.error('Критическая ошибка при ручном импорте:', e); process.exit(1); });
        } else {
            console.log("Для ручного импорта укажите количество дней, например: manualImport:7 или manualImport:7:123 (для userID 123)");
            process.exit(1);
        }
    } else {
        console.log('Файл schedule_imports.js запущен, cron-задачи настроены.');
        console.log('Для ручного импорта: node backend/worker/schedule_imports.js manualImport:DAYS[:USER_ID]');
    }
}

module.exports = { manualImportLastNDays };