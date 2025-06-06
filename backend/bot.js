// backend/bot.js
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });
const TelegramBot = require('node-telegram-bot-api');
const pool = require('./db');
const moment = require('moment-timezone');
const { getFinancialSummary } = require('./utils/financials');
// EXPENSE_INSTRUCTION будет заменен на локальную константу, поэтому импорт можно убрать или изменить
const { parseExpenseMessage } = require('./utils/botHelpers');

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const WEB_APP_URL = process.env.TELEGRAM_WEB_APP_URL;
const TIMEZONE = 'Europe/Moscow';

if (!TOKEN || !WEB_APP_URL) {
    console.error('FATAL ERROR: Bot Token or Web App URL is not set in .env file.');
    process.exit(1);
}

const bot = new TelegramBot(TOKEN, { polling: true });

// --- Текстовые константы ---
const MAIN_MENU_TEXT = 'Добро пожаловать в сервис управления кофейным бизнесом InfoCoffee! ☕️\n\nИспользуйте меню ниже для навигации или просто отправьте мне расходы в свободном формате.';

const NEW_EXPENSE_INSTRUCTION = `💸 *Чтобы быстро записать расходы, отправьте сообщение боту:*\n
*1️⃣ Сумма + Дата + Комментарий:*
- Сумма, Дата, Комментарий через пробел
- Сумму можно с копейками и без
- Комментарий не обязателен
- Если без даты, то запишется за сегодня
- Можно несколько расходов за разные даты
- 1 расход = 1 строка, всё в одно сообщение
\`\`\`
150,05
5000 01.06 Аренда
3200 01.06
\`\`\`

*2️⃣ Несколько расходов за один день/месяц:*
- напишите день / месяц первой строкой
\`\`\`
05.06.2025
3000
4000 бензин
\`\`\`
_Все расходы будут записаны на 5 июня 2025_

\`\`\`
Август
7000
1250,50 закупка
\`\`\`
_Все расходы будут записаны на 1 августа_`;


// --- Клавиатуры ---
const mainKeyboard = {
    reply_markup: {
        inline_keyboard: [
            [{ text: '🚀 Открыть приложение', web_app: { url: WEB_APP_URL } }],
            [{ text: '💸 Записать расходы', callback_data: 'enter_expense_mode' }],
            [{ text: '📊 Финансы', callback_data: 'show_finances_menu' }],
            [{ text: '🆔 Показать ID', callback_data: 'show_my_id' }]
        ]
    }
};

const financesKeyboard = {
    reply_markup: {
        inline_keyboard: [
            [{ text: '📅 Сегодня', callback_data: 'get_finances_today' }, { text: '🕰️ Вчера', callback_data: 'get_finances_yesterday' }],
            [{ text: '📈 С начала недели', callback_data: 'get_finances_week' }, { text: '📉 С начала месяца', callback_data: 'get_finances_month' }],
            [{ text: '7️⃣ За 7 дней', callback_data: 'get_finances_7_days' }, { text: '3️⃣0️⃣ За 30 дней', callback_data: 'get_finances_30_days' }],
            [{ text: '🏁 С начала года', callback_data: 'get_finances_year' }],
            [{ text: '🔙 Назад в меню', callback_data: 'main_menu' }]
        ]
    }
};

// Клавиатура для показа ID с кнопкой "Отправить"
const showIdKeyboard = (userId) => ({
    reply_markup: {
        inline_keyboard: [
            [{ text: '📤 Отправить', switch_inline_query: `${userId}` }],
            [{ text: '🔙 Назад в меню', callback_data: 'main_menu' }]
        ]
    }
});

// Клавиатура с одной кнопкой "Назад в меню"
const backToMenuKeyboard = {
    reply_markup: {
        inline_keyboard: [
            [{ text: '🔙 Назад в меню', callback_data: 'main_menu' }]
        ]
    }
};

// --- Состояния ---
const userState = {};
const pendingYearClarifications = {};

// --- Вспомогательные функции ---
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
    const client = await pool.connect(); // Используем pool.connect() из pg
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

// --- Обработчики команд ---
const sendMainMenu = (chatId) => {
    bot.sendMessage(chatId, MAIN_MENU_TEXT, mainKeyboard);
};

bot.onText(/\/start|\/menu/, (msg) => {
    sendMainMenu(msg.chat.id);
});

bot.onText(/\/app/, (msg) => {
    bot.sendMessage(msg.chat.id, 'Нажмите, чтобы запустить приложение 👇', {
        reply_markup: { inline_keyboard: [[{ text: '🚀 Открыть приложение', web_app: { url: WEB_APP_URL } }]] }
    });
});

bot.onText(/\/myid/, (msg) => {
    bot.sendMessage(msg.chat.id, `Ваш Telegram ID: \`${msg.from.id}\``, { parse_mode: 'Markdown' });
});

