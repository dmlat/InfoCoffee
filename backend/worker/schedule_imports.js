// backend/worker/schedule_imports.js
// ВАЖНО: Загружаем переменные окружения ПЕРВЫМ ДЕЛОМ
console.log('[SCHEDULE_IMPORTS] Starting scheduler...');
try {
    require('../utils/envLoader');
    console.log('[SCHEDULE_IMPORTS] Environment loaded successfully');
} catch (error) {
    console.error('[SCHEDULE_IMPORTS] CRITICAL ERROR loading environment:', error);
    process.exit(1);
}

const { ToadScheduler, SimpleIntervalJob, Task } = require('toad-scheduler');
const cron = require('node-cron');
const moment = require('moment-timezone');
const { pool } = require('../db');
const { importTransactionsForPeriod } = require('./vendista_import_worker');
const { syncTerminalsForAllUsers } = require('./terminal_sync_worker');
const { decrypt } = require('../utils/security');
const { sendErrorToAdmin } = require('../utils/adminErrorNotifier');
const { checkPaymentStatus } = require('./payment_status_checker_worker'); // Импортируем новый воркер

const scheduler = new ToadScheduler();
const importQueue = [];
let isProcessing = false;

require('../utils/logger'); // <--- ГЛОБАЛЬНОЕ ПОДКЛЮЧЕНИЕ ЛОГГЕРА
const { syncAllTerminals } = require('./terminal_sync_worker');

const TIMEZONE = 'Europe/Moscow';
const USER_PROCESSING_DELAY_MS = 1500;
const MAX_CONCURRENT_IP_IMPORTS = 1;
const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
    console.error("[FATAL ERROR in schedule_imports.js] JWT_SECRET is not defined. Worker cannot run.");
    process.exit(1);
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
    if (isProcessing || importQueue.length === 0) {
        return;
    }

    isProcessing = true;
    const { importParams, jobName } = importQueue.shift();
    const logTime = moment().tz(TIMEZONE).format();
    
    console.log(`[Cron ${logTime}] [${jobName}] Извлечение из очереди для User ${importParams.ownerUserId}. Активных импортов: ${isProcessing}. В очереди: ${importQueue.length}`);

    try {
        const importResult = await importTransactionsForPeriod(importParams);
        if (importResult.success) {
            await logJobStatus(importParams.ownerUserId, jobName, 'success', importResult);
        } else {
            await logJobStatus(importParams.ownerUserId, jobName, 'failure', importResult, importResult.error);
            if (importResult.error && importResult.error.toLowerCase().includes('token')) {
                console.error(`[Cron ${logTime}] [${jobName}] User ${importParams.ownerUserId} Vendista token might be invalid.`);
            }
        }
    } catch (e) {
        console.error(`[Cron ${logTime}] [${jobName}] КРИТИЧЕСКАЯ Ошибка для User ${importParams.ownerUserId}: ${e.message}`);
        await logJobStatus(importParams.ownerUserId, jobName, 'critical_failure', null, e.message);
        await sendErrorToAdmin({
            userId: importParams.ownerUserId,
            errorContext: `Critical scheduleSafeImport ${jobName} for User ${importParams.ownerUserId}`,
            errorMessage: e.message,
            errorStack: e.stack
        });
    } finally {
        isProcessing = false;
        console.log(`[Cron ${logTime}] [${jobName}] Завершение для User ${importParams.ownerUserId}. Активных импортов: ${isProcessing}.`);
        if (importQueue.length > 0) {
             setTimeout(processImportQueue, USER_PROCESSING_DELAY_MS);
        }
    }
}

function addToImportQueue(importParams, jobName) {
    importQueue.push({ importParams, jobName });
    console.log(`[Cron ${moment().tz(TIMEZONE).format()}] [${jobName}] User ${importParams.ownerUserId} добавлен в очередь. Всего в очереди: ${importQueue.length}`);
    processImportQueue();
}


