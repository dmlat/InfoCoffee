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
            [{ text: '💸 Записать расходы', callback_data: 'quick_expense_info' }],
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
            [{ text: '🔙 Назад', callback_data: 'main_menu' }]
        ]
    }
};

const backToFinancesKeyboard = {
    reply_markup: {
        inline_keyboard: [[{ text: '📊 Другой период', callback_data: 'show_finances_menu' }, { text: '🔙 В меню', callback_data: 'main_menu' }]]
    }
};

// Хранилище для незавершенных операций
const pendingYearClarifications = {};

// --- Вспомогательные функции ---
async function getUser(telegramId) {
    const ownerRes = await pool.query('SELECT id FROM users WHERE telegram_id = $1 AND vendista_api_token IS NOT NULL', [telegramId]);
    if (ownerRes.rows.length > 0) {
        return { type: 'owner', ownerUserId: ownerRes.rows[0].id };
    }

    const accessRes = await pool.query('SELECT owner_user_id, access_level FROM user_access_rights WHERE shared_with_telegram_id = $1', [telegramId]);
    if (accessRes.rows.length > 0) {
        const { owner_user_id, access_level } = accessRes.rows[0];
        if (access_level === 'admin') {
            return { type: 'admin', ownerUserId: owner_user_id };
        }
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

// --- Обработчики команд ---
bot.onText(/\/start/, (msg) => {
    const welcomeText = `Добро пожаловать в сервис управления кофейным бизнесом InfoCoffee! ☕️\n\nИспользуйте меню ниже для навигации или просто отправьте мне расходы в свободном формате.`;
    bot.sendMessage(msg.chat.id, welcomeText, mainKeyboard);
});

bot.onText(/\/myid/, (msg) => {
    const chatId = msg.chat.id;
    const telegramId = msg.from.id;
    bot.sendMessage(chatId, `Ваш Telegram ID: \`${telegramId}\`\n\nНажмите кнопку ниже, чтобы быстро поделиться им.`, {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [[{ text: '📲 Поделиться ID', switch_inline_query: String(telegramId) }]]
        }
    });
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

    const result = parseExpenseMessage(msg.text);

    if (!result.success) {
        if (result.error) {
            bot.sendMessage(chatId, `❌ ${result.error}\n\n${EXPENSE_INSTRUCTION}`, { parse_mode: 'Markdown' });
        } else {
            bot.sendMessage(chatId, "Не удалось распознать формат. Выберите действие из меню:", mainKeyboard);
        }
        return;
    }

    if (result.needsClarification) {
        pendingYearClarifications[chatId] = {
            expensesData: result.expensesData,
            monthIndex: result.monthIndex
        };
        const keyboard = {
            reply_markup: {
                inline_keyboard: [
                    result.yearOptions.map(year => ({
                        text: `${result.month} ${year}`,
                        callback_data: `clarify_year_${result.monthIndex}_${year}`
                    }))
                ]
            }
        };
        const currentMonthName = moment.tz(TIMEZONE).format('MMMM');
        bot.sendMessage(chatId, `Сейчас ${currentMonthName}, а ${result.month} еще не наступил. В какой год внести расходы?`, keyboard);
        return;
    }

    if (result.expenses.length > 0) {
        const saved = await saveExpenses(chatId, user.ownerUserId, result.expenses);
        if (saved) {
            let totalAmount = result.expenses.reduce((sum, e) => sum + e.amount, 0);
            let successMessage = `✅ Записаны расходы на *${moment(result.expenses[0].date).format('DD.MM.YYYY')}*:\n\n`;
            if (result.expenses.length > 1) {
                 successMessage = `✅ Записаны расходы:\n\n`;
            }
            
            result.expenses.forEach(e => {
                successMessage += `— *${fNum(e.amount)} ₽* ${e.comment ? `(${e.comment})` : ''}\n`;
            });

            if (result.expenses.length > 1) {
                 successMessage += `\n*Всего:* ${fNum(totalAmount)} ₽`;
            }

            bot.sendMessage(chatId, successMessage, { parse_mode: 'Markdown' });
        }
    }
});


bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const messageId = query.message.message_id;
    const data = query.data;
    
    // Обработка уточнения года
    if (data.startsWith('clarify_year_')) {
        const pendingData = pendingYearClarifications[chatId];
        if (!pendingData) {
            bot.editMessageText('⏳ Эта сессия устарела. Пожалуйста, отправьте расходы заново.', { chat_id: chatId, message_id: messageId });
            return bot.answerCallbackQuery(query.id);
        }

        const [, monthIndex, year] = data.split('_');
        const baseDate = moment().tz(TIMEZONE).year(year).month(monthIndex).startOf('month');
        
        // Снова парсим, но теперь только строки с расходами, без заголовка
        const textToParse = pendingData.expensesData.join('\n');
        const result = parseExpenseMessage(textToParse);
        
        if (!result.success || result.expenses.length === 0) {
            bot.editMessageText(`❌ Ошибка при обработке расходов. ${result.error || ''}`, { chat_id: chatId, message_id: messageId });
            delete pendingYearClarifications[chatId];
            return bot.answerCallbackQuery(query.id);
        }
        
        const user = await getUser(query.from.id);
        if (user.type === 'unauthorized') {
            bot.editMessageText('У вас больше нет доступа.', { chat_id: chatId, message_id: messageId });
            return bot.answerCallbackQuery(query.id);
        }

        const expensesWithDate = result.expenses.map(e => ({ ...e, date: baseDate.toDate() }));
        
        const saved = await saveExpenses(chatId, user.ownerUserId, expensesWithDate);
        if (saved) {
            const totalAmount = expensesWithDate.reduce((sum, e) => sum + e.amount, 0);
            const monthName = moment(baseDate).format('MMMM YYYY');
            const successMessage = `✅ Расходы записаны на *1 ${monthName}* г.\n\n*Всего:* ${fNum(totalAmount)} ₽`;
            bot.editMessageText(successMessage, { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown' });
        }
        delete pendingYearClarifications[chatId];
        return bot.answerCallbackQuery(query.id);
    }
    
    const user = await getUser(query.from.id);
    if (user.type === 'unauthorized') {
        return bot.answerCallbackQuery(query.id, { text: 'У вас нет доступа.', show_alert: true });
    }

    if (data === 'main_menu') {
        bot.editMessageText('Главное меню:', { chat_id: chatId, message_id: messageId, ...mainKeyboard });
    } else if (data === 'quick_expense_info') {
        bot.editMessageText(EXPENSE_INSTRUCTION, { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'main_menu' }]] } });
    } else if (data === 'show_my_id') {
        const idText = `Ваш Telegram ID: \`${query.from.id}\`\n\nНажмите кнопку ниже, чтобы быстро поделиться им с владельцем аккаунта.`;
        bot.editMessageText(idText, { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '📲 Поделиться ID', switch_inline_query: String(query.from.id) }], [{ text: '🔙 Назад', callback_data: 'main_menu' }]]}});
    } else if (data === 'show_finances_menu') {
        bot.editMessageText('📊 Выберите период для отчета:', { chat_id: chatId, message_id: messageId, ...financesKeyboard });
    } else if (data.startsWith('get_finances_')) {
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
            
            bot.editMessageText(reportText, { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', ...backToFinancesKeyboard });

        } catch (err) {
            console.error(`Error fetching financial summary for bot:`, err);
            bot.answerCallbackQuery(query.id, { text: 'Ошибка получения данных', show_alert: true });
        }
    } else {
        bot.answerCallbackQuery(query.id);
    }
});


bot.on('polling_error', (error) => console.error('[Bot Polling Error]', error.code, error.message || error));
bot.on('webhook_error', (error) => console.error('[Bot Webhook Error]', error.code, error.message || error));

console.log('Telegram Bot started and ready.');