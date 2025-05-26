// backend/worker/schedule_imports.js
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const cron = require('node-cron');
const pool = require('../db');
const { importTransactionsForPeriod } = require('./vendista_import_worker');
const moment = require('moment-timezone');

const TIMEZONE = 'Europe/Moscow';
const importingUsers = new Set();

async function logJobStatus(userId, jobName, status, result, errorMessage = null) {
  try {
    await pool.query(`
      INSERT INTO worker_logs (user_id, job_name, last_run_at, status, processed_items, added_items, updated_items, error_message)
      VALUES ($1, $2, NOW(), $3, $4, $5, $6, $7)
    `, [
      userId,
      jobName,
      status,
      result?.processed || 0,
      result?.added || 0,
      result?.updated || 0,
      errorMessage
    ]);
  } catch (logErr) {
    console.error(`[Cron ${moment().tz(TIMEZONE).format()}] [${jobName}] Ошибка записи лога для User ${userId}: ${logErr.message}`);
  }
}

async function scheduleSafeImport(params, jobName) {
  if (importingUsers.has(params.user_id)) {
    const message = `Пропуск для User ${params.user_id}: предыдущий импорт еще не завершен.`;
    console.log(`[Cron ${moment().tz(TIMEZONE).format()}] [${jobName}] ${message}`);
    // Логируем пропуск из-за блокировки
    await logJobStatus(params.user_id, jobName, 'skipped_due_to_lock', null, message);
    return;
  }

  importingUsers.add(params.user_id);
  console.log(`[Cron ${moment().tz(TIMEZONE).format()}] [${jobName}] Запуск для User ${params.user_id} с ${params.dateFrom} по ${params.dateTo}`);
  let importResult;
  try {
    importResult = await importTransactionsForPeriod(params);
    if (importResult.success) {
      await logJobStatus(params.user_id, jobName, 'success', importResult);
    } else {
      await logJobStatus(params.user_id, jobName, 'failure', importResult, importResult.error);
    }
  } catch (e) {
    console.error(`[Cron ${moment().tz(TIMEZONE).format()}] [${jobName}] Ошибка для User ${params.user_id}: ${e.message}`);
    await logJobStatus(params.user_id, jobName, 'failure', null, e.message);
  } finally {
    importingUsers.delete(params.user_id);
    console.log(`[Cron ${moment().tz(TIMEZONE).format()}] [${jobName}] Завершение для User ${params.user_id}`);
  }
}

// --- ЗАДАЧА 1: Каждые 15 минут ---
cron.schedule('*/15 * * * *', async () => {
  const jobName = '15-Min Import';
  console.log(`[Cron ${moment().tz(TIMEZONE).format()}] Запуск ${jobName}...`);
  try {
    const usersRes = await pool.query('SELECT id, vendista_login, vendista_password_hash AS vendista_pass FROM users WHERE vendista_login IS NOT NULL AND vendista_password_hash IS NOT NULL');
    if (usersRes.rows.length === 0) {
      console.log(`[Cron ${moment().tz(TIMEZONE).format()}] [${jobName}] Нет пользователей для импорта.`);
      return;
    }
    const dateTo = moment().tz(TIMEZONE).format('YYYY-MM-DD');
    const dateFrom = moment().tz(TIMEZONE).subtract(1, 'days').format('YYYY-MM-DD');
    for (const user of usersRes.rows) {
      await scheduleSafeImport({
        user_id: user.id, vendistaLogin: user.vendista_login, vendistaPass: user.vendista_pass,
        dateFrom, dateTo, fetchAllPages: false
      }, jobName);
    }
  } catch (e) { console.error(`[Cron ${moment().tz(TIMEZONE).format()}] [${jobName}] Глобальная ошибка: ${e.message}`); }
}, { scheduled: true, timezone: TIMEZONE });
console.log('15-минутный планировщик импорта транзакций с логированием запущен.');

