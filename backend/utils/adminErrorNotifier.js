// backend/utils/adminErrorNotifier.js
const TelegramBot = require('node-telegram-bot-api');
const pool = require('../db');
const moment = require('moment-timezone');

const ADMIN_BOT_TOKEN = process.env.ADMIN_TELEGRAM_BOT_TOKEN;
// CHAT_ID теперь не нужен, будем отправлять на ID, с которого пришла команда /start боту поддержки (если он настроен на это)
// Либо, если бот поддержки используется ТОЛЬКО для этих уведомлений, то нужен ID чата, куда слать.
// Для простоты пока оставим отправку на один предопределенный CHAT_ID. Если бот будет интерактивным, это надо будет переделать.
const ADMIN_TELEGRAM_CHAT_ID_FOR_ERRORS = process.env.ADMIN_TELEGRAM_CHAT_ID_FOR_ERRORS;


let botInstance;

if (ADMIN_BOT_TOKEN && ADMIN_TELEGRAM_CHAT_ID_FOR_ERRORS) {
    botInstance = new TelegramBot(ADMIN_BOT_TOKEN); // Не используем polling, бот только для отправки
    console.log('[AdminErrorNotifier] Admin Bot initialized for sending error notifications.');
} else {
    console.warn('[AdminErrorNotifier] ADMIN_TELEGRAM_BOT_TOKEN or ADMIN_TELEGRAM_CHAT_ID_FOR_ERRORS not set in .env. Admin error notifications disabled.');
}

async function sendErrorToAdmin({
    userId, // ID пользователя из нашей БД (если есть)
    telegramId, // Telegram ID (если есть)
    userFirstName, // Имя пользователя (если есть)
    userUsername, // Username пользователя (если есть)
    errorContext, // Описание, где произошла ошибка
    errorMessage,
    errorStack, // Опционально
    additionalInfo, // Объект с доп. полями
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

    // Если есть userId, но нет других данных, попробуем их получить
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
    
    userInfoText = `User ID (DB): ${dbUserId}\nTelegram ID: ${tgId}\nUsername: @${uName === 'N/A' ? 'нет' : uName}\nИмя: ${fName}`;

    const time = moment().tz('Europe/Moscow').format('YYYY-MM-DD HH:mm:ss');
    
    let message = `🚨 **ОШИБКА В InfoCoffee** 🚨\n\n`;
    message += `**Время:** ${time} (MSK)\n`;
    message += `**Контекст:** ${errorContext}\n\n`;
    message += `**Инфо о пользователе:**\n${userInfoText}\n\n`;
    message += `**Ошибка:**\n\`\`\`\n${errorMessage}\n\`\`\`\n`;

    if (additionalInfo && Object.keys(additionalInfo).length > 0) {
        message += `**Доп. инфо:**\n\`\`\`\n${JSON.stringify(additionalInfo, null, 2)}\n\`\`\`\n`;
    }

    if (errorStack) {
        message += `\n**Стек (часть):**\n\`\`\`\n${errorStack.substring(0, 700)}\n\`\`\`\n`; // Ограничим длину стека
    }
    message += `\nПроверьте логи сервера для полной информации.`;

    try {
        // Разбиваем сообщение, если оно слишком длинное для Telegram
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
        }
    }
}

module.exports = { sendErrorToAdmin };