// --- Главный обработчик текстовых сообщений ---
bot.on('message', async (msg) => {
    // Игнорируем команды, так как для них есть отдельные обработчики
    if (!msg.text || msg.text.startsWith('/')) return;

    const chatId = msg.chat.id;
    const telegramId = msg.from.id;

    const user = await getUser(telegramId);
    if (user.type === 'unauthorized') {
        return bot.sendMessage(chatId, 'У вас нет доступа. Пожалуйста, пройдите регистрацию или попросите владельца предоставить вам доступ.');
    }

    // Обрабатываем сообщение как расход, если пользователь в режиме ввода или просто прислал текст
    const result = parseExpenseMessage(msg.text);

    // Если парсер не вернул успешный результат, это может быть обычное сообщение.
    // Если пользователь не в явном режиме ожидания расходов, просто показываем меню.
    if (!result.success) {
        if (userState[chatId] === 'awaiting_expenses') {
             bot.sendMessage(chatId, `❌ ${result.error}`);
        }
        // В любом случае, если формат не распознан, отправляем главное меню
        return sendMainMenu(chatId);
    }
    
    // Если все успешно распознано, сохраняем
    delete userState[chatId];

    const saved = await saveExpenses(user.ownerUserId, result.expenses);
    if (saved) {
        let totalAmount = result.expenses.reduce((sum, e) => sum + e.amount, 0);
        const successMessage = `✅ Расходы записаны.\n*Всего:* ${fNum(totalAmount)} ₽`;
        bot.sendMessage(chatId, successMessage, { parse_mode: 'Markdown' });
    } else {
        bot.sendMessage(chatId, '❌ Не удалось сохранить расходы. Попробуйте позже.');
    }
    // После любой попытки записи расходов возвращаем в главное меню
    sendMainMenu(chatId);
});


// --- Обработчик callback-кнопок ---
bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const messageId = query.message.message_id;
    const data = query.data;

    // Сначала проверяем доступ
    const user = await getUser(query.from.id);
    if (user.type === 'unauthorized') {
        await bot.answerCallbackQuery(query.id, { text: 'У вас нет доступа.', show_alert: true });
        // Удаляем клавиатуру у сообщения, чтобы избежать повторных нажатий
        return bot.editMessageReplyMarkup({}, { chat_id: chatId, message_id: messageId });
    }
    
    // Удаляем предыдущее сообщение, чтобы имитировать навигацию по меню
    bot.deleteMessage(chatId, messageId).catch(() => {});

    // --- Годовые уточнения (если используешь в parseExpenseMessage подобную механику) ---
    if (data && data.startsWith('clarify_year_')) {
        // ... (эта логика остается без изменений)
    }

    // --- Навигация по меню ---
    if (data === 'main_menu') {
        sendMainMenu(chatId);
    } else if (data === 'enter_expense_mode') {
        userState[chatId] = 'awaiting_expenses';
        bot.sendMessage(chatId, NEW_EXPENSE_INSTRUCTION, { parse_mode: 'Markdown', ...backToMenuKeyboard });
    } else if (data === 'show_my_id') {
        const userId = query.from.id;
        bot.sendMessage(chatId, `${userId}`, showIdKeyboard(userId));
    } else if (data === 'show_finances_menu') {
        bot.sendMessage(chatId, '📊 Выберите период для отчета:', financesKeyboard);
    } else if (data.startsWith('get_finances_')) {
        const periodKey = data.replace('get_finances_', '');
        const now = moment().tz(TIMEZONE);
        let from, to, periodName;

        switch (periodKey) {
            case 'today':
                from = now.clone().startOf('day'); to = now.clone().endOf('day'); periodName = "за сегодня"; break;
            case 'yesterday':
                from = now.clone().subtract(1, 'days').startOf('day'); to = now.clone().subtract(1, 'days').endOf('day'); periodName = "за вчера"; break;
            case 'week':
                from = now.clone().startOf('week'); to = now.clone().endOf('day'); periodName = "с начала недели"; break;
            case 'month':
                from = now.clone().startOf('month'); to = now.clone().endOf('day'); periodName = "с начала месяца"; break;
            case '7_days':
                from = now.clone().subtract(6, 'days').startOf('day'); to = now.clone().endOf('day'); periodName = "за последние 7 дней"; break;
            case '30_days':
                from = now.clone().subtract(29, 'days').startOf('day'); to = now.clone().endOf('day'); periodName = "за последние 30 дней"; break;
            case 'year':
                from = now.clone().startOf('year'); to = now.clone().endOf('day'); periodName = "с начала года"; break;
            default:
                return bot.answerCallbackQuery(query.id);
        }

        try {
            await bot.answerCallbackQuery(query.id, { text: 'Формирую отчет...' });
            const summary = await getFinancialSummary(user.ownerUserId, from.format('YYYY-MM-DD HH:mm:ss'), to.format('YYYY-MM-DD HH:mm:ss'));
            const reportText = `*Финансовые показатели ${periodName}:*\n\n` +
                `📈 *Выручка:* ${fNum(summary.revenue)} ₽\n` +
                `☕️ *Продажи:* ${summary.salesCount} шт.\n` +
                `💳 *Эквайринг:* ${fNum(summary.acquiringCost)} ₽\n` +
                `📉 *Расходы:* ${fNum(summary.expensesSum)} ₽\n` +
                `🧾 *Налоги:* ${fNum(summary.taxCost)} ₽\n\n` +
                `💰 *Чистая прибыль:* *${fNum(summary.netProfit)} ₽*`;

            await bot.sendMessage(chatId, reportText, { parse_mode: 'Markdown' });
        } catch (err) {
            console.error(`Error fetching financial summary for bot:`, err);
            await bot.sendMessage(chatId, "❌ Не удалось получить данные. Попробуйте позже.");
        }
        // После показа отчета всегда возвращаем в главное меню
        sendMainMenu(chatId);
    } else {
        bot.answerCallbackQuery(query.id);
    }
});


// --- Ошибки ---
bot.on('polling_error', (error) => console.error('[Bot Polling Error]', error.code, error.message || error));
bot.on('webhook_error', (error) => console.error('[Bot Webhook Error]', error.code, error.message || error));

console.log('Telegram Bot started and ready.');