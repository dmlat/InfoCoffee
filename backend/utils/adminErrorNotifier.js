// backend/utils/adminErrorNotifier.js
const TelegramBot = require('node-telegram-bot-api');
const { pool } = require('../db');
const moment = require('moment-timezone');

const IS_DEV = process.env.NODE_ENV === 'development';
// В dev-режиме используем основной тестовый бот и тестовый чат. В production - отдельные.
const ADMIN_BOT_TOKEN = IS_DEV ? process.env.DEV_TELEGRAM_BOT_TOKEN : process.env.ADMIN_TELEGRAM_BOT_TOKEN;
const ADMIN_TELEGRAM_CHAT_ID_FOR_ERRORS = IS_DEV ? process.env.DEV_ADMIN_TELEGRAM_CHAT_ID_FOR_ERRORS : process.env.ADMIN_TELEGRAM_CHAT_ID_FOR_ERRORS;

let botInstance;

// === РАСШИРЕННАЯ СИСТЕМА ЗАЩИТЫ ОТ СПАМА ===
const notificationCache = new Map();
const NOTIFICATION_COOLDOWN_MS = 5 * 60 * 1000; // 5 минут
const MAX_MESSAGES_PER_HOUR = 20; // Максимум сообщений админам в час
const ERROR_QUEUE = []; // Очередь ошибок для группировки
const BATCH_SEND_DELAY_MS = 10000; // 10 секунд для группировки похожих ошибок

let hourlyMessageCount = 0;
let hourlyResetTime = Date.now() + 60 * 60 * 1000; // Сброс каждый час

let batchProcessingActive = false;

// Сброс почасового лимита
setInterval(() => {
    hourlyMessageCount = 0;
}, 60 * 60 * 1000);

// Периодическая очистка кэша от старых записей
setInterval(() => {
    const now = Date.now();
    for (const [key, timestamp] of notificationCache.entries()) {
        if (now - timestamp > NOTIFICATION_COOLDOWN_MS) {
            notificationCache.delete(key);
        }
    }
}, NOTIFICATION_COOLDOWN_MS);

if (ADMIN_BOT_TOKEN && ADMIN_TELEGRAM_CHAT_ID_FOR_ERRORS) {
    // Создаем отдельный инстанс с настройками для админского бота
    botInstance = new TelegramBot(ADMIN_BOT_TOKEN, { 
        polling: false,
        request: {
            agentOptions: {
                keepAlive: true,
                family: 4
            },
            timeout: 30000
        }
    });
} else {
    console.warn('[AdminErrorNotifier] ❌ ADMIN_TELEGRAM_BOT_TOKEN or ADMIN_TELEGRAM_CHAT_ID_FOR_ERRORS not set. Admin error notifications disabled.');
}

