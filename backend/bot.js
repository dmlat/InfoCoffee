// backend/bot.js
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });
const TelegramBot = require('node-telegram-bot-api');
const pool = require('./db');
const moment = require('moment-timezone');
const { getFinancialSummary } = require('./utils/financials');
const { parseExpenseMessage } = require('./utils/botHelpers');

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const WEB_APP_URL = process.env.TELEGRAM_WEB_APP_URL;
const TIMEZONE = 'Europe/Moscow';

if (!TOKEN || !WEB_APP_URL) {
  console.error('FATAL ERROR: Bot Token or Web App URL is not set in .env file.');
  process.exit(1);
}

const bot = new TelegramBot(TOKEN, { polling: true });

// --- Глобальное состояние ---
const userState = {}; // chatId -> { lastBotMessageId, mode }
const pendingYearClarifications = {};

// --- Главное меню и клавиатуры ---
const mainMenuText = `Добро пожаловать в сервис управления кофейным бизнесом InfoCoffee! ☕️

Используйте меню ниже для навигации или просто отправьте мне расходы в свободном формате.
`;

const mainKeyboard = {
  inline_keyboard: [
    [{ text: '🚀 Открыть приложение', web_app: { url: WEB_APP_URL } }],
    [{ text: '💸 Записать расходы', callback_data: 'enter_expense_mode' }],
    [{ text: '📊 Финансы', callback_data: 'show_finances_menu' }],
    [{ text: '🆔 Показать ID', callback_data: 'show_my_id' }]
  ]
};

const financesKeyboard = {
  inline_keyboard: [
    [
      { text: '📅 Сегодня', callback_data: 'get_finances_today' },
      { text: '🕰️ Вчера', callback_data: 'get_finances_yesterday' }
    ],
    [
      { text: '📈 С начала недели', callback_data: 'get_finances_week' },
      { text: '📉 С начала месяца', callback_data: 'get_finances_month' }
    ],
    [
      { text: '7️⃣ За 7 дней', callback_data: 'get_finances_7_days' },
      { text: '3️⃣0️⃣ За 30 дней', callback_data: 'get_finances_30_days' }
    ],
    [
      { text: '🏁 С начала года', callback_data: 'get_finances_year' }
    ],
    [
      { text: '🔙 Главное меню', callback_data: 'main_menu' }
    ]
  ]
};

const expenseBackKeyboard = {
  inline_keyboard: [
    [{ text: '🔙 Назад', callback_data: 'main_menu' }]
  ]
};

// --- Сокращённая инструкция по расходам ---
const EXPENSE_INSTRUCTION = `💸 Чтобы быстро записать расходы, отправьте сообщение боту:

1️⃣ *Сумма + Дата + Комментарий*:
\`\`\`
150,05
5000 01.06 Аренда
3200 01.06
\`\`\`
- Сумма, Дата, Комментарий через пробел
- Сумму можно с копейками и без
- Комментарий не обязателен
- Если без даты, то запишется за сегодня
- Можно несколько расходов за разные даты (1 строка — 1 расход)

2️⃣ *Несколько расходов за один день/месяц:*
\`\`\`
05.06.2025
3000
4000 бензин
\`\`\`
Все расходы будут записаны на 5 июня 2025

\`\`\`
Август
7000
1250,50 закупка
\`\`\`
Все расходы будут записаны на 1 августа
`;

// --- Вспомогательные функции ---

// Удаляет последнее служебное сообщение бота (если есть)
async function deleteLastBotMessage(chatId) {
  if (userState[chatId] && userState[chatId].lastBotMessageId) {
    try { await bot.deleteMessage(chatId, userState[chatId].lastBotMessageId); } catch {}
    userState[chatId].lastBotMessageId = null;
  }
}

// Сохраняет message_id последнего служебного сообщения бота
function rememberBotMessage(chatId, messageId, mode = null) {
  userState[chatId] = userState[chatId] || {};
  userState[chatId].lastBotMessageId = messageId;
  if (mode) userState[chatId].mode = mode;
  else delete userState[chatId].mode;
}

// Права пользователя
async function getUser(telegramId) {
  const ownerRes = await pool.query('SELECT id FROM users WHERE telegram_id = $1 AND vendista_api_token IS NOT NULL', [telegramId]);
  if (ownerRes.rows.length > 0) return { type: 'owner', ownerUserId: ownerRes.rows[0].id };

  const accessRes = await pool.query('SELECT owner_user_id, access_level FROM user_access_rights WHERE shared_with_telegram_id = $1', [telegramId]);
  if (accessRes.rows.length > 0 && accessRes.rows[0].access_level === 'admin') {
    return { type: 'admin', ownerUserId: accessRes.rows[0].owner_user_id };
  }
  return { type: 'unauthorized', ownerUserId: null };
}

