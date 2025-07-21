// backend/utils/botInstance.js
const TelegramBot = require('node-telegram-bot-api');

const IS_DEV = process.env.NODE_ENV === 'development';
const TOKEN = IS_DEV ? process.env.DEV_TELEGRAM_BOT_TOKEN : process.env.TELEGRAM_BOT_TOKEN;

if (!TOKEN) {
  console.error('FATAL ERROR: Bot Token is not set in .env file for the current environment.');
  // В критической ситуации, когда токена нет, лучше остановить процесс,
  // чтобы избежать непредсказуемого поведения.
  process.exit(1);
}

const bot = new TelegramBot(TOKEN, { polling: false });

module.exports = bot; 