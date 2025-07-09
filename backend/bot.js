// backend/bot.js
const path = require('path');
const envPath = process.env.NODE_ENV === 'development' ? '.env.development' : '.env';
require('dotenv').config({ path: path.resolve(__dirname, envPath) });
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

let BOT_USERNAME = '';
let keyboards = {};

// --- Инициализация и регистрация команд ---
(async () => {
    try {
        const me = await bot.getMe();
        BOT_USERNAME = me.username;
        console.log(`Bot @${BOT_USERNAME} started.`);

        // --- Клавиатуры ---
        keyboards = {
            authorized: {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🚀 Открыть приложение', web_app: { url: WEB_APP_URL } }],
                        [{ text: '💰 Финансы Сегодня', callback_data: 'get_finances_today' }],
                        [{ text: '💸 Записать расходы', callback_data: 'enter_expense_mode' }, { text: '📊 Все финансы', callback_data: 'show_finances_menu' }],
                        [{ text: '🆔 Мой ID', callback_data: 'show_my_id' }, { text: '🙋‍♂️ Пригласить', switch_inline_query: '' }]
                    ]
                }
            },
            unauthorized: {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🚀 Открыть приложение', web_app: { url: WEB_APP_URL } }],
                        [{ text: '🆔 Мой ID', callback_data: 'show_my_id' }, { text: '🙋‍♂️ Пригласить', switch_inline_query: '' }]
                    ]
                }
            },
            finances: {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '📅 Сегодня', callback_data: 'get_finances_today' }, { text: '🕰️ Вчера', callback_data: 'get_finances_yesterday' }],
                        [{ text: '📈 С начала недели', callback_data: 'get_finances_week' }, { text: '📉 С начала месяца', callback_data: 'get_finances_month' }],
                        [{ text: '7️⃣ За 7 дней', callback_data: 'get_finances_7_days' }, { text: '3️⃣0️⃣ За 30 дней', callback_data: 'get_finances_30_days' }],
                        [{ text: '🏁 С начала года', callback_data: 'get_finances_year' }],
                        [{ text: '🔙 В меню', callback_data: 'main_menu' }]
                    ]
                }
            },
            afterReport: {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🚀 Открыть приложение', web_app: { url: WEB_APP_URL } }],
                        [{ text: '📊 Другой период', callback_data: 'show_finances_menu' }, { text: '🔙 В меню', callback_data: 'main_menu' }]
                    ]
                }
            },
            afterAction: {
                 reply_markup: {
                    inline_keyboard: [
                        [{ text: '🚀 Открыть приложение', web_app: { url: WEB_APP_URL } }],
                        [{ text: '🔙 В меню', callback_data: 'main_menu' }]
                    ]
                }
            },
            expenseMode: { // <--- НОВАЯ КЛАВИАТУРА
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🚀 Открыть приложение', web_app: { url: WEB_APP_URL } }],
                        [{ text: '🔙 Назад', callback_data: 'main_menu' }]
                    ]
                }
            }
        };

        await bot.setMyCommands([
            { command: '/start', description: '🚀 Запустить/Перезапустить бота' },
            { command: '/menu', description: '📋 Показать главное меню' },
            { command: '/app', description: '📱 Открыть веб-приложение' },
            { command: '/myid', description: '🆔 Показать мой Telegram ID' },
            { command: '/finances', description: '📊 Открыть меню финансов' },
            { command: '/expenses', description: '💸 Быстро записать расходы' },
        ]);
        console.log(`Bot commands are set.`);

    } catch (e) {
        console.error("Failed to set bot commands or get bot info:", e);
    }
})();

const userState = {};

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

async function cleanupUserMessages(chatId) {
    const state = userState[chatId];
    if (!state) return;
    
    const messageIds = [state.activeMessageId, state.errorCleanupId, state.instructionMessageId].filter(Boolean);
    
    for (const msgId of messageIds) {
        await bot.deleteMessage(chatId, msgId).catch(() => {});
    }

    if(userState[chatId]) {
        delete userState[chatId].activeMessageId;
        delete userState[chatId].errorCleanupId;
        delete userState[chatId].instructionMessageId;
    }
}

