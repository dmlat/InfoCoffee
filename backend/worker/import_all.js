// backend/worker/import_all.js
const db = require('../db');
const { startImport } = require('./vendista_import_worker');

async function importForAllUsers() {
  try {
    const usersRes = await db.query(
      'SELECT id, vendista_login, vendista_password, date_install FROM users'
    );
    for (let user of usersRes.rows) {
      // Стартуем импорт для каждого пользователя асинхронно
      startImport({
        user_id: user.id,
        vendistaLogin: user.vendista_login,
        vendistaPass: user.vendista_password,
        first_coffee_date: user.date_install
      });
    }
    console.log('Импорт завершён для всех пользователей');
  } catch (e) {
    console.error('Ошибка фонового импорта:', e.message);
  }
}

// Можно запускать вручную: node worker/import_all.js
if (require.main === module) {
  importForAllUsers();
}

// Экспортируем для использования в кроне
module.exports = { importForAllUsers };