// --- ЗАДАЧА 2: Ежедневно (Пн-Сб) в 23:00 МСК (48ч) ---
cron.schedule('0 23 * * 1-6', async () => {
  const jobName = 'Daily Update (48h)';
  console.log(`[Cron ${moment().tz(TIMEZONE).format()}] Запуск ${jobName}...`);
  try {
    const usersRes = await pool.query('SELECT id, vendista_login, vendista_password_hash AS vendista_pass FROM users WHERE vendista_login IS NOT NULL AND vendista_password_hash IS NOT NULL');
    if (usersRes.rows.length === 0) return;
    const dateTo = moment().tz(TIMEZONE).format('YYYY-MM-DD');
    const dateFrom = moment().tz(TIMEZONE).subtract(2, 'days').format('YYYY-MM-DD');
    for (const user of usersRes.rows) {
      await scheduleSafeImport({
        user_id: user.id, vendistaLogin: user.vendista_login, vendistaPass: user.vendista_pass,
        dateFrom, dateTo, fetchAllPages: true
      }, jobName);
    }
  } catch (e) { console.error(`[Cron ${moment().tz(TIMEZONE).format()}] [${jobName}] Глобальная ошибка: ${e.message}`); }
}, { scheduled: true, timezone: TIMEZONE });
console.log('Ежедневный (48ч, Пн-Сб) планировщик с логированием запущен на 23:00 МСК.');

// --- ЗАДАЧА 3: Еженедельно (Вс) в 23:00 МСК (7д) ---
cron.schedule('0 23 * * 0', async () => {
  const jobName = 'Weekly Update (7d)';
  console.log(`[Cron ${moment().tz(TIMEZONE).format()}] Запуск ${jobName}...`);
  try {
    const usersRes = await pool.query('SELECT id, vendista_login, vendista_password_hash AS vendista_pass FROM users WHERE vendista_login IS NOT NULL AND vendista_password_hash IS NOT NULL');
    if (usersRes.rows.length === 0) return;
    const dateTo = moment().tz(TIMEZONE).format('YYYY-MM-DD');
    const dateFrom = moment().tz(TIMEZONE).subtract(7, 'days').format('YYYY-MM-DD');
    for (const user of usersRes.rows) {
      await scheduleSafeImport({
        user_id: user.id, vendistaLogin: user.vendista_login, vendistaPass: user.vendista_pass,
        dateFrom, dateTo, fetchAllPages: true
      }, jobName);
    }
  } catch (e) { console.error(`[Cron ${moment().tz(TIMEZONE).format()}] [${jobName}] Глобальная ошибка: ${e.message}`); }
}, { scheduled: true, timezone: TIMEZONE });
console.log('Еженедельный (7д, Вс) планировщик с логированием запущен на 23:00 МСК.');

// Ручной запуск
async function manualImportLastNDays(days, specificUserId = null) {
    const jobName = `Manual Import (${days}d)${specificUserId ? ` for User ${specificUserId}` : ''}`;
    console.log(`[Manual Trigger ${moment().tz(TIMEZONE).format()}] Запуск ${jobName}...`);
    try {
        let query = 'SELECT id, vendista_login, vendista_password_hash AS vendista_pass FROM users WHERE vendista_login IS NOT NULL AND vendista_password_hash IS NOT NULL';
        const queryParams = [];
        if (specificUserId) {
            query += ' AND id = $1';
            queryParams.push(specificUserId);
        }
        const usersRes = await pool.query(query, queryParams);

        if (usersRes.rows.length === 0) {
            console.log(`[Manual Trigger] Нет пользователей для импорта (ID: ${specificUserId || 'all'}).`);
            return;
        }
        const dateTo = moment().tz(TIMEZONE).format('YYYY-MM-DD');
        const dateFrom = moment().tz(TIMEZONE).subtract(days, 'days').format('YYYY-MM-DD');

        for (const user of usersRes.rows) {
            await scheduleSafeImport({
                user_id: user.id, vendistaLogin: user.vendista_login, vendistaPass: user.vendista_pass,
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
    }
}

module.exports = { manualImportLastNDays }; // Экспортируем, если нужно вызывать из других мест