async function sendDynamicMainMenu(chatId, from, messageId = null) {
    await cleanupUserMessages(chatId);
    
    const user = await getUser(from.id);
    let text, keyboard;

    if (user.type === 'owner' || user.type === 'admin') {
        text = 'Главное меню:';
        keyboard = keyboards.authorized;
    } else {
        text = `Добро пожаловать, ${from.first_name}! ☕️\n\nЯ — бот для аналитики ваших кофеен. Чтобы начать, откройте приложение и пройдите регистрацию.`;
        keyboard = keyboards.unauthorized;
    }

    try {
        let sentMsg;
        if (messageId) {
            sentMsg = await bot.editMessageText(text, { chat_id: chatId, message_id: messageId, ...keyboard });
        } else {
            sentMsg = await bot.sendMessage(chatId, text, keyboard);
        }
        userState[chatId] = { activeMessageId: sentMsg.message_id };
    } catch {
        const sentMsg = await bot.sendMessage(chatId, text, keyboard);
        userState[chatId] = { activeMessageId: sentMsg.message_id };
    }
}

// --- Обработчики команд ---
bot.onText(/\/start|\/menu/, (msg) => {
    sendDynamicMainMenu(msg.chat.id, msg.from);
});

bot.onText(/\/app/, (msg) => {
    cleanupUserMessages(msg.chat.id);
    bot.sendMessage(msg.chat.id, 'Нажмите, чтобы запустить приложение 👇', {
        reply_markup: { inline_keyboard: [[{ text: '🚀 Открыть приложение', web_app: { url: WEB_APP_URL } }]] }
    });
});

bot.onText(/\/myid/, (msg) => {
    cleanupUserMessages(msg.chat.id);
    const id = msg.from.id;
    bot.sendMessage(msg.chat.id, `Ваш ID (нажмите на него, чтобы скопировать):\n\n\`${id}\`\n\nИли нажмите кнопку ниже, чтобы быстро отправить его в другой чат.`, {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [
                [{ text: '📲 Отправить ID', switch_inline_query: String(id) }],
                [{ text: '🔙 В меню', callback_data: 'main_menu' }]
            ]
        }
    });
});

bot.onText(/\/finances/, async (msg) => {
    await cleanupUserMessages(msg.chat.id);
    const user = await getUser(msg.from.id);
    if (user.type === 'owner' || user.type === 'admin') {
        const sentMsg = await bot.sendMessage(msg.chat.id, '📊 Выберите период для отчета:', keyboards.finances);
        userState[msg.chat.id] = { activeMessageId: sentMsg.message_id };
    } else {
        bot.sendMessage(msg.chat.id, 'Эта команда доступна только для зарегистрированных пользователей.');
    }
});

bot.onText(/\/expenses/, async (msg) => {
    await cleanupUserMessages(msg.chat.id);
    const user = await getUser(msg.from.id);
    if (user.type === 'owner' || user.type === 'admin') {
        const sentMsg = await bot.sendMessage(msg.chat.id, EXPENSE_INSTRUCTION + '\n\n*Теперь я жду ваше сообщение с расходами 👇*', { parse_mode: 'Markdown', ...keyboards.expenseMode });
        userState[msg.chat.id] = { mode: 'awaiting_expenses', instructionMessageId: sentMsg.message_id };
    } else {
        bot.sendMessage(msg.chat.id, 'Эта команда доступна только для зарегистрированных пользователей.');
    }
});

// --- Основной обработчик текстовых сообщений ---
bot.on('message', async (msg) => {
    if (!msg.text || msg.text.startsWith('/')) return;

    const chatId = msg.chat.id;
    const user = await getUser(msg.from.id);

    if (user.type === 'unauthorized') return;
    
    const result = parseExpenseMessage(msg.text);

    if (result.success && result.expenses) {
        const wasInExpenseMode = userState[chatId]?.mode === 'awaiting_expenses';
        await cleanupUserMessages(chatId);
        delete userState[chatId];

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
                successText += `\n\n_Подсказка: расходы можно записывать и без нажатия кнопки "Записать расходы"._`;
            }
            bot.sendMessage(chatId, successText, { parse_mode: 'Markdown', ...keyboards.afterAction });
        }
    } else {
        if (userState[chatId]?.errorCleanupId) {
            await bot.deleteMessage(chatId, userState[chatId].errorCleanupId).catch(() => {});
        }
        if (!userState[chatId]?.instructionMessageId) {
            const instructionMsg = await bot.sendMessage(chatId, EXPENSE_INSTRUCTION, { parse_mode: 'Markdown' });
            userState[chatId] = { ...userState[chatId], instructionMessageId: instructionMsg.message_id };
        }
        
        const errorMsg = await bot.sendMessage(chatId, `❌ ${result.error || 'Неверный формат.'}\nСледуйте инструкции выше для быстрой записи расходов.`, keyboards.afterAction);
        userState[chatId] = { ...userState[chatId], errorCleanupId: errorMsg.message_id };
    }
});

