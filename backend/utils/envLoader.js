// backend/utils/envLoader.js
// Централизованная загрузка переменных окружения
const path = require('path');

// Определяем режим работы
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

// Выбираем правильный .env файл
const envFile = IS_PRODUCTION ? '.env' : '.env.development';
const envPath = path.resolve(__dirname, '..', envFile);

// Загружаем переменные окружения
require('dotenv').config({ path: envPath });

// Логируем для отладки (только в dev режиме)
if (!IS_PRODUCTION) {
    console.log(`[ENV] Loaded environment from: ${envPath}`);
    console.log(`[ENV] NODE_ENV: ${process.env.NODE_ENV}`);
    console.log(`[ENV] TELEGRAM_BOT_TOKEN present: ${!!process.env.TELEGRAM_BOT_TOKEN}`);
    console.log(`[ENV] DEV_TELEGRAM_BOT_TOKEN present: ${!!process.env.DEV_TELEGRAM_BOT_TOKEN}`);
}

module.exports = {};
