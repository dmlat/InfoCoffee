const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const pool = require('../db');
const { startImport: startImportLegacy } = require('./vendista_import_worker');
const moment = require('moment-timezone');
const crypto = require('crypto'); // Добавлено для дешифрования

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;
const ALGORITHM = 'aes-256-cbc';
const IV_LENGTH = 16;

if (!ENCRYPTION_KEY) {
    console.error("[FATAL ERROR in import_all.js] ENCRYPTION_KEY is not defined in .env file. Worker cannot decrypt tokens.");
    process.exit(1);
}

// Функция дешифрования (аналогична той, что в auth.js и schedule_imports.js)
function decrypt(text) {
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
        console.error('Decryption failed for token:', error); // Добавлено error в лог
        return null;
    }
}

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
      const encryptedToken = user.vendista_api_token;
      let plainVendistaToken;

      if (!encryptedToken) {
          console.warn(`[Manual ImportAll] User ${user.id} не имеет vendista_api_token. Пропуск.`);
          continue;
      }

      try {
        plainVendistaToken = decrypt(encryptedToken);
        if (!plainVendistaToken) {
            console.error(`[Manual ImportAll] Не удалось дешифровать токен для User ID: ${user.id}. Пропуск.`);
            // Можно добавить логирование в БД, если это критично
            continue;
        }
      } catch (decryptionError) {
        console.error(`[Manual ImportAll] Ошибка дешифрования токена для User ID: ${user.id}: ${decryptionError.message}. Пропуск.`);
        continue;
      }

      console.log(`[Manual ImportAll] Запуск импорта для User ID: ${user.id}`);
      // Передаем дешифрованный токен
      await startImportLegacy({
        user_id: user.id,
        vendistaApiToken: plainVendistaToken, 
        first_coffee_date: moment(user.setup_date).format('YYYY-MM-DD')
      });
      console.log(`[Manual ImportAll] Импорт для User ID: ${user.id} инициирован.`);
    }
    console.log('[Manual ImportAll] Полный импорт для всех пользователей завершен.');
  } catch (e) {
    console.error('[Manual ImportAll] Ошибка при полном импорте:', e.message, e.stack);
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