async function runScheduledJob(jobName, dateSubtractArgs, isFullHistory) {
  const logTime = moment().tz(TIMEZONE).format();
  console.log(`[Cron ${logTime}] Запуск джоба: ${jobName}...`);
  try {
    // Fetch all necessary user fields
    const usersRes = await pool.query(`
        SELECT id, vendista_api_token, setup_date, telegram_id, vendista_payment_status, first_name, user_name 
        FROM users 
        WHERE vendista_api_token IS NOT NULL AND setup_date IS NOT NULL
    `);
    
    // НОВОЕ: Проверяем пользователей с токеном, но БЕЗ setup_date (критическая проблема!)
    const brokenUsersRes = await pool.query(`
        SELECT id, first_name, user_name, telegram_id 
        FROM users 
        WHERE vendista_api_token IS NOT NULL AND setup_date IS NULL
    `);
    
    if (brokenUsersRes.rows.length > 0) {
        for (const brokenUser of brokenUsersRes.rows) {
            console.error(`[Cron ${logTime}] [${jobName}] ⚠️ CRITICAL: User ${brokenUser.id} (${brokenUser.first_name}) has vendista_api_token but NO setup_date!`);
            await sendErrorToAdmin({
                userId: brokenUser.id,
                errorContext: `🚨 КРИТИЧЕСКАЯ ПРОБЛЕМА: Воркеры не работают для пользователя`,
                errorMessage: `⚠️ У пользователя ${brokenUser.first_name || 'N/A'} (@${brokenUser.user_name || 'N/A'}, ID: ${brokenUser.id}) есть токен Vendista, но ОТСУТСТВУЕТ setup_date!\n\n` +
                             `Это критическая проблема: воркеры импорта транзакций НЕ РАБОТАЮТ для этого пользователя.\n\n` +
                             `Причина: setup_date является обязательным полем для работы воркеров.\n\n` +
                             `Решение: Пользователю нужно зайти в профиль и установить дату установки первого аппарата, либо выполнить в БД:\n` +
                             `UPDATE users SET setup_date = 'YYYY-MM-DD' WHERE id = ${brokenUser.id};`,
                errorStack: null
            });
        }
    }
    
    if (usersRes.rows.length === 0) {
      console.log(`[Cron ${logTime}] [${jobName}] Нет пользователей для импорта.`);
      return;
    }

    const sortedUsers = usersRes.rows.sort((a, b) => a.id - b.id);

    for (const user of sortedUsers) {
      if (user.vendista_payment_status === 'payment_required') {
          console.log(`[Cron ${logTime}] [${jobName}] Skipping user ${user.id} (${user.first_name || 'N/A'}) - payment required`);
          await logJobStatus(user.id, jobName, 'skipped_payment_required', null, 'User has payment_required status');
          continue;
      }

              const dateTo = moment().tz(TIMEZONE).format('YYYY-MM-DD');
        const dateFrom = isFullHistory 
            ? moment(user.setup_date).format('YYYY-MM-DD')
            : moment().tz(TIMEZONE).subtract(dateSubtractArgs[0], dateSubtractArgs[1]).format('YYYY-MM-DD');

        const plainToken = decrypt(user.vendista_api_token);
        if (!plainToken) {
            console.error(`[Cron ${logTime}] [${jobName}] Failed to decrypt token for User ${user.id}. Skipping.`);
            await logJobStatus(user.id, jobName, 'skipped_decrypt_failed', null, 'Token decryption failed');
            continue;
        }

        // Create import parameters object like in the old working code
        const importParams = {
            ownerUserId: user.id,
            vendistaApiToken: plainToken,
            dateFrom,
            dateTo,
            fetchAllPages: true,
            isHistoricalImport: false // Scheduled импорты обрабатывают текущие продажи
        };

        addToImportQueue(importParams, jobName);
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

async function manualImportLastNDays(days, targetUserId, isFullHistory = false) {
    const jobName = `Manual Import (${days}d)`;
    const logTime = moment().tz(TIMEZONE).format();
    console.log(`[Cron ${logTime}] Запуск ручного импорта: ${jobName}...`);

    try {
        let query = 'SELECT * FROM users WHERE vendista_api_token IS NOT NULL AND setup_date IS NOT NULL';
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
            
            const dateTo = moment().tz(TIMEZONE).format('YYYY-MM-DD');
            const dateFrom = isFullHistory 
                ? moment(user.setup_date).format('YYYY-MM-DD')
                : moment().tz(TIMEZONE).subtract(days, 'days').format('YYYY-MM-DD');

            const plainToken = decrypt(user.vendista_api_token);
            if (!plainToken) {
                console.error(`[Cron ${logTime}] [${jobName}] Failed to decrypt token for User ${user.id}. Skipping.`);
                continue;
            }

            // Create import parameters object like in the old working code
            const importParams = {
                ownerUserId: user.id,
                vendistaApiToken: plainToken,
                dateFrom,
                dateTo,
                fetchAllPages: true,
                isHistoricalImport: isFullHistory // Исторический импорт если full-history
            };
            
            addToImportQueue(importParams, jobName);
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

    // Ежедневная проверка статуса оплаты для заблокированных пользователей
    cron.schedule('0 4 * * *', () => {
        const logTime = moment().tz(TIMEZONE).format();
        console.log(`[Cron ${logTime}] Запуск ежедневной проверки статуса оплаты...`);
        // ИСПРАВЛЕНО: Прямой вызов функции вместо несуществующего метода
        checkPaymentStatus().catch(e => console.error('Ошибка при выполнении checkPaymentStatus:', e));
    }, {
        scheduled: true,
        timezone: TIMEZONE
    });
    console.log('Планировщик ежедневной проверки статуса оплаты запущен на 04:00 МСК.');
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
                        if (importQueue.length === 0 && isProcessing === false) {
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

module.exports = { scheduleAll, runImmediateJobs, manualImportLastNDays, runScheduledJob };