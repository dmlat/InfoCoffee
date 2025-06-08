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

// --- РЕГИСТРАЦИЯ КОМАНД ДЛЯ МЕНЮ TELEGRAM ---
bot.setMyCommands([
    { command: '/start', description: '🚀 Запустить/Перезапустить бота' },
    { command: '/menu', description: '📋 Показать главное меню' },
    { command: '/app', description: '📱 Открыть веб-приложение' },
    { command: '/myid', description: '🆔 Показать мой Telegram ID' },
    { command: '/finances', description: '📊 Открыть меню финансов' },
    { command: '/expenses', description: '💸 Быстро записать расходы' },
]);


// --- Клавиатуры ---

const authorizedKeyboard = {
    reply_markup: {
        inline_keyboard: [
            [{ text: '🚀 Открыть приложение', web_app: { url: WEB_APP_URL } }],
            [{ text: '💸 Записать расходы', callback_data: 'enter_expense_mode' }],
            [{ text: '📊 Финансы', callback_data: 'show_finances_menu' }],
            [{ text: '🆔 Мой ID', callback_data: 'show_my_id' }]
        ]
    }
};

const unauthorizedKeyboard = {
    reply_markup: {
        inline_keyboard: [
            [{ text: '🚀 Открыть приложение', web_app: { url: WEB_APP_URL } }],
            [{ text: '🆔 Мой ID', callback_data: 'show_my_id' }]
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
            [{ text: '🔙 В меню', callback_data: 'main_menu' }]
        ]
    }
};

const afterReportKeyboard = {
    reply_markup: {
        inline_keyboard: [
            [{ text: '📊 Другой период', callback_data: 'show_finances_menu' }],
            [{ text: '🔙 В меню', callback_data: 'main_menu' }]
        ]
    }
};

const backToMenuKeyboard = {
    reply_markup: {
        inline_keyboard: [
            [{ text: '🔙 В меню', callback_data: 'main_menu' }]
        ]
    }
};

// Хранилище состояний и сообщений для очистки
const userState = {};

// --- Вспомогательные функции ---

/**
 * Определяет статус пользователя (владелец, админ, неавторизован).
 * @param {number} telegramId - ID пользователя в Telegram.
 * @returns {Promise<object>} Объект с типом доступа и ID владельца.
 */
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

/**
 * Безопасно удаляет предыдущие сообщения (ошибки, инструкции) из чата.
 * @param {number} chatId - ID чата.
 */
async function cleanupMessages(chatId) {
    if (userState[chatId]?.cleanupMessageIds?.length > 0) {
        for (const msgId of userState[chatId].cleanupMessageIds) {
            await bot.deleteMessage(chatId, msgId).catch(() => {});
        }
        userState[chatId].cleanupMessageIds = [];
    }
}

/**
 * Отправляет динамическое главное меню в зависимости от статуса пользователя.
 * @param {number} chatId - ID чата.
 * @param {object} from - Объект пользователя Telegram.
 * @param {number|null} messageId - ID сообщения для редактирования (если есть).
 */
async function sendDynamicMainMenu(chatId, from, messageId = null) {
    await cleanupMessages(chatId); // Очищаем предыдущие сообщения перед показом меню
    const user = await getUser(from.id);
    let text;
    let keyboard;

    if (user.type === 'owner' || user.type === 'admin') {
        text = 'Главное меню:';
        keyboard = authorizedKeyboard;
    } else {
        text = `Добро пожаловать, ${from.first_name}! ☕️\n\nЯ — бот для аналитики ваших кофеен. Чтобы начать, откройте приложение и пройдите регистрацию.`;
        keyboard = unauthorizedKeyboard;
    }

    if (messageId) {
        await bot.editMessageText(text, { chat_id: chatId, message_id: messageId, ...keyboard }).catch(() => {
            // Если редактирование не удалось (например, сообщение слишком старое), отправляем новое
            bot.sendMessage(chatId, text, keyboard);
        });
    } else {
        await bot.sendMessage(chatId, text, keyboard);
    }
    delete userState[chatId]; // Сбрасываем состояние при возврате в меню
}

// --- Обработчики команд ---

bot.onText(/\/start|\/menu/, (msg) => {
    sendDynamicMainMenu(msg.chat.id, msg.from);
});

bot.onText(/\/app/, (msg) => {
    bot.sendMessage(msg.chat.id, 'Нажмите, чтобы запустить приложение 👇', {
        reply_markup: { inline_keyboard: [[{ text: '🚀 Открыть приложение', web_app: { url: WEB_APP_URL } }]] }
    });
});