// Новая функция для экранирования HTML
function escapeHTML(str) {
    if (typeof str !== 'string') return str;
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

// Группировка похожих ошибок
function getErrorGroupKey(errorContext, errorMessage) {
    // Создаем ключ для группировки похожих ошибок
    const normalizedContext = errorContext.replace(/User \d+/g, 'User X').replace(/Terminal \d+/g, 'Terminal X');
    const normalizedMessage = errorMessage.substring(0, 100); // Первые 100 символов
    return `${normalizedContext}:${normalizedMessage}`;
}

// Пакетная обработка ошибок
async function processBatchedErrors() {
    if (batchProcessingActive) {
        return;
    }
    
    if (ERROR_QUEUE.length === 0) {
        return;
    }

    batchProcessingActive = true;

    try {
        // Группируем ошибки по типу
        const errorGroups = new Map();
        const errors = ERROR_QUEUE.splice(0); // Очищаем очередь

        for (const error of errors) {
            const groupKey = getErrorGroupKey(error.errorContext, error.errorMessage);
            if (!errorGroups.has(groupKey)) {
                errorGroups.set(groupKey, {
                    count: 0,
                    firstError: error,
                    users: new Set(),
                    timestamps: []
                });
            }
            
            const group = errorGroups.get(groupKey);
            group.count++;
            group.users.add(error.userIdentifier || 'Unknown');
            group.timestamps.push(error.timestamp);
        }

        // Отправляем сгруппированные уведомления
        for (const [groupKey, group] of errorGroups) {
            if (hourlyMessageCount >= MAX_MESSAGES_PER_HOUR) {
                console.warn('[AdminErrorNotifier] Hourly message limit reached. Skipping remaining notifications.');
                break;
            }

            await sendGroupedErrorNotification(group);
            hourlyMessageCount++;
            
            // Небольшая задержка между сообщениями
            await new Promise(resolve => setTimeout(resolve, 1000));
        }

    } catch (error) {
        console.error('[AdminErrorNotifier] Error in batch processing:', error);
    } finally {
        batchProcessingActive = false;
    }
}

// Отправка сгруппированного уведомления
async function sendGroupedErrorNotification(group) {
    if (!botInstance || !ADMIN_TELEGRAM_CHAT_ID_FOR_ERRORS) {
        return;
    }

    const { count, firstError, users, timestamps } = group;
    const time = moment().tz('Europe/Moscow').format('YYYY-MM-DD HH:mm:ss');
    
    let message = count > 1 
        ? `🚨 <b>ГРУППА ОШИБОК (${count}x) в InfoCoffee</b> 🚨\n\n`
        : `🚨 <b>ОШИБКА В InfoCoffee</b> 🚨\n\n`;
    
    message += `<b>Время:</b> ${time} (MSK)\n`;
    message += `<b>Контекст:</b> ${escapeHTML(firstError.errorContext)}\n\n`;
    
    if (count > 1) {
        message += `<b>Количество:</b> ${count} одинаковых ошибок\n`;
        message += `<b>Пользователи:</b> ${Array.from(users).join(', ')}\n`;
        message += `<b>Временной интервал:</b> ${timestamps.length > 1 ? `${Math.floor((Math.max(...timestamps) - Math.min(...timestamps)) / 1000)}s` : 'Мгновенно'}\n\n`;
    } else if (firstError.userIdentifier) {
        message += `<b>Пользователь:</b> ${firstError.userIdentifier}\n\n`;
    }
    
    message += `<b>Ошибка:</b>\n<pre><code>${escapeHTML(firstError.errorMessage)}</code></pre>\n`;

    if (firstError.additionalInfo && Object.keys(firstError.additionalInfo).length > 0) {
        const infoStr = JSON.stringify(firstError.additionalInfo, null, 2);
        if (infoStr.length < 500) {
            message += `<b>Доп. инфо:</b>\n<pre><code>${escapeHTML(infoStr)}</code></pre>\n`;
        }
    }

    if (firstError.errorStack) {
        const stackPreview = firstError.errorStack.substring(0, 300);
        message += `\n<b>Стек (краткий):</b>\n<pre><code>${escapeHTML(stackPreview)}</code></pre>\n`;
    }
    
    message += `\n📊 Проверьте логи для полной информации.`;

    try {
        const MAX_MESSAGE_LENGTH = 4096;
        if (message.length > MAX_MESSAGE_LENGTH) {
            // Разбиваем длинное сообщение на части
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
            if (currentPart) parts.push(currentPart);

            for (let i = 0; i < parts.length; i++) {
                await botInstance.sendMessage(ADMIN_TELEGRAM_CHAT_ID_FOR_ERRORS, parts[i], { 
                    parse_mode: 'HTML',
                    disable_web_page_preview: true 
                });
                await new Promise(resolve => setTimeout(resolve, 500)); // Задержка между частями
            }
        } else {
            await botInstance.sendMessage(ADMIN_TELEGRAM_CHAT_ID_FOR_ERRORS, message, { 
                parse_mode: 'HTML',
                disable_web_page_preview: true 
            });
        }
        
    } catch (sendErr) {
        console.error('[AdminErrorNotifier] ❌ Failed to send notification:', sendErr);
        
        // Если ошибка связана с rate limiting, увеличиваем интервал
        if (sendErr.code === 429) {
            const retryAfter = sendErr.parameters?.retry_after || 60;
            console.warn(`[AdminErrorNotifier] Rate limited by Telegram. Cooling down for ${retryAfter}s`);
            setTimeout(() => {
            }, retryAfter * 1000);
        }
    }
}

// Запуск пакетной обработки с интервалом
setInterval(processBatchedErrors, BATCH_SEND_DELAY_MS);

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
    // Проверяем, инициализирован ли бот
    if (!botInstance || !ADMIN_TELEGRAM_CHAT_ID_FOR_ERRORS) {
        console.warn(`[AdminErrorNotifier] ❌ Cannot send notification: bot not configured`);
        return;
    }

    // Создаем идентификатор пользователя для дедупликации
    const userIdentifier = userId || telegramId;
    const cacheKey = `${errorContext}:${userIdentifier || 'anonymous'}:${errorMessage.substring(0, 50)}`;
    const now = Date.now();
    
    // Проверяем дедупликацию
    if (notificationCache.has(cacheKey)) {
        const lastSent = notificationCache.get(cacheKey);
        if (now - lastSent < NOTIFICATION_COOLDOWN_MS) {
            return;
        }
    }
    notificationCache.set(cacheKey, now);

    // Проверяем почасовой лимит
    if (hourlyMessageCount >= MAX_MESSAGES_PER_HOUR) {
        console.warn(`[AdminErrorNotifier] Hourly limit (${MAX_MESSAGES_PER_HOUR}) reached. Queuing error for batch processing.`);
    }

    // Формируем информацию о пользователе
    let finalUserIdentifier = userIdentifier;
    
    if (userId && !userFirstName) {
        try {
            const userRes = await pool.query('SELECT telegram_id, first_name, user_name FROM users WHERE id = $1', [userId]);
            if (userRes.rows.length > 0) {
                const userData = userRes.rows[0];
                const displayName = userData.first_name || 'N/A';
                const username = userData.user_name ? `@${userData.user_name}` : 'нет';
                finalUserIdentifier = `${displayName} (${username}, ID:${userId}, TG:${userData.telegram_id || telegramId})`;
            }
        } catch (dbErr) {
            console.error('[AdminErrorNotifier] Error fetching user details:', dbErr.message);
        }
    } else if (userFirstName || userUsername) {
        const displayName = userFirstName || 'N/A';
        const username = userUsername ? `@${userUsername}` : 'нет';
        finalUserIdentifier = `${displayName} (${username}, ID:${userId || 'N/A'}, TG:${telegramId || 'N/A'})`;
    }

    // Добавляем в очередь для пакетной обработки
    ERROR_QUEUE.push({
        userId,
        telegramId,
        userIdentifier: finalUserIdentifier,
        errorContext,
        errorMessage,
        errorStack,
        additionalInfo,
        timestamp: now
    });

    // Если очередь становится большой, немедленно обрабатываем
    if (ERROR_QUEUE.length >= 5) {
        setTimeout(processBatchedErrors, 1000);
    }
}