const fNum = (num) => Number(num || 0).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

async function saveExpenses(ownerUserId, expenses) {
  const client = await pool.pool.connect();
  try {
    await client.query('BEGIN');
    for (const exp of expenses) {
      await client.query(
        `INSERT INTO expenses (user_id, amount, expense_time, comment) VALUES ($1, $2, $3, $4)`,
        [ownerUserId, exp.amount, exp.date, exp.comment]
      );
    }
    await client.query('COMMIT');
    return true;
  } catch (dbErr) {
    await client.query('ROLLBACK');
    console.error("DB Error on saving expenses:", dbErr);
    return false;
  } finally {
    client.release();
  }
}

// --- Главное меню ---
async function sendMainMenu(chatId) {
  await deleteLastBotMessage(chatId);
  const sent = await bot.sendMessage(chatId, mainMenuText, { reply_markup: mainKeyboard, parse_mode: 'Markdown' });
  rememberBotMessage(chatId, sent.message_id);
}

// --- Команды ---
bot.onText(/\/start|\/menu/, async (msg) => {
  await sendMainMenu(msg.chat.id);
});

bot.onText(/\/app/, async (msg) => {
  await deleteLastBotMessage(msg.chat.id);
  const sent = await bot.sendMessage(msg.chat.id, 'Нажмите, чтобы запустить приложение 👇', {
    reply_markup: { inline_keyboard: [[{ text: '🚀 Открыть приложение', web_app: { url: WEB_APP_URL } }]] }
  });
  rememberBotMessage(msg.chat.id, sent.message_id);
});

bot.onText(/\/myid/, async (msg) => {
  await showIdMenu(msg.chat.id, msg.from.id);
});

// --- Показ ID с двумя кнопками ---
async function showIdMenu(chatId, telegramId) {
  await deleteLastBotMessage(chatId);
  const sent = await bot.sendMessage(
    chatId,
    `\`${telegramId}\``,
    {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [
            { text: 'Меню', callback_data: 'main_menu' },
            { text: 'Отправить', switch_inline_query: String(telegramId) }
          ]
        ]
      }
    }
  );
  rememberBotMessage(chatId, sent.message_id, 'show_id');
}

// --- Текстовые сообщения (ввод расходов, либо всё остальное) ---
bot.on('message', async (msg) => {
  if (!msg.text || msg.text.startsWith('/')) return;

  const chatId = msg.chat.id;
  const telegramId = msg.from.id;

  const user = await getUser(telegramId);
  if (user.type === 'unauthorized') {
    await deleteLastBotMessage(chatId);
    const sent = await bot.sendMessage(chatId, 'У вас нет доступа. Пожалуйста, пройдите регистрацию или попросите владельца предоставить вам доступ.');
    rememberBotMessage(chatId, sent.message_id);
    return;
  }

  // --- Режим "ввод расходов" ---
  if (userState[chatId] && userState[chatId].mode === 'awaiting_expenses') {
    const result = parseExpenseMessage(msg.text);
    userState[chatId].mode = null;

    if (!result.success) {
      await deleteLastBotMessage(chatId);
      const sent = await bot.sendMessage(chatId, `❌ ${result.error}`);
      rememberBotMessage(chatId, sent.message_id, 'awaiting_expenses');
      return;
    }

    const saved = await saveExpenses(user.ownerUserId, result.expenses);
    await deleteLastBotMessage(chatId);
    if (saved) {
      let totalAmount = result.expenses.reduce((sum, e) => sum + e.amount, 0);
      const successMessage = `✅ Расходы записаны.\n*Всего:* ${fNum(totalAmount)} ₽`;
      const sent = await bot.sendMessage(chatId, successMessage, { parse_mode: 'Markdown' });
      rememberBotMessage(chatId, sent.message_id);
    } else {
      const sent = await bot.sendMessage(chatId, '❌ Не удалось сохранить расходы. Попробуйте позже.');
      rememberBotMessage(chatId, sent.message_id);
    }
    await sendMainMenu(chatId);
    return;
  }

  // --- Любое другое сообщение — выводим главное меню ---
  await sendMainMenu(chatId);
});

