// backend/worker/schedule_imports.js
require('../utils/logger'); // <--- ГЛОБАЛЬНОЕ ПОДКЛЮЧЕНИЕ ЛОГГЕРА
const cron = require('node-cron');
const pool = require('../db');
const moment = require('moment-timezone');
const jwt = require('jsonwebtoken');

const { importTransactionsForPeriod } = require('./vendista_import_worker');
const { sendErrorToAdmin } = require('../utils/adminErrorNotifier');
const { decrypt } = require('../utils/security');
const { syncAllTerminals } = require('./terminal_sync_worker');

const TIMEZONE = 'Europe/Moscow';
const USER_PROCESSING_DELAY_MS = 1500;
const MAX_CONCURRENT_IP_IMPORTS = 1;
const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
    console.error("[FATAL ERROR in schedule_imports.js] JWT_SECRET is not defined. Worker cannot run.");
    process.exit(1);
}

let activeIpImports = 0;
const importQueue = [];

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
    
    console.log(`[Cron ${logTime}] [${jobName}] Извлечение из очереди для User ${params.ownerUserId}. Активных импортов: ${activeIpImports}. В очереди: ${importQueue.length}`);

    try {
        const importResult = await importTransactionsForPeriod(params);
        if (importResult.success) {
            await logJobStatus(params.ownerUserId, jobName, 'success', importResult);
        } else {
            await logJobStatus(params.ownerUserId, jobName, 'failure', importResult, importResult.error);
            if (importResult.error && importResult.error.toLowerCase().includes('token')) {
                console.error(`[Cron ${logTime}] [${jobName}] User ${params.ownerUserId} Vendista token might be invalid (after decryption).`);
            }
        }
    } catch (e) {
        console.error(`[Cron ${logTime}] [${jobName}] КРИТИЧЕСКАЯ Ошибка для User ${params.ownerUserId}: ${e.message}`);
        await logJobStatus(params.ownerUserId, jobName, 'critical_failure', null, e.message);
        await sendErrorToAdmin({
            userId: params.ownerUserId,
            errorContext: `Critical scheduleSafeImport ${jobName} for User ${params.ownerUserId}`,
            errorMessage: e.message,
            errorStack: e.stack
        });
    } finally {
        activeIpImports--;
        console.log(`[Cron ${logTime}] [${jobName}] Завершение для User ${params.ownerUserId}. Активных импортов: ${activeIpImports}.`);
        if (importQueue.length > 0) {
             setTimeout(processImportQueue, USER_PROCESSING_DELAY_MS);
        } else {
            processImportQueue();
        }
    }
}

function addToImportQueue(params, jobName) {
    importQueue.push({ params, jobName });
    console.log(`[Cron ${moment().tz(TIMEZONE).format()}] [${jobName}] User ${params.ownerUserId} добавлен в очередь. Всего в очереди: ${importQueue.length}`);
    processImportQueue();
}


