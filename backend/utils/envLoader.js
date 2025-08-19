// backend/utils/envLoader.js
// Централизованная загрузка переменных окружения
console.log('[ENV LOADER] Starting environment loader...');

try {
    const path = require('path');
    console.log('[ENV LOADER] Path module loaded successfully');

    // Определяем режим работы
    const IS_PRODUCTION = process.env.NODE_ENV === 'production';
    console.log('[ENV LOADER] Production check complete');

    // Выбираем правильный .env файл
    const envFile = IS_PRODUCTION ? '.env' : '.env.development';
    const envPath = path.resolve(__dirname, '..', envFile);
    console.log(`[ENV LOADER] Trying to load: ${envPath}`);

    // Загружаем переменные окружения
    const dotenvResult = require('dotenv').config({ path: envPath });
    console.log('[ENV LOADER] Dotenv config result:', dotenvResult.error ? `ERROR: ${dotenvResult.error}` : 'SUCCESS');
} catch (error) {
    console.error('[ENV LOADER] CRITICAL ERROR during initialization:', error);
    throw error;
}

// Логируем для отладки (ВСЕГДА, чтобы диагностировать проблему на проде)
console.log(`[ENV] Loaded environment from: ${envPath}`);
console.log(`[ENV] NODE_ENV: ${process.env.NODE_ENV}`);
console.log(`[ENV] IS_PRODUCTION: ${IS_PRODUCTION}`);
console.log(`[ENV] TELEGRAM_BOT_TOKEN present: ${!!process.env.TELEGRAM_BOT_TOKEN}`);
console.log(`[ENV] DEV_TELEGRAM_BOT_TOKEN present: ${!!process.env.DEV_TELEGRAM_BOT_TOKEN}`);

// Проверим, существует ли файл .env
const fs = require('fs');
console.log(`[ENV] .env file exists: ${fs.existsSync(envPath)}`);
if (fs.existsSync(envPath)) {
    console.log(`[ENV] .env file size: ${fs.statSync(envPath).size} bytes`);
}

module.exports = {};
