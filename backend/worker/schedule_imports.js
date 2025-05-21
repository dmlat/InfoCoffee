
const db = require('../db'); 
const { startImport } = require('./vendista_import_worker');
const moment = require('moment-timezone'); // npm install moment-timezone

async function importForAllUsers(daysBack) {
  try {
    const usersRes = await db.query('SELECT id, vendista_login, vendista_password, date_install FROM users');
    for (let user of usersRes.rows) {
      const fromDate = moment().tz('Europe/Moscow').subtract(daysBack, 'days').format('YYYY-MM-DD');
      const toDate = moment().tz('Europe/Moscow').format('YYYY-MM-DD');
      await startImport({
        user_id: user.id,
        vendistaLogin: user.vendista_login,
        vendistaPass: user.vendista_password,
        first_coffee_date: fromDate,
        end_date: toDate,
        force_update: true
      });
    }
    console.log(`Импорт за ${daysBack} дней завершён для всех пользователей`);
  } catch (e) {
    console.error('Ошибка schedule_imports:', e.message);
  }
}

async function updateReverseIds(daysBack) {
  try {
    const usersRes = await db.query('SELECT id, vendista_login, vendista_password FROM users');
    for (let user of usersRes.rows) {
      await startImport({
        user_id: user.id,
        vendistaLogin: user.vendista_login,
        vendistaPass: user.vendista_password,
        reverse_only: true,
        first_coffee_date: moment().tz('Europe/Moscow').subtract(daysBack, 'days').format('YYYY-MM-DD'),
        end_date: moment().tz('Europe/Moscow').format('YYYY-MM-DD')
      });
    }
    console.log('Обновление reverse_id завершено');
  } catch (e) {
    console.error('Ошибка обновления reverse_id:', e.message);
  }
}

async function cleanDuplicates() {
  await db.query(`
    DELETE FROM transactions t1
    USING transactions t2
    WHERE
      t1.id < t2.id
      AND t1.user_id = t2.user_id
      AND t1.vendor_transaction_id = t2.vendor_transaction_id
  `);
  console.log('Дубликаты удалены');
}

// ---- ВРЕМЕННО ДЛЯ ТЕСТА ----
// Раскомментируй нужное!
importForAllUsers(1);     // импорт транзакций за последние сутки
//importForAllUsers(7);  // импорт за неделю
//importForAllUsers(30); // импорт за месяц
//updateReverseIds(2);   // обновить reverse_id за 2 дня
//cleanDuplicates();     // удалить дубли
