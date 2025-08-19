// backend/utils/botInstance.js
const TelegramBot = require('node-telegram-bot-api');

const IS_DEV = process.env.NODE_ENV === 'development';
const TOKEN = IS_DEV ? process.env.DEV_TELEGRAM_BOT_TOKEN : process.env.TELEGRAM_BOT_TOKEN;

if (!TOKEN) {
  console.error('FATAL ERROR: Bot Token is not set in .env file for the current environment.');
  console.error(`NODE_ENV: ${process.env.NODE_ENV}`);
  console.error(`IS_DEV: ${IS_DEV}`);
  console.error(`Looking for: ${IS_DEV ? 'DEV_TELEGRAM_BOT_TOKEN' : 'TELEGRAM_BOT_TOKEN'}`);
  
  // ИСПРАВЛЕНИЕ: Вместо остановки процесса, создаем заглушку
  console.error('Creating bot stub to prevent crashes...');
  
  // Создаем объект-заглушку с основными методами
  const botStub = {
    onText: () => console.warn('[BOT STUB] onText called but bot is not initialized'),
    on: () => console.warn('[BOT STUB] on called but bot is not initialized'),
    sendMessage: () => Promise.resolve(console.warn('[BOT STUB] sendMessage called but bot is not initialized')),
    answerCallbackQuery: () => Promise.resolve(console.warn('[BOT STUB] answerCallbackQuery called but bot is not initialized')),
    editMessageText: () => Promise.resolve(console.warn('[BOT STUB] editMessageText called but bot is not initialized')),
    editMessageReplyMarkup: () => Promise.resolve(console.warn('[BOT STUB] editMessageReplyMarkup called but bot is not initialized'))
  };
  
  module.exports = botStub;
} else {
  const bot = new TelegramBot(TOKEN, { polling: false });
  module.exports = bot;
} 