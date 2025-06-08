// backend/utils/botNotifier.js
const TelegramBot = require('node-telegram-bot-api');
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;

if (!TOKEN) {
    console.error('[BotNotifier] TELEGRAM_BOT_TOKEN not found. Notifications will not be sent.');
}

// Создаем экземпляр бота только для отправки сообщений, без прослушивания (polling: false)
const bot = TOKEN ? new TelegramBot(TOKEN) : null;

/**
 * Отправляет текстовое уведомление пользователю в Telegram.
 * Корректно обрабатывает ситуацию, когда пользователь еще не начал диалог с ботом.
 * @param {number|string} telegramId ID пользователя в Telegram.
 * @param {string} message Текст сообщения для отправки.
 */
async function sendNotification(telegramId, message) {
    if (!bot) {
        console.error('[BotNotifier] Bot is not initialized. Cannot send notification.');
        return;
    }

    if (!telegramId) {
        console.error('[BotNotifier] Telegram ID is not provided. Cannot send notification.');
        return;
    }

    try {
        await bot.sendMessage(telegramId, message, { parse_mode: 'HTML' }); // Используем HTML для простого форматирования
        console.log(`Notification sent successfully to ${telegramId}`);
    } catch (error) {
        if (error.response && error.response.statusCode === 403) {
            // Это ожидаемая ошибка, если пользователь не запускал бота или заблокировал его.
            // Просто логируем это, не создавая шума.
            console.log(`Could not send notification to ${telegramId}: User has not initiated conversation with the bot or blocked it.`);
        } else {
            // Все остальные ошибки - это непредвиденные проблемы
            console.error(`Failed to send notification to ${telegramId}. Error:`, error.message);
        }
    }
}

module.exports = { sendNotification };