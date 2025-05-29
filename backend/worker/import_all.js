const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') }); 
const pool = require('../db');
const { startImport: startImportLegacy } = require('./vendista_import_worker');
const moment = require('moment-timezone');

async function importForAllUsersManual() {
  console.log('[Manual ImportAll] Запуск полного импорта для всех пользователей...');
  try {
    const usersRes = await pool.query(
      'SELECT id, vendista_api_token, setup_date FROM users WHERE vendista_api_token IS NOT NULL AND setup_date IS NOT NULL'
    );
    if (usersRes.rows.length === 0) {
        console.log('[Manual ImportAll] Нет пользователей для импорта.');
        return;
    }

    console.log(`[Manual ImportAll] Найдено пользователей для импорта: ${usersRes.rows.length}`);
    for (const user of usersRes.rows) {
      console.log(`[Manual ImportAll] Запуск импорта для User ID: ${user.id}`);
      await startImportLegacy({
        user_id: user.id,
        vendistaApiToken: user.vendista_api_token,
        first_coffee_date: moment(user.setup_date).format('YYYY-MM-DD') // Ensure correct format
      });
      console.log(`[Manual ImportAll] Импорт для User ID: ${user.id} инициирован.`);
    }
    console.log('[Manual ImportAll] Полный импорт для всех пользователей завершен.');
  } catch (e) {
    console.error('[Manual ImportAll] Ошибка при полном импорте:', e.message);
  }
}

if (require.main === module) {
  importForAllUsersManual().then(() => {
      console.log('Скрипт import_all.js завершил работу.');
      process.exit(0);
  }).catch(err => {
      console.error('Критическая ошибка в import_all.js:', err);
      process.exit(1);
  });
}

module.exports = { importForAllUsersManual };