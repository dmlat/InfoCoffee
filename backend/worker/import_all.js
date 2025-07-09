// backend/worker/import_all.js
const path = require('path');
const envPath = process.env.NODE_ENV === 'development' ? '.env.development' : '.env';
require('dotenv').config({ path: path.resolve(__dirname, `../${envPath}`) });
const pool = require('../db');
const { startImport } = require('./vendista_import_worker'); // Используем startImport, который вызывает importTransactionsForPeriod с fetchAllPages: true
const moment = require('moment-timezone');
const crypto = require('crypto');
const { sendErrorToAdmin } = require('../utils/adminErrorNotifier'); // Импорт уведомителя

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;
const ALGORITHM = 'aes-256-cbc';

if (!ENCRYPTION_KEY) {
    console.error("[FATAL ERROR in import_all.js] ENCRYPTION_KEY is not defined. Worker cannot decrypt tokens.");
    process.exit(1);
}

function decrypt(text) {
    // ... (функция decrypt остается такой же)
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
        console.error('Decryption failed for token:', error);
        return null;
    }
}

async function importSingleUserFullHistory(targetUserId) {
    const jobType = `Manual Full History Import for User ${targetUserId}`;
    console.log(`[${jobType}] Запуск...`);
    
    if (!targetUserId) {
        console.error(`[${jobType}] User ID не указан. Завершение.`);
        return;
    }
    
    try {
        const userRes = await pool.query(
            'SELECT id, vendista_api_token, setup_date, first_name, user_name, telegram_id FROM users WHERE id = $1 AND vendista_api_token IS NOT NULL AND setup_date IS NOT NULL',
            [targetUserId]
        );

        if (userRes.rows.length === 0) {
            console.log(`[${jobType}] Пользователь с ID ${targetUserId} не найден, или у него нет токена/даты установки.`);
            return;
        }

        const user = userRes.rows[0];
        const encryptedToken = user.vendista_api_token;
        let plainVendistaToken;

        try {
            plainVendistaToken = decrypt(encryptedToken);
            if (!plainVendistaToken) {
                const errMsg = `Не удалось дешифровать токен для User ID: ${user.id}.`;
                console.error(`[${jobType}] ${errMsg}`);
                await sendErrorToAdmin({ userId: user.id, telegramId: user.telegram_id, userFirstName: user.first_name, userUsername: user.user_name, errorContext: jobType, errorMessage: errMsg });
                return;
            }
        } catch (decryptionError) {
            const errMsg = `Ошибка дешифрования токена для User ID: ${user.id}: ${decryptionError.message}.`;
            console.error(`[${jobType}] ${errMsg}`);
            await sendErrorToAdmin({ userId: user.id, telegramId: user.telegram_id, userFirstName: user.first_name, userUsername: user.user_name, errorContext: jobType, errorMessage: errMsg, errorStack: decryptionError.stack });
            return;
        }

        console.log(`[${jobType}] Запуск импорта для User ID: ${user.id} (Имя: ${user.first_name || 'N/A'}, Username: ${user.user_name || 'N/A'}) с даты: ${moment(user.setup_date).format('YYYY-MM-DD')}`);
        
        const importResult = await startImport({ // startImport из vendista_import_worker
            user_id: user.id,
            vendistaApiToken: plainVendistaToken, 
            first_coffee_date: moment(user.setup_date).format('YYYY-MM-DD')
        });

        if (importResult.success) {
            console.log(`[${jobType}] Импорт для User ID: ${user.id} успешно завершен. Обработано: ${importResult.processed}, Добавлено: ${importResult.added}, Обновлено: ${importResult.updated}.`);
        } else {
            console.error(`[${jobType}] Импорт для User ID: ${user.id} завершился с ошибкой: ${importResult.error}`);
            // Уведомление уже отправляется из importTransactionsForPeriod
        }
        console.log(`[${jobType}] Завершено для User ID: ${user.id}.`);

    } catch (e) {
        console.error(`[${jobType}] Глобальная ошибка:`, e.message, e.stack);
        await sendErrorToAdmin({ userId: targetUserId, errorContext: jobType, errorMessage: `Global error: ${e.message}`, errorStack: e.stack });
    }
}

if (require.main === module) {
    const targetUserIdArg = process.argv[2]; 

    if (!targetUserIdArg) {
        console.log('User ID не указан. Укажите User ID для импорта.');
        console.log('Пример: node backend/worker/import_all.js <USER_ID>');
        process.exit(1);
    }

    const targetUserId = parseInt(targetUserIdArg, 10);
    if (isNaN(targetUserId)) {
        console.log(`Некорректный User ID: ${targetUserIdArg}. Укажите числовой ID.`);
        process.exit(1);
    }
    
    console.log(`Запрошен ручной полный исторический импорт для User ID: ${targetUserId}`);
    importSingleUserFullHistory(targetUserId).then(() => {
        console.log('Скрипт import_all.js (для одного пользователя) завершил работу.');
        process.exit(0);
    }).catch(err => {
        console.error('Критическая ошибка в import_all.js:', err);
        process.exit(1);
    });
}

module.exports = { importSingleUserFullHistory };