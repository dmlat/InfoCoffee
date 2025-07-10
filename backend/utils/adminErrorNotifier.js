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

// Новая функция для экранирования HTML
function escapeHTML(str) {
    if (typeof str !== 'string') return str;
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
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

    let userInfoText = '<b>Пользователь:</b> Не определен';
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
    
    // Формируем текст с использованием HTML
    const uNameDisplay = uName === 'N/A' ? 'нет' : `@${escapeHTML(uName)}`;
    userInfoText = `<b>Пользователь:</b>\n- DB ID: ${dbUserId}\n- TG ID: ${tgId}\n- Username: ${uNameDisplay}\n- Имя: ${escapeHTML(fName)}`;


    const time = moment().tz('Europe/Moscow').format('YYYY-MM-DD HH:mm:ss');
    
    let message = `🚨 <b>ОШИБКА В InfoCoffee</b> 🚨\n\n`;
    message += `<b>Время:</b> ${time} (MSK)\n`;
    message += `<b>Контекст:</b> ${escapeHTML(errorContext)}\n\n`;
    message += `${userInfoText}\n\n`;
    
    message += `<b>Ошибка:</b>\n<pre><code>${escapeHTML(errorMessage)}</code></pre>\n`;

    if (additionalInfo && Object.keys(additionalInfo).length > 0) {
        message += `<b>Доп. инфо:</b>\n<pre><code>${escapeHTML(JSON.stringify(additionalInfo, null, 2))}</code></pre>\n`;
    }

    if (errorStack) {
        message += `\n<b>Стек (часть):</b>\n<pre><code>${escapeHTML(errorStack.substring(0, 700))}</code></pre>\n`;
    }
    message += `\nПроверьте логи сервера для полной информации.`;

    try {
        const MAX_MESSAGE_LENGTH = 4096;
        if (message.length > MAX_MESSAGE_LENGTH) {
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
                await botInstance.sendMessage(ADMIN_TELEGRAM_CHAT_ID_FOR_ERRORS, part, { parse_mode: 'HTML' });
            }
        } else {
            await botInstance.sendMessage(ADMIN_TELEGRAM_CHAT_ID_FOR_ERRORS, message, { parse_mode: 'HTML' });
        }
        console.log(`[AdminErrorNotifier] Sent error notification to chat ID ${ADMIN_TELEGRAM_CHAT_ID_FOR_ERRORS}`);
    } catch (sendErr) {
        console.error('[AdminErrorNotifier] Failed to send error notification via Telegram:', sendErr.code, sendErr.message);
        if (sendErr.response && sendErr.response.body) {
            console.error('[AdminErrorNotifier] Telegram API Error Body:', sendErr.response.body);
        }
    }
}

module.exports = { sendErrorToAdmin };