async function runScheduledJob(jobName, dateSubtractArgs, fetchAllPages) {
  const logTime = moment().tz(TIMEZONE).format();
  console.log(`[Cron ${logTime}] Запуск джоба: ${jobName}...`);
  try {
    // Получаем только пользователей с активным статусом оплаты
    const usersRes = await pool.query(`
        SELECT id, vendista_api_token, telegram_id, vendista_payment_status, first_name, user_name 
        FROM users 
        WHERE vendista_api_token IS NOT NULL AND setup_date IS NOT NULL
    `);
    if (usersRes.rows.length === 0) {
      console.log(`[Cron ${logTime}] [${jobName}] Нет пользователей для импорта.`);
      return;
    }

    const dateTo = moment().tz(TIMEZONE).format('YYYY-MM-DD');
    const dateFrom = moment().tz(TIMEZONE).subtract(...dateSubtractArgs).format('YYYY-MM-DD');

    const sortedUsers = usersRes.rows.sort((a, b) => a.id - b.id);

    for (const user of sortedUsers) {
      // Пропускаем пользователей с неоплаченным статусом
      if (user.vendista_payment_status === 'payment_required') {
          console.log(`[Cron ${logTime}] [${jobName}] Skipping user ${user.id} (${user.first_name || 'N/A'}) - payment required`);
          await logJobStatus(user.id, jobName, 'skipped_payment_required', null, 'User has payment_required status - Vendista payment needed');
          continue;
      }

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
            const decryptErrorMsg = 'Token decryption failed';
            console.error(`[Cron ${logTime}] [${jobName}] Не удалось дешифровать токен для User ${user.id}. Пропуск.`);
            await logJobStatus(user.id, jobName, 'failure', null, decryptErrorMsg);
            await sendErrorToAdmin({
                userId: user.id, telegramId: user.telegram_id,
                errorContext: `Token Decryption in ${jobName} for User ${user.id}`,
                errorMessage: decryptErrorMsg
            });
            continue;
        }
      } catch (decryptionError) {
        console.error(`[Cron ${logTime}] [${jobName}] Ошибка дешифрования токена для User ${user.id}: ${decryptionError.message}. Пропуск.`);
        await logJobStatus(user.id, jobName, 'failure', null, `Token decryption error: ${decryptionError.message}`);
        await sendErrorToAdmin({
            userId: user.id, telegramId: user.telegram_id,
            errorContext: `Token Decryption Error in ${jobName} for User ${user.id}`,
            errorMessage: decryptionError.message, errorStack: decryptionError.stack
        });
        continue;
      }

      const appToken = jwt.sign(
        { userId: user.id, telegramId: user.telegram_id, accessLevel: 'owner' },
        JWT_SECRET,
        { expiresIn: '15m' }
      );

      addToImportQueue({
        ownerUserId: user.id,
        vendistaApiToken: plainVendistaToken,
        appToken: appToken,
        dateFrom, dateTo, fetchAllPages,
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

async function manualImportLastNDays(days, targetUserId) {
    const jobName = `Manual Import (${days}d)`;
    const logTime = moment().tz(TIMEZONE).format();
    console.log(`[Cron ${logTime}] Запуск ручного импорта: ${jobName}...`);

    try {
        let query = 'SELECT id, vendista_api_token, telegram_id, vendista_payment_status, first_name, user_name FROM users WHERE vendista_api_token IS NOT NULL AND setup_date IS NOT NULL';
        const queryParams = [];
        if (targetUserId) {
            query += ' AND id = $1';
            queryParams.push(targetUserId);
            console.log(`[Cron ${logTime}] [${jobName}] Целевой пользователь: ${targetUserId}`);
        }

        const usersRes = await pool.query(query, queryParams);
        if (usersRes.rows.length === 0) {
            console.log(`[Cron ${logTime}] [${jobName}] Нет пользователей для импорта (возможно, указан неверный ID).`);
            return;
        }

        const dateTo = moment().tz(TIMEZONE).format('YYYY-MM-DD');
        const dateFrom = moment().tz(TIMEZONE).subtract(days, 'days').format('YYYY-MM-DD');

        for (const user of usersRes.rows) {
            // Пропускаем пользователей с неоплаченным статусом
            if (user.vendista_payment_status === 'payment_required') {
                console.log(`[Cron ${logTime}] [${jobName}] Skipping user ${user.id} (${user.first_name || 'N/A'}) - payment required`);
                continue;
            }

            const encryptedToken = user.vendista_api_token;
            let plainVendistaToken;

            if (!encryptedToken) {
                console.warn(`[Cron ${logTime}] [${jobName}] User ${user.id} не имеет vendista_api_token. Пропуск.`);
                continue;
            }

            try {
                plainVendistaToken = decrypt(encryptedToken);
                if (!plainVendistaToken) {
                    const decryptErrorMsg = 'Token decryption failed';
                    console.error(`[Cron ${logTime}] [${jobName}] Не удалось дешифровать токен для User ${user.id}.`);
                    await logJobStatus(user.id, jobName, 'failure', null, decryptErrorMsg);
                    await sendErrorToAdmin({ userId: user.id, errorContext: `Token Decryption in ${jobName}`, errorMessage: decryptErrorMsg });
                    continue;
                }
            } catch (decryptionError) {
                console.error(`[Cron ${logTime}] [${jobName}] Ошибка дешифрования токена для User ${user.id}: ${decryptionError.message}.`);
                await logJobStatus(user.id, jobName, 'failure', null, `Token decryption error: ${decryptionError.message}`);
                continue;
            }

            const appToken = jwt.sign(
                { userId: user.id, telegramId: user.telegram_id, accessLevel: 'owner' },
                JWT_SECRET,
                { expiresIn: '15m' }
            );

            addToImportQueue({
                ownerUserId: user.id,
                vendistaApiToken: plainVendistaToken,
                appToken: appToken,
                dateFrom,
                dateTo,
                fetchAllPages: true,
            }, jobName);
        }
    } catch (e) {
        console.error(`[Cron ${logTime}] [${jobName}] Глобальная ошибка: ${e.message}`);
        await sendErrorToAdmin({
            errorContext: `Global error in manual job: ${jobName}`,
            errorMessage: e.message,
            errorStack: e.stack,
            additionalInfo: { targetUserId, days }
        });
    }
}

function scheduleAll() {
    console.log('Планировщик запущен. Настройка cron-задач...');
    
    // --- ЗАДАЧИ ИМПОРТА ТРАНЗАКЦИЙ ---
    cron.schedule('*/15 * * * *', () => runScheduledJob('15-Min Import', [1, 'days'], false), { scheduled: true, timezone: TIMEZONE });
    console.log('15-минутный планировщик импорта транзакций запущен.');

    cron.schedule('5 23 * * 1-6', () => runScheduledJob('Daily Update (72h)', [3, 'days'], true), { scheduled: true, timezone: TIMEZONE });
    console.log('Ежедневный (72ч, Пн-Сб) планировщик запущен на 23:05 МСК.');

    cron.schedule('10 23 * * 0', () => runScheduledJob('Weekly Update (8d)', [8, 'days'], true), { scheduled: true, timezone: TIMEZONE });
    console.log('Еженедельный (8д, Вс) планировщик запущен на 23:10 МСК.');

    // ИЗМЕНЕНИЕ: Запускаем синхронизацию терминалов каждые 15 минут, как и импорт транзакций
    cron.schedule('*/15 * * * *', () => syncAllTerminals(), { scheduled: true, timezone: TIMEZONE });
    console.log('Планировщик синхронизации терминалов запущен (каждые 15 минут).');
}

function runImmediateJobs() {
    console.log('Запуск немедленных задач при старте воркера...');
    syncAllTerminals().catch(e => console.error('Initial terminal sync failed:', e));
}

async function manualSyncTerminals() {
    console.log('[Manual Trigger] Starting terminal synchronization...');
    try {
        await syncAllTerminals();
        console.log('[Manual Trigger] Terminal synchronization finished.');
    } catch (e) {
        console.error('[Manual Trigger] A critical error occurred during manual terminal sync:', e);
        process.exit(1);
    }
}


if (require.main === module) {
    const args = process.argv.slice(2);
    const manualArg = args.find(arg => arg.startsWith('manualImport:'));
    const manualTerminalSyncArg = args.includes('manualTerminalSync');

    if (manualTerminalSyncArg) {
        console.log('[CLI] Manual terminal sync requested.');
        manualSyncTerminals().then(() => {
            console.log('[CLI] Manual terminal sync finished. Exiting.');
            process.exit(0);
        });
        return; // <-- ВАЖНО: Предотвращаем выполнение остального кода
    } 
    
    if (manualArg) {
        console.log('[CLI] Manual import requested.');
        const parts = manualArg.split(':');
        const daysToImport = parseInt(parts[1], 10);
        const userIdToImport = parts.length > 2 ? parseInt(parts[2], 10) : null;

        if (!isNaN(daysToImport) && daysToImport > 0) {
            manualImportLastNDays(daysToImport, userIdToImport)
                .then(() => { 
                    console.log('Ручной импорт завершен (задачи добавлены в очередь). Ожидание обработки...');
                    const intervalId = setInterval(() => {
                        if (importQueue.length === 0 && activeIpImports === 0) {
                            console.log('Очередь обработки пуста. Завершение работы.');
                            clearInterval(intervalId);
                            process.exit(0);
                        }
                    }, 3000);
                })
                .catch(e => { console.error('Критическая ошибка при ручном импорте:', e); process.exit(1); });
        } else {
            console.log("Для ручного импорта укажите количество дней, например: manualImport:7 или manualImport:7:123 (для userID 123)");
            process.exit(1);
        }
        return; // <-- ВАЖНО: Предотвращаем выполнение остального кода
    }

    // Этот блок выполнится, только если не был передан ни один из флагов ручного запуска
    scheduleAll();
    runImmediateJobs();
}

module.exports = { scheduleAll, runImmediateJobs, manualImportLastNDays };