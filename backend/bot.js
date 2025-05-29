// backend/bot.js
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') }); 
const TelegramBot = require('node-telegram-bot-api');
// const db = require('./db'); // db не используется напрямую в этой версии бота

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const WEB_APP_URL = process.env.TELEGRAM_WEB_APP_URL; // Например, https://твой_домен_фронтенда.ru

if (!TOKEN) {
  console.error('FATAL ERROR: Telegram Bot Token (TELEGRAM_BOT_TOKEN) is not set in .env file.');
  process.exit(1);
}
if (!WEB_APP_URL) {
  console.error('FATAL ERROR: Telegram Web App URL (TELEGRAM_WEB_APP_URL) is not set in .env file.');
  process.exit(1);
}

const bot = new TelegramBot(TOKEN, { polling: true });

bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  // const telegramUserId = msg.from.id; // Можно использовать для доп. логики или логирования

  console.log(`[Bot /start] Received from chat ID: ${chatId}, User ID: ${msg.from.id}`);
  
  bot.sendMessage(chatId,
    `Добро пожаловать в Финансовый Дашборд InfoCoffee.ru!\n\nНажмите кнопку ниже, чтобы открыть ваш личный кабинет.`,
    {
      reply_markup: {
        inline_keyboard: [ // Рекомендуется inline_keyboard для Web App кнопки
          [{
            text: 'Открыть дашборд',
            web_app: { url: WEB_APP_URL }
          }]
        ]
      }
    }
  );
});

// Слушаем ошибки поллинга
bot.on('polling_error', (error) => {
  console.error('[Bot Polling Error]', error.code, error.message || error);
  // ETELEGRAM: 401 Unauthorized - обычно проблема с токеном
  // ETELEGRAM: 409 Conflict - бот уже запущен где-то еще с этим токеном
});

bot.on('webhook_error', (error) => {
  console.error('[Bot Webhook Error]', error.code, error.message || error);
});

console.log('Telegram Bot started...');