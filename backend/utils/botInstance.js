// backend/utils/botInstance.js
console.log('[BOT INSTANCE] Initializing bot instance...');

const TelegramBot = require('node-telegram-bot-api');

const IS_DEV = process.env.NODE_ENV === 'development';
const TOKEN = IS_DEV ? process.env.DEV_TELEGRAM_BOT_TOKEN : process.env.TELEGRAM_BOT_TOKEN;

console.log(`[BOT INSTANCE] NODE_ENV: ${process.env.NODE_ENV}`);
console.log(`[BOT INSTANCE] IS_DEV: ${IS_DEV}`);
console.log(`[BOT INSTANCE] Looking for token: ${IS_DEV ? 'DEV_TELEGRAM_BOT_TOKEN' : 'TELEGRAM_BOT_TOKEN'}`);
console.log(`[BOT INSTANCE] Token present: ${!!TOKEN}`);

if (!TOKEN) {
  console.error('[BOT INSTANCE] FATAL ERROR: Bot Token is not set in .env file for the current environment.');
  console.error('[BOT INSTANCE] Creating bot stub to prevent crashes...');
  
  // Создаем объект-заглушку с основными методами
  const botStub = {
    onText: (regex, callback) => {
      console.warn(`[BOT STUB] onText called for regex: ${regex}, but bot is not initialized`);
      return botStub;
    },
    on: (event, callback) => {
      console.warn(`[BOT STUB] on called for event: ${event}, but bot is not initialized`);
      return botStub;
    },
    sendMessage: (chatId, text, options) => {
      console.warn(`[BOT STUB] sendMessage called for chat ${chatId}, but bot is not initialized`);
      return Promise.resolve({ message_id: -1 });
    },
    answerCallbackQuery: (callbackQueryId, options) => {
      console.warn(`[BOT STUB] answerCallbackQuery called, but bot is not initialized`);
      return Promise.resolve(true);
    },
    editMessageText: (text, options) => {
      console.warn(`[BOT STUB] editMessageText called, but bot is not initialized`);
      return Promise.resolve({ message_id: -1 });
    },
    editMessageReplyMarkup: (replyMarkup, options) => {
      console.warn(`[BOT STUB] editMessageReplyMarkup called, but bot is not initialized`);
      return Promise.resolve({ message_id: -1 });
    }
  };
  
  console.log('[BOT INSTANCE] Bot stub created successfully');
  module.exports = botStub;
} else {
  console.log('[BOT INSTANCE] Creating real bot instance...');
  try {
    const bot = new TelegramBot(TOKEN, { polling: false });
    console.log('[BOT INSTANCE] Real bot instance created successfully');
    module.exports = bot;
  } catch (error) {
    console.error('[BOT INSTANCE] Error creating bot instance:', error);
    // Fallback к заглушке если не удалось создать бота
    const botStub = {
      onText: (regex, callback) => {
        console.warn(`[BOT STUB FALLBACK] onText called but bot creation failed`);
        return botStub;
      },
      on: (event, callback) => {
        console.warn(`[BOT STUB FALLBACK] on called but bot creation failed`);
        return botStub;
      },
      sendMessage: () => Promise.resolve({ message_id: -1 }),
      answerCallbackQuery: () => Promise.resolve(true),
      editMessageText: () => Promise.resolve({ message_id: -1 }),
      editMessageReplyMarkup: () => Promise.resolve({ message_id: -1 })
    };
    module.exports = botStub;
  }
} 