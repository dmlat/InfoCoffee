require('dotenv').config(); // Ensure dotenv is loaded to use process.env
const TelegramBot = require('node-telegram-bot-api');
const db = require('./db');
const express = require('express');
const cors = require('cors');

const TOKEN = process.env.TELEGRAM_BOT_TOKEN; // Use environment variable
if (!TOKEN) {
  console.error('Telegram Bot Token (TELEGRAM_BOT_TOKEN) is not set in .env file.');
  process.exit(1);
}

const bot = new TelegramBot(TOKEN, { polling: true });

const WEB_APP_URL = process.env.TELEGRAM_WEB_APP_URL || 'https://infocoffee.ru'; // Make WebApp URL configurable

bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  // You could check if the user (telegram_id) exists in your DB here
  // and customize the welcome message or registration flow.
  bot.sendMessage(chatId,
    `Добро пожаловать в Финансовый Дашборд InfoCoffee.ru!\n\nНажмите кнопку ниже, чтобы открыть ваш личный кабинет.`,
    {
      reply_markup: {
        inline_keyboard: [ // Changed to inline_keyboard for a cleaner look with Web App button
          [{
            text: 'Открыть дашборд',
            web_app: { url: WEB_APP_URL }
          }]
        ]
      }
    }
  );
});

// The Express app for /api/telegram/link might no longer be needed
// if user linking is handled by the main auth flow (/api/auth/telegram-login).
// Consider removing if redundant. If kept, ensure it's secure and necessary.
/*
const app = express();
app.use(cors());
app.use(express.json());

app.post('/api/telegram/link', async (req, res) => {
  const { telegram_id, internal_user_id } = req.body; // Renamed vendista_user_id for clarity
  if (!telegram_id || !internal_user_id) return res.status(400).json({ error: 'Missing telegram_id or internal_user_id' });

  try {
    // This assumes your 'users' table has 'id' as primary key and 'telegram_id' column
    await db.query('UPDATE users SET telegram_id = $1 WHERE id = $2', [telegram_id, internal_user_id]);
    res.json({ success: true, message: 'Telegram ID linked successfully.' });
  } catch (e) {
    console.error('Error linking Telegram ID:', e);
    res.status(500).json({ error: e.message });
  }
});

const LINKER_PORT = process.env.TELEGRAM_LINKER_PORT || 3030;
app.listen(LINKER_PORT, () => {
  console.log(`Express for Telegram ID linking running on ${LINKER_PORT}`);
});
*/
console.log('Telegram Bot started...');