// --- Обработчик кнопок ---
bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const messageId = query.message.message_id;
    const data = query.data;

    const user = await getUser(query.from.id);
    if (user.type === 'unauthorized' && !['main_menu', 'show_my_id'].includes(data)) {
        bot.answerCallbackQuery(query.id, { text: 'Эта функция доступна после регистрации.', show_alert: true });
        return;
    }
    
    userState[chatId] = { ...userState[chatId], activeMessageId: messageId };
    
    switch (data) {
        case 'main_menu':
            sendDynamicMainMenu(chatId, query.from, messageId);
            break;
        case 'enter_expense_mode':
            await bot.editMessageText(EXPENSE_INSTRUCTION + '\n\n*Теперь я жду ваше сообщение с расходами 👇*', { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', ...keyboards.expenseMode });
            userState[chatId] = { mode: 'awaiting_expenses', instructionMessageId: messageId, activeMessageId: null };
            break;
        case 'show_my_id':
            await cleanupUserMessages(chatId);
            const id = query.from.id;
            const sentIdMsg = await bot.sendMessage(chatId, `Ваш ID (нажмите на него, чтобы скопировать):\n\n\`${id}\`\n\nИли нажмите кнопку ниже, чтобы быстро отправить его в другой чат.`, {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '📲 Отправить ID', switch_inline_query: String(id) }],
                        [{ text: '🔙 В меню', callback_data: 'main_menu' }]
                    ]
                }
            });
            userState[chatId] = { activeMessageId: sentIdMsg.message_id };
            break;
        case 'show_finances_menu':
            const finMsg = await bot.editMessageText('📊 Выберите период для отчета:', { chat_id: chatId, message_id: messageId, ...keyboards.finances });
            userState[chatId] = { activeMessageId: finMsg.message_id };
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
                    
                    const reportMsg = await bot.editMessageText(reportText, { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', ...keyboards.afterReport });
                    userState[chatId] = { activeMessageId: reportMsg.message_id }; 
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

// Обработка всех callback_query
bot.on('callback_query', async (ctx) => {
    const data = ctx.callbackQuery.data;
    const telegramId = ctx.from.id;

    if (data.startsWith('task_complete_')) {
        const taskId = data.split('_')[2];
        try {
            // Проверяем, что у пользователя есть права на выполнение этой задачи
            const taskRes = await pool.query(
                `SELECT id, assignee_ids FROM service_tasks WHERE id = $1 AND $2 = ANY(assignee_ids)`,
                [taskId, telegramId]
            );

            if (taskRes.rowCount === 0) {
                return ctx.answerCbQuery('Это не ваша задача, или она уже выполнена.', { show_alert: true });
            }

            // Обновляем статус задачи
            await pool.query(
                `UPDATE service_tasks SET status = 'completed', completed_at = NOW() WHERE id = $1`,
                [taskId]
            );

            // Редактируем исходное сообщение, убирая кнопку
            await ctx.editMessageText(ctx.callbackQuery.message.text + '\n\n✅ <b>Выполнено</b>', {
                parse_mode: 'HTML'
            });
            ctx.answerCbQuery('Задача отмечена как выполненная!');

            // TODO: Отправить уведомление админам о выполнении

        } catch (err) {
            console.error(`[Bot] Error completing task ${taskId} by user ${telegramId}:`, err);
            ctx.answerCbQuery('Ошибка при обновлении задачи.', { show_alert: true });
        }
    }

    // Здесь могут быть другие обработчики callback_query
});

// Запускаем бота
// bot.launch().then(() => {
//     console.log('Telegram bot started successfully.');
// }).catch(err => {
//     console.error('Failed to start Telegram bot:', err);
// });

module.exports = bot;

bot.on('polling_error', (error) => console.error('[Bot Polling Error]', error.code, error.message));