// Функция для получения статистики уведомлений
function getNotificationStats() {
    return {
        cacheSize: notificationCache.size,
        queueLength: ERROR_QUEUE.length,
        hourlyMessageCount,
        hourlyLimitResetIn: Math.max(0, hourlyResetTime - Date.now()),
        batchProcessingActive
    };
}

// Экстренная функция для критичных ошибок (обходит лимиты)
async function sendCriticalError(errorMessage, errorContext = 'Critical System Error') {
    if (!botInstance || !ADMIN_TELEGRAM_CHAT_ID_FOR_ERRORS) {
        console.error('[AdminErrorNotifier] Cannot send critical error: Bot not configured');
        return;
    }

    const time = moment().tz('Europe/Moscow').format('YYYY-MM-DD HH:mm:ss');
    const message = `🔥 <b>КРИТИЧЕСКАЯ ОШИБКА</b> 🔥\n\n<b>Время:</b> ${time} (MSK)\n<b>Контекст:</b> ${escapeHTML(errorContext)}\n\n<b>Ошибка:</b>\n<pre><code>${escapeHTML(errorMessage)}</code></pre>\n\n⚠️ Требует немедленного внимания!`;

    try {
        await botInstance.sendMessage(ADMIN_TELEGRAM_CHAT_ID_FOR_ERRORS, message, { 
            parse_mode: 'HTML',
            disable_web_page_preview: true 
        });
    } catch (error) {
        console.error('[AdminErrorNotifier] Failed to send critical error:', error.message);
    }
}

module.exports = { 
    sendErrorToAdmin,
    sendCriticalError,
    getNotificationStats,
    // Для тестирования
    _internal: {
        processBatchedErrors,
        getErrorGroupKey
    }
};