// --- Callback-кнопки ---
bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const telegramId = query.from.id;
  const data = query.data;

  const user = await getUser(telegramId);
  if (user.type === 'unauthorized') {
    await bot.answerCallbackQuery(query.id, { text: 'У вас нет доступа.', show_alert: true });
    await deleteLastBotMessage(chatId);
    const sent = await bot.sendMessage(chatId, 'У вас нет доступа. Пожалуйста, пройдите регистрацию или попросите владельца предоставить вам доступ.');
    rememberBotMessage(chatId, sent.message_id);
    return;
  }

  // Удаляем последнее служебное сообщение (меню/инструкция/отчёт)
  await deleteLastBotMessage(chatId);

  // --- Главное меню ---
  if (data === 'main_menu') {
    await sendMainMenu(chatId);
    return;
  }

  // --- Показ ID (отдельная клавиатура) ---
  if (data === 'show_my_id') {
    await showIdMenu(chatId, telegramId);
    return;
  }

  // --- "Отправить" ID — сразу возвращаем в главное меню (логика передачи в Telegram через switch_inline_query — кнопка) ---
  // Нет отдельной callback, просто нажатие по switch_inline_query,
  // поэтому после нажатия кнопки «Отправить» юзер сам выбирает получателя, а меню никуда не девается.
  // После инлайн-отправки возвращать меню не надо — Telegram сам скроет меню при отправке.

  // --- Ввод расходов ---
  if (data === 'enter_expense_mode') {
    userState[chatId] = userState[chatId] || {};
    userState[chatId].mode = 'awaiting_expenses';
    const sent = await bot.sendMessage(chatId, EXPENSE_INSTRUCTION, {
      parse_mode: 'Markdown',
      reply_markup: expenseBackKeyboard
    });
    rememberBotMessage(chatId, sent.message_id, 'awaiting_expenses');
    return;
  }

  // --- Финансы ---
  if (data === 'show_finances_menu') {
    const sent = await bot.sendMessage(chatId, '📊 Выберите период для отчёта:', {
      reply_markup: financesKeyboard
    });
    rememberBotMessage(chatId, sent.message_id, 'finances_menu');
    return;
  }

  if (data.startsWith('get_finances_')) {
    const periodKey = data.replace('get_finances_', '');
    const now = moment().tz(TIMEZONE);
    let from, to, periodName;

    switch (periodKey) {
      case 'today': from = now.clone().startOf('day'); to = now.clone().endOf('day'); periodName = "за сегодня"; break;
      case 'yesterday': from = now.clone().subtract(1, 'days').startOf('day'); to = now.clone().subtract(1, 'days').endOf('day'); periodName = "за вчера"; break;
      case 'week': from = now.clone().startOf('week'); to = now.clone().endOf('day'); periodName = "с начала недели"; break;
      case 'month': from = now.clone().startOf('month'); to = now.clone().endOf('day'); periodName = "с начала месяца"; break;
      case '7_days': from = now.clone().subtract(6, 'days').startOf('day'); to = now.clone().endOf('day'); periodName = "за последние 7 дней"; break;
      case '30_days': from = now.clone().subtract(29, 'days').startOf('day'); to = now.clone().endOf('day'); periodName = "за последние 30 дней"; break;
      case 'year': from = now.clone().startOf('year'); to = now.clone().endOf('day'); periodName = "с начала года"; break;
      default: return bot.answerCallbackQuery(query.id);
    }

    try {
      await bot.answerCallbackQuery(query.id, { text: 'Формирую отчёт...' });
      const summary = await getFinancialSummary(user.ownerUserId, from.format('YYYY-MM-DD HH:mm:ss'), to.format('YYYY-MM-DD HH:mm:ss'));
      const reportText = `*Финансовые показатели ${periodName}:*\n\n` +
        `📈 *Выручка:* ${fNum(summary.revenue)} ₽\n` +
        `☕️ *Продажи:* ${summary.salesCount} шт.\n` +
        `💳 *Эквайринг:* ${fNum(summary.acquiringCost)} ₽\n` +
        `📉 *Расходы:* ${fNum(summary.expensesSum)} ₽\n` +
        `🧾 *Налоги:* ${fNum(summary.taxCost)} ₽\n\n` +
        `💰 *Чистая прибыль:* *${fNum(summary.netProfit)} ₽*`;

      const sent = await bot.sendMessage(chatId, reportText, { parse_mode: 'Markdown' });
      rememberBotMessage(chatId, sent.message_id);
    } catch (err) {
      console.error(`Error fetching financial summary for bot:`, err);
      const sent = await bot.sendMessage(chatId, "❌ Не удалось получить данные. Попробуйте позже.");
      rememberBotMessage(chatId, sent.message_id);
    }
    await sendMainMenu(chatId);
    return;
  }

  // --- Назад с инструкции по расходам ---
  if (data === 'back_to_menu' || data === 'expense_back' || data === 'main_menu') {
    await sendMainMenu(chatId);
    return;
  }

  // Неизвестное действие — главное меню (на всякий случай)
  await sendMainMenu(chatId);
});

// --- Ошибки ---
bot.on('polling_error', (error) => console.error('[Bot Polling Error]', error.code, error.message || error));
bot.on('webhook_error', (error) => console.error('[Bot Webhook Error]', error.code, error.message || error));

console.log('Telegram Bot started and ready.');
