// backend/bot.js
const TelegramBot = require('node-telegram-bot-api');
const db = require('./db'); // твой pool
const express = require('express');
const cors = require('cors');

const TOKEN = '7874124889:AAFyMIwz1QSRZVuoMIlMpBwPLYDfcvIUbuI'; // твой токен

const bot = new TelegramBot(TOKEN, { polling: true });

// Кнопка запуска Web App
const WEB_APP_URL = 'http://localhost:3000'; // локально

bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId,
    `Добро пожаловать в Финансовый Дашборд!\n\nНажмите кнопку ниже, чтобы открыть ваш личный кабинет.`,
    {
      reply_markup: {
        keyboard: [
          [{
            text: 'Открыть дашборд',
            web_app: { url: WEB_APP_URL }
          }]
        ],
        resize_keyboard: true
      }
    }
  );
});

// Запуск express для линковки Telegram <-> user_id
const app = express();
app.use(cors());
app.use(express.json());

app.post('/api/telegram/link', async (req, res) => {
  const { telegram_id, vendista_user_id } = req.body;
  if (!telegram_id || !vendista_user_id) return res.status(400).json({ error: 'no data' });

  try {
    await db.query('UPDATE users SET telegram_id = $1 WHERE id = $2', [telegram_id, vendista_user_id]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(3030, () => {
  console.log('Express для Telegram-линков запущен на 3030');
});
