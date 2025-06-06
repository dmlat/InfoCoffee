// backend/bot.js
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });
const TelegramBot = require('node-telegram-bot-api');
const pool = require('./db');
const moment = require('moment-timezone');
const { getFinancialSummary } = require('./utils/financials');
const { EXPENSE_INSTRUCTION, parseExpenseMessage } = require('./utils/botHelpers');

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const WEB_APP_URL = process.env.TELEGRAM_WEB_APP_URL;
const TIMEZONE = 'Europe/Moscow';

if (!TOKEN || !WEB_APP_URL) {
  console.error('FATAL ERROR: Bot Token or Web App URL is not set in .env file.');
  process.exit(1);
}

const bot = new TelegramBot(TOKEN, { polling: true });

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

const afterReportKeyboard = {
    reply_markup: {
        inline_keyboard: [
            [{ text: '📊 Другой период', callback_data: 'show_finances_menu' }, { text: '🔙 В меню', callback_data: 'main_menu' }]
        ]
    }
};

// Хранилище состояний пользователя
const userState = {};
const pendingYearClarifications = {};

// --- Вспомогательные функции ---
async function getUser(telegramId) {
    const ownerRes = await pool.query('SELECT id FROM users WHERE telegram_id = $1 AND vendista_api_token IS NOT NULL', [telegramId]);
    if (ownerRes.rows.length > 0) {
        return { type: 'owner', ownerUserId: ownerRes.rows[0].id };
    }
    const accessRes = await pool.query('SELECT owner_user_id, access_level FROM user_access_rights WHERE shared_with_telegram_id = $1', [telegramId]);
    if (accessRes.rows.length > 0 && accessRes.rows[0].access_level === 'admin') {
        return { type: 'admin', ownerUserId: accessRes.rows[0].owner_user_id };
    }
    return { type: 'unauthorized', ownerUserId: null };
}

const fNum = (num) => num.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

async function saveExpenses(chatId, ownerUserId, expenses) {
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
        bot.sendMessage(chatId, "❌ Произошла ошибка при записи расходов в базу данных. Попробуйте позже.");
        return false;
    } finally {
        client.release();
    }
}

const sendMainMenu = (chatId, text = 'Главное меню:') => {
    delete userState[chatId];
    bot.sendMessage(chatId, text, mainKeyboard);
};

// --- Обработчики команд ---
bot.onText(/\/start|\/menu/, (msg) => {
    sendMainMenu(msg.chat.id, `Добро пожаловать, ${msg.from.first_name}! ☕️`);
});

bot.onText(/\/app/, (msg) => {
    bot.sendMessage(msg.chat.id, 'Нажмите, чтобы запустить приложение 👇', {
        reply_markup: { inline_keyboard: [[{ text: '🚀 Открыть приложение', web_app: { url: WEB_APP_URL } }]] }
    });
});

bot.onText(/\/myid/, (msg) => {
    bot.sendMessage(msg.chat.id, `Ваш Telegram ID: \`${msg.from.id}\``, { parse_mode: 'Markdown' });
    setTimeout(() => sendMainMenu(msg.chat.id), 500);
});

// Главный обработчик текстовых сообщений
bot.on('message', async (msg) => {
    if (!msg.text || msg.text.startsWith('/')) return;

    const chatId = msg.chat.id;
    const telegramId = msg.from.id;

    const user = await getUser(telegramId);
    if (user.type === 'unauthorized') {
        return bot.sendMessage(chatId, 'У вас нет доступа. Пожалуйста, пройдите регистрацию или попросите владельца предоставить вам доступ.');
    }

    if (userState[chatId] === 'awaiting_expenses') {
        delete userState[chatId];
        
        const result = parseExpenseMessage(msg.text);

        if (!result.success) {
            bot.sendMessage(chatId, `❌ ${result.error || 'Неизвестная ошибка парсинга.'}`);
            return sendMainMenu(chatId, 'Попробуйте еще раз из главного меню.');
        }

        if (result.needsClarification) {
            pendingYearClarifications[chatId] = { expensesData: result.expensesData, monthIndex: result.monthIndex };
            const keyboard = {
                reply_markup: { inline_keyboard: [result.yearOptions.map(year => ({ text: `${result.month} ${year}`, callback_data: `clarify_year_${result.monthIndex}_${year}` }))] }
            };
            const currentMonthName = moment.tz(TIMEZONE).format('MMMM');
            bot.sendMessage(chatId, `Сейчас ${currentMonthName}, а ${result.month} еще не наступил. В какой год внести расходы?`, keyboard);
            return;
        }
        
        const saved = await saveExpenses(chatId, user.ownerUserId, result.expenses);
        if (saved) {
            const totalAmount = result.expenses.reduce((sum, e) => sum + e.amount, 0);
            bot.sendMessage(chatId, `✅ Расходы записаны.\n*Всего:* ${fNum(totalAmount)} ₽`, { parse_mode: 'Markdown' });
        }
        sendMainMenu(chatId);
    } else {
        sendMainMenu(chatId, 'Выберите действие из меню:');
    }
});

bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const messageId = query.message.message_id;
    const data = query.data;

    const user = await getUser(query.from.id);
    if (user.type === 'unauthorized') {
        return bot.answerCallbackQuery(query.id, { text: 'У вас нет доступа.', show_alert: true });
    }
    
    if (data.startsWith('clarify_year_')) {
        const pendingData = pendingYearClarifications[chatId];
        delete pendingYearClarifications[chatId];
        bot.deleteMessage(chatId, messageId).catch(() => {});

        if (!pendingData) {
            bot.sendMessage(chatId, '⏳ Эта сессия устарела. Пожалуйста, отправьте расходы заново.');
            return sendMainMenu(chatId);
        }

        const [, monthIndex, year] = data.split('_');
        const baseDate = moment().tz(TIMEZONE).year(year).month(monthIndex).startOf('month');
        const textToParse = pendingData.expensesData.join('\n');
        const result = parseExpenseMessage(textToParse);
        
        if (!result.success || result.expenses.length === 0) {
            bot.sendMessage(chatId, `❌ Ошибка при обработке расходов. ${result.error || ''}`);
            return sendMainMenu(chatId);
        }
        
        const expensesWithDate = result.expenses.map(e => ({ ...e, date: baseDate.toDate() }));
        const saved = await saveExpenses(chatId, user.ownerUserId, expensesWithDate);
        
        if (saved) {
            const totalAmount = expensesWithDate.reduce((sum, e) => sum + e.amount, 0);
            const monthName = moment(baseDate).format('MMMM YY');
            bot.sendMessage(chatId, `✅ Расходы записаны на *1 ${monthName}* г.\n*Всего:* ${fNum(totalAmount)} ₽`, { parse_mode: 'Markdown' });
        }
        return sendMainMenu(chatId);
    }
    
    switch (data) {
        case 'main_menu':
            bot.deleteMessage(chatId, messageId).catch(() => {});
            sendMainMenu(chatId);
            break;
        case 'enter_expense_mode':
            userState[chatId] = 'awaiting_expenses';
            bot.deleteMessage(chatId, messageId).catch(() => {});
            bot.sendMessage(chatId, EXPENSE_INSTRUCTION, { parse_mode: 'Markdown' })
                .then(() => bot.sendMessage(chatId, 'Теперь я жду ваше сообщение с расходами 👇'));
            break;
        case 'show_my_id':
            bot.deleteMessage(chatId, messageId).catch(() => {});
            bot.sendMessage(chatId, `Ваш Telegram ID: \`${query.from.id}\``, { parse_mode: 'Markdown' });
            sendMainMenu(chatId);
            break;
        case 'show_finances_menu':
            bot.editMessageText('📊 Выберите период для отчета:', { chat_id: chatId, message_id: messageId, ...financesKeyboard });
            break;
        default:
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
                    await bot.answerCallbackQuery(query.id, { text: 'Формирую отчет...' });
                    const summary = await getFinancialSummary(user.ownerUserId, from.format('YYYY-MM-DD HH:mm:ss'), to.format('YYYY-MM-DD HH:mm:ss'));
                    const reportText = `*Финансовые показатели ${periodName}:*\n\n📈 *Выручка:* ${fNum(summary.revenue)} ₽\n☕️ *Продажи:* ${summary.salesCount} шт.\n💳 *Эквайринг:* ${fNum(summary.acquiringCost)} ₽\n📉 *Расходы:* ${fNum(summary.expensesSum)} ₽\n🧾 *Налоги:* ${fNum(summary.taxCost)} ₽\n\n💰 *Чистая прибыль:* *${fNum(summary.netProfit)} ₽*`;
                    
                    bot.editMessageText(reportText, { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', ...afterReportKeyboard });
                } catch (err) {
                    console.error(`Error fetching financial summary for bot:`, err);
                    bot.answerCallbackQuery(query.id, { text: 'Ошибка получения данных.', show_alert: true });
                    sendMainMenu(chatId);
                }
            } else {
                bot.answerCallbackQuery(query.id);
            }
            break;
    }
});

bot.on('polling_error', (error) => console.error('[Bot Polling Error]', error));
console.log('Telegram Bot started and ready.');