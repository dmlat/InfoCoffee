// ~/VA/backend/utils/test_notifier.js
// Путь к .env файлу вашего бэкенда
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') }); 

// Путь к вашему основному уведомителю
const { sendErrorToAdmin } = require('./adminErrorNotifier'); 

async function runTestNotification() {
    console.log("Попытка отправки тестового уведомления об ошибке...");
    try {
        await sendErrorToAdmin({
            userId: 999, // Тестовый ID пользователя из БД (может не существовать, это для теста)
            telegramId: 123456789, // Тестовый Telegram ID
            userFirstName: "ТестИмя", // Тестовое имя
            userUsername: "testadminuser", // Тестовый username
            errorContext: "Ручной Тест Уведомлений (test_notifier.js)",
            errorMessage: "Это тестовое сообщение об ошибке для проверки работы уведомлений администратора. Если вы это видите, всё работает!",
            errorStack: new Error("Это пример стека вызовов для теста").stack,
            additionalInfo: { 
                testParameter: "value123", 
                timestamp: new Date().toISOString(),
                triggeredBy: "manual_test_script"
            }
        });
        console.log("Функция sendErrorToAdmin вызвана. Проверьте ваш Telegram-бот @infocoffee_support_bot (или чат, указанный в ADMIN_TELEGRAM_CHAT_ID_FOR_ERRORS).");
    } catch (e) {
        console.error("Ошибка при вызове sendErrorToAdmin напрямую:", e.message);
        if (e.stack) {
            console.error(e.stack);
        }
    }
}

runTestNotification().then(() => {
    // Даем немного времени на отправку сообщения ботом перед выходом
    setTimeout(() => {
        console.log("Тестовый скрипт завершил работу.");
        process.exit(0);
    }, 2000); // 2 секунды задержки
}).catch(err => {
    console.error("Критическая ошибка в тестовом скрипте:", err);
    process.exit(1);
});