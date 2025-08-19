// backend/utils/envLoader_simple.js
// Упрощенная версия загрузчика для диагностики
console.log('[SIMPLE ENV] Starting simple environment loader...');

try {
    // Пробуем без dotenv - используем только системные переменные
    console.log('[SIMPLE ENV] Current working directory:', process.cwd());
    console.log('[SIMPLE ENV] __dirname:', __dirname);
    console.log('[SIMPLE ENV] NODE_ENV from system:', process.env.NODE_ENV);
    
    // Проверяем наличие dotenv модуля
    try {
        require.resolve('dotenv');
        console.log('[SIMPLE ENV] ✅ dotenv module is available');
        
        const path = require('path');
        const fs = require('fs');
        
        // Пробуем найти .env файл
        const possiblePaths = [
            path.resolve(__dirname, '..', '.env'),
            path.resolve(__dirname, '..', '.env.production'),
            path.resolve(process.cwd(), '.env'),
            path.resolve(process.cwd(), 'backend', '.env')
        ];
        
        console.log('[SIMPLE ENV] Checking possible .env locations:');
        for (const envPath of possiblePaths) {
            const exists = fs.existsSync(envPath);
            console.log(`[SIMPLE ENV]   ${envPath}: ${exists ? '✅ EXISTS' : '❌ NOT FOUND'}`);
            if (exists) {
                console.log(`[SIMPLE ENV]   Size: ${fs.statSync(envPath).size} bytes`);
                // Пробуем загрузить
                const result = require('dotenv').config({ path: envPath });
                if (result.error) {
                    console.log(`[SIMPLE ENV]   Load result: ERROR - ${result.error}`);
                } else {
                    console.log(`[SIMPLE ENV]   Load result: SUCCESS`);
                    break;
                }
            }
        }
        
    } catch (e) {
        console.log('[SIMPLE ENV] ❌ dotenv module is NOT available:', e.message);
    }
    
    // Показываем итоговые переменные
    console.log('[SIMPLE ENV] Final environment check:');
    console.log(`[SIMPLE ENV]   NODE_ENV: ${process.env.NODE_ENV || 'undefined'}`);
    console.log(`[SIMPLE ENV]   TELEGRAM_BOT_TOKEN: ${process.env.TELEGRAM_BOT_TOKEN ? 'SET' : 'NOT SET'}`);
    console.log(`[SIMPLE ENV]   DEV_TELEGRAM_BOT_TOKEN: ${process.env.DEV_TELEGRAM_BOT_TOKEN ? 'SET' : 'NOT SET'}`);
    
} catch (error) {
    console.error('[SIMPLE ENV] FATAL ERROR:', error);
}

console.log('[SIMPLE ENV] Simple environment loader finished');
module.exports = {};
