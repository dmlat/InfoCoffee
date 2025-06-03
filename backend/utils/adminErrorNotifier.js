// backend/utils/adminErrorNotifier.js
const TelegramBot = require('node-telegram-bot-api');
const pool = require('../db');
const moment = require('moment-timezone');

const ADMIN_BOT_TOKEN = process.env.ADMIN_TELEGRAM_BOT_TOKEN;
const ADMIN_TELEGRAM_CHAT_ID_FOR_ERRORS = process.env.ADMIN_TELEGRAM_CHAT_ID_FOR_ERRORS;

let botInstance;

if (ADMIN_BOT_TOKEN && ADMIN_TELEGRAM_CHAT_ID_FOR_ERRORS) {
    botInstance = new TelegramBot(ADMIN_BOT_TOKEN);
    console.log('[AdminErrorNotifier] Admin Bot initialized for sending error notifications.');
} else {
    console.warn('[AdminErrorNotifier] ADMIN_TELEGRAM_BOT_TOKEN or ADMIN_TELEGRAM_CHAT_ID_FOR_ERRORS not set in .env. Admin error notifications disabled.');
}

// Функция для экранирования специальных символов Markdown (старый стиль)
function escapeMarkdown(text) {
    if (typeof text !== 'string') {
        return text;
    }
    // Для parse_mode: 'Markdown' основные символы для экранирования: _, *, `, [
    // Для блоков ```code``` экранирование обычно не требуется, но если текст вставляется вне их, то нужно.
    // Telegram API может быть капризным, особенно с непарными символами.
    // Этот список можно расширить при необходимости.
    return text
        .replace(/_/g, '\\_')
        .replace(/\*/g, '\\*')
        .replace(/`/g, '\\`')
        .replace(/\[/g, '\\[');
}


async function sendErrorToAdmin({
    userId, 
    telegramId, 
    userFirstName, 
    userUsername, 
    errorContext, 
    errorMessage,
    errorStack, 
    additionalInfo, 
}) {
    if (!botInstance || !ADMIN_TELEGRAM_CHAT_ID_FOR_ERRORS) {
        console.log('[AdminErrorNotifier] Admin bot or chat ID not configured, skipping notification. Error was:', errorMessage);
        return;
    }

    let userInfoText = 'Пользователь: Не определен';
    let dbUserId = userId || 'N/A';
    let tgId = telegramId || 'N/A';
    let fName = userFirstName || 'N/A';
    let uName = userUsername || 'N/A';

    if (userId && (fName === 'N/A' || uName === 'N/A')) {
        try {
            const userRes = await pool.query('SELECT telegram_id, first_name, user_name FROM users WHERE id = $1', [userId]);
            if (userRes.rows.length > 0) {
                tgId = userRes.rows[0].telegram_id || tgId;
                fName = userRes.rows[0].first_name || fName;
                uName = userRes.rows[0].user_name || uName;
            }
        } catch (dbErr) {
            console.error('[AdminErrorNotifier] Error fetching user details for notification:', dbErr.message);
        }
    }
    
    // Экранируем данные пользователя перед вставкой в сообщение
    userInfoText = `User ID (DB): ${dbUserId}\nTelegram ID: <span class="math-inline">\{tgId\}\\nUsername\: @</span>{escapeMarkdown(uName === 'N/A' ? 'нет' : uName)}\nИмя: ${escapeMarkdown(fName)}`;

    const time = moment().tz('Europe/Moscow').format('YYYY-MM-DD HH:mm:ss');
    
    // Экранируем контекст и сообщение об ошибке
    let message = `🚨 **ОШИБКА В InfoCoffee** 🚨\n\n`;
    message += `**Время:** ${time} (MSK)\n`;
    message += `**Контекст:** ${escapeMarkdown(errorContext)}\n\n`; // Экранируем
    message += `**Инфо о пользователе:**\n${userInfoText}\n\n`; // userInfoText уже содержит экранированные части
    
    // Для содержимого блоков ``` экранирование не нужно, но если сам errorMessage содержит ```, это проблема.
    // Безопаснее всего будет не использовать Markdown внутри блоков кода, либо очень аккуратно его формировать.
    // Простой вариант - убрать форматирование из самого errorMessage.
    // Более сложный - парсить errorMessage и экранировать только вне потенциальных блоков.
    // Пока просто обернем в ```, предполагая, что сам errorMessage не содержит ```.
    message += `**Ошибка:**\n\`\`\`\n${errorMessage}\n\`\`\`\n`;

    if (additionalInfo && Object.keys(additionalInfo).length > 0) {
        // JSON.stringify обычно безопасен для ```, но если там будут строки с ```, тоже может быть проблема.
        // Для большей безопасности можно также экранировать результат stringify или его части.
        // Но чаще всего JSON не содержит конфликтующих с Markdown символов в такой степени.
        message += `**Доп. инфо:**\n\`\`\`json\n${JSON.stringify(additionalInfo, null, 2)}\n\`\`\`\n`;
    }

    if (errorStack) {
        // Стек трейс также может содержать символы, конфликтующие с Markdown.
        // Оборачивание в ``` должно помочь, но опять же, если сам стек содержит ```.
        message += `\n**Стек (часть):**\n\`\`\`\n${errorStack.substring(0, 700)}\n\`\`\`\n`;
    }
    message += `\nПроверьте логи сервера для полной информации.`;

    try {
        const MAX_MESSAGE_LENGTH = 4096;
        if (message.length > MAX_MESSAGE_LENGTH) {
            // Логика разбивки остается
            const parts = [];
            let currentPart = "";
            const lines = message.split('\n');
            for (const line of lines) {
                if (currentPart.length + line.length + 1 > MAX_MESSAGE_LENGTH) {
                    parts.push(currentPart);
                    currentPart = "";
                }
                currentPart += line + "\n";
            }
            parts.push(currentPart);

            for (const part of parts) {
                await botInstance.sendMessage(ADMIN_TELEGRAM_CHAT_ID_FOR_ERRORS, part, { parse_mode: 'Markdown' });
            }
        } else {
            await botInstance.sendMessage(ADMIN_TELEGRAM_CHAT_ID_FOR_ERRORS, message, { parse_mode: 'Markdown' });
        }
        console.log(`[AdminErrorNotifier] Sent error notification to chat ID ${ADMIN_TELEGRAM_CHAT_ID_FOR_ERRORS}`);
    } catch (sendErr) {
        console.error('[AdminErrorNotifier] Failed to send error notification via Telegram:', sendErr.code, sendErr.message);
        if (sendErr.response && sendErr.response.body) {
            console.error('[AdminErrorNotifier] Telegram API Error Body:', sendErr.response.body);
            // Если ошибка снова из-за parse_mode, можно попробовать отправить без него
            console.log('[AdminErrorNotifier] Attempting to send without Markdown...');
            try {
                 const plainMessage = message.replace(/[*_`\[\]]/g, ''); // Грубо убираем основные Markdown символы
                 await botInstance.sendMessage(ADMIN_TELEGRAM_CHAT_ID_FOR_ERRORS, plainMessage.substring(0, MAX_MESSAGE_LENGTH));
                 console.log('[AdminErrorNotifier] Sent plain text notification fallback.');
            } catch (fallbackErr) {
                console.error('[AdminErrorNotifier] Failed to send plain text fallback notification:', fallbackErr.message);
            }
        }
    }
}

module.exports = { sendErrorToAdmin };