bot.onText(/\/myid/, (msg) => {
    bot.sendMessage(msg.chat.id, `\`${msg.from.id}\``, {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [
                [{ text: '📲 Отправить ID', switch_inline_query: String(msg.from.id) }],
                [{ text: '🔙 В меню', callback_data: 'main_menu' }]
            ]
        }
    });
});

bot.onText(/\/finances/, async (msg) => {
    const user = await getUser(msg.from.id);
    if (user.type === 'owner' || user.type === 'admin') {
        bot.sendMessage(msg.chat.id, '📊 Выберите период для отчета:', financesKeyboard);
    } else {
        bot.sendMessage(msg.chat.id, 'Эта команда доступна только для зарегистрированных пользователей.');
    }
});

bot.onText(/\/expenses/, async (msg) => {
    const user = await getUser(msg.from.id);
    if (user.type === 'owner' || user.type === 'admin') {
        userState[msg.chat.id] = { mode: 'awaiting_expenses', cleanupMessageIds: [] };
        const sentMsg = await bot.sendMessage(msg.chat.id, EXPENSE_INSTRUCTION, { parse_mode: 'Markdown' });
        if(userState[msg.chat.id]) { // Проверяем, не сбросилось ли состояние
            userState[msg.chat.id].cleanupMessageIds.push(sentMsg.message_id);
        }
    } else {
        bot.sendMessage(msg.chat.id, 'Эта команда доступна только для зарегистрированных пользователей.');
    }
});


// --- Основной обработчик текстовых сообщений ---
bot.on('message', async (msg) => {
    if (!msg.text || msg.text.startsWith('/')) return;

    const chatId = msg.chat.id;
    const telegramId = msg.from.id;

    const user = await getUser(telegramId);
    if (user.type === 'unauthorized') {
        // Неавторизованные пользователи не могут вводить расходы
        return;
    }
    
    // Попытка обработать любое сообщение как расход
    const result = parseExpenseMessage(msg.text);

    if (result.success && result.expenses) {
        // Успешный парсинг расходов
        await cleanupMessages(chatId);

        if (result.needsClarification) {
             const { month, monthIndex, expensesData, yearOptions } = result;
             userState[chatId] = { ...userState[chatId], pendingYearClarification: { expensesData, monthIndex } };
             const keyboard = {
                 reply_markup: { inline_keyboard: [yearOptions.map(year => ({ text: `${month} ${year}`, callback_data: `clarify_year_${monthIndex}_${year}` }))] }
             };
             return bot.sendMessage(chatId, `Сейчас ${moment.tz(TIMEZONE).format('MMMM')}, а вы указали будущий месяц. Выберите год, в который нужно внести расходы:`, keyboard);
        }


        const wasInExpenseMode = userState[chatId]?.mode === 'awaiting_expenses';
        delete userState[chatId]; // Сбрасываем состояние

        const saved = await pool.query(
            `INSERT INTO expenses (user_id, amount, expense_time, comment) 
             SELECT $1, (item->>'amount')::numeric, (item->>'date')::timestamp, item->>'comment'
             FROM jsonb_array_elements($2::jsonb) as item`,
            [user.ownerUserId, JSON.stringify(result.expenses)]
        ).then(() => true).catch(err => {
            console.error("DB Error on saving expenses:", err);
            bot.sendMessage(chatId, "❌ Произошла ошибка при записи расходов в базу данных.");
            return false;
        });

        if (saved) {
            const totalAmount = result.expenses.reduce((sum, e) => sum + e.amount, 0);
            let successText = `✅ Расходы записаны.\n*Всего:* ${fNum(totalAmount)} ₽`;

            if (wasInExpenseMode) {
                successText += `\n\nВы можете внести ещё расходы или вернуться в Меню.\n\n_Подсказка: расходы можно записывать в любой момент, не нажимая кнопку "Записать расходы"._`;
            }
            bot.sendMessage(chatId, successText, { parse_mode: 'Markdown', ...backToMenuKeyboard });
        }

    } else if (userState[chatId]?.mode === 'awaiting_expenses') {
        // Ошибка парсинга расходов, но только если пользователь был в режиме ожидания расходов
        await cleanupMessages(chatId);
        const instructionMsg = await bot.sendMessage(chatId, EXPENSE_INSTRUCTION, { parse_mode: 'Markdown' });
        const errorMsg = await bot.sendMessage(chatId, `❌ ${result.error || 'Неизвестная ошибка.'}`, backToMenuKeyboard);
        if(userState[chatId]) {
            userState[chatId].cleanupMessageIds = [instructionMsg.message_id, errorMsg.message_id];
        }
    }
});

