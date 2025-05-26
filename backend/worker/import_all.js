// backend/worker/import_all.js
const pool = require('../db'); // Лучше использовать pool, как в других файлах
const { startImport: startImportLegacy } = require('./vendista_import_worker'); // Импортируем как startImportLegacy

async function importForAllUsersManual() {
  console.log('[Manual ImportAll] Запуск полного импорта для всех пользователей...');
  try {
    const usersRes = await pool.query(
      'SELECT id, vendista_login, vendista_password_hash, setup_date FROM users WHERE vendista_login IS NOT NULL AND vendista_password_hash IS NOT NULL'
    );
    if (usersRes.rows.length === 0) {
        console.log('[Manual ImportAll] Нет пользователей для импорта.');
        return;
    }

    console.log(`[Manual ImportAll] Найдено пользователей для импорта: ${usersRes.rows.length}`);
    for (const user of usersRes.rows) {
      console.log(`[Manual ImportAll] Запуск импорта для User ID: ${user.id}, Login: ${user.vendista_login}`);
      // startImportLegacy ожидает объект с полями user_id, vendistaLogin, vendistaPass, first_coffee_date
      await startImportLegacy({ // Добавляем await, чтобы импорты шли последовательно для пользователей при ручном запуске
        user_id: user.id,
        vendistaLogin: user.vendista_login,
        vendistaPass: user.vendista_password_hash, // Используем правильное поле из БД
        first_coffee_date: user.setup_date // Поле в БД называется setup_date
      });
      console.log(`[Manual ImportAll] Импорт для User ID: ${user.id} инициирован.`);
    }
    console.log('[Manual ImportAll] Полный импорт для всех пользователей завершен.');
  } catch (e) {
    console.error('[Manual ImportAll] Ошибка при полном импорте:', e.message);
  }
}

// Можно запускать вручную: node backend/worker/import_all.js
if (require.main === module) {
  importForAllUsersManual().then(() => {
      console.log('Скрипт import_all.js завершил работу.');
      process.exit(0); // Выходим после завершения
  }).catch(err => {
      console.error('Критическая ошибка в import_all.js:', err);
      process.exit(1);
  });
}

module.exports = { importForAllUsersManual };