// --- Обработчик кнопок ---
bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const messageId = query.message.message_id;
    const data = query.data;

    const user = await getUser(query.from.id);
    if (user.type === 'unauthorized' && !['main_menu', 'show_my_id'].includes(data)) {
        return bot.answerCallbackQuery(query.id, { text: 'Эта функция доступна после регистрации.', show_alert: true });
    }
    
    // Очищаем предыдущие "мусорные" сообщения при любом действии с кнопкой
    if (!data.startsWith('clarify_year_')) {
        await cleanupMessages(chatId);
    }

    if (data.startsWith('clarify_year_')) {
        bot.deleteMessage(chatId, messageId).catch(() => {});
        const pendingData = userState[chatId]?.pendingYearClarification;
        if (!pendingData) {
            return bot.answerCallbackQuery(query.id, { text: 'Эта сессия устарела. Пожалуйста, отправьте расходы заново.' });
        }
        
        const [, monthIndex, year] = data.split('_');
        const baseDate = moment().tz(TIMEZONE).year(year).month(monthIndex).startOf('month');
        const textToParse = pendingData.expensesData.join('\n');
        
        // Повторно парсим только строки с расходами
        const result = parseExpenseMessage(textToParse);
        
        if (!result.success || !result.expenses || result.expenses.length === 0) {
            bot.sendMessage(chatId, `❌ Ошибка при повторной обработке расходов. ${result.error || ''}`, backToMenuKeyboard);
            return bot.answerCallbackQuery(query.id);
        }
        
        // Применяем выбранную дату
        const expensesWithDate = result.expenses.map(e => ({ ...e, date: baseDate.toDate() }));

        const wasInExpenseMode = userState[chatId]?.mode === 'awaiting_expenses';
        delete userState[chatId]; // Сбрасываем состояние

        // Сохраняем в БД
        const saved = await pool.query(
             `INSERT INTO expenses (user_id, amount, expense_time, comment) 
             SELECT $1, (item->>'amount')::numeric, (item->>'date')::timestamp, item->>'comment'
             FROM jsonb_array_elements($2::jsonb) as item`,
            [user.ownerUserId, JSON.stringify(expensesWithDate)]
        ).then(() => true).catch(err => {
            console.error("DB Error on saving expenses:", err);
            bot.sendMessage(chatId, "❌ Произошла ошибка при записи расходов в базу данных.");
            return false;
        });
        
        if (saved) {
            const totalAmount = expensesWithDate.reduce((sum, e) => sum + e.amount, 0);
            const monthName = moment(baseDate).format('MMMM YYYY');
            let successText = `✅ Расходы записаны на *1 ${monthName}*.\n*Всего:* ${fNum(totalAmount)} ₽`;
             if (wasInExpenseMode) {
                successText += `\n\nВы можете внести ещё расходы или вернуться в Меню.`;
            }
            bot.sendMessage(chatId, successText, { parse_mode: 'Markdown', ...backToMenuKeyboard });
        }
        return bot.answerCallbackQuery(query.id);
    }
    
    switch (data) {
        case 'main_menu':
            sendDynamicMainMenu(chatId, query.from, messageId);
            break;
        case 'enter_expense_mode':
            userState[chatId] = { mode: 'awaiting_expenses', cleanupMessageIds: [] };
            const sentMsg = await bot.editMessageText(EXPENSE_INSTRUCTION + '\n\n*Теперь я жду ваше сообщение с расходами 👇*', { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown' });
            if (userState[chatId]) { // Проверяем, не сбросилось ли состояние
                 userState[chatId].cleanupMessageIds.push(sentMsg.message_id);
            }
            break;
        case 'show_my_id':
            bot.deleteMessage(chatId, messageId).catch(()=>{});
            bot.sendMessage(chatId, `\`${query.from.id}\``, {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '📲 Отправить ID', switch_inline_query: String(query.from.id) }],
                        [{ text: '🔙 В меню', callback_data: 'main_menu' }]
                    ]
                }
            });
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
                    sendDynamicMainMenu(chatId, query.from, messageId);
                }
            } else {
                bot.answerCallbackQuery(query.id);
            }
            break;
    }
});

bot.on('polling_error', (error) => console.error('[Bot Polling Error]', error.code, error.message));
console.log('Telegram Bot started and ready.');