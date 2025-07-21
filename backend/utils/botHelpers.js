// backend/utils/botHelpers.js
const { queueMessageWithKeyboard } = require('./botQueue');
const pool = require('../db');

/**
 * Отправляет сообщение с инлайн-клавиатурой через систему очередей.
 * В режиме разработки, перенаправляет сообщения для тестовых ID (сервис, админ) на ID владельца и убирает кнопки.
 * @param {number|string} chatId - ID чата для отправки.
 * @param {string} text - Текст сообщения (поддерживает HTML).
 * @param {object} keyboard - Объект инлайн-клавиатуры.
 * @param {boolean} priority - Высокий приоритет отправки
 * @returns {Promise<boolean>}
 */
function sendNotificationWithKeyboard(chatId, text, keyboard, priority = false) {
    if (!chatId) {
        console.error('sendNotificationWithKeyboard error: chatId is missing.');
        return Promise.resolve(false);
    }

    let finalChatId = chatId;
    let finalMessage = text;
    let finalKeyboard = keyboard;

    // --- DEV MODE LOGIC ---
    if (process.env.NODE_ENV === 'development') {
        const serviceDevId = process.env.DEV_SERVICE_TELEGRAM_ID;
        const adminDevId = process.env.DEV_ADMIN_TELEGRAM_ID;
        const ownerDevId = process.env.DEV_OWNER_TELEGRAM_ID;

        if (chatId.toString() === serviceDevId || chatId.toString() === adminDevId) {
            const role = chatId.toString() === serviceDevId ? 'СЕРВИС' : 'АДМИН';
            console.log(`[DEV NOTIFY] Перенаправляю уведомление для ${role} (ID: ${chatId}) на владельца (ID: ${ownerDevId})`);
            
            finalChatId = ownerDevId;
            finalMessage = `<b>[DEV] Уведомление для роли "${role}":</b>\n\n${text}`;
            finalKeyboard = undefined; // Убираем клавиатуру в dev режиме
        }
    }
    // --- END DEV MODE LOGIC ---
    
    return queueMessageWithKeyboard(
        finalChatId, 
        finalMessage, 
        finalKeyboard, 
        priority, 
        'notification_with_keyboard'
    );
}

const EXPENSE_INSTRUCTION = `Отправьте сумму и комментарий (по желанию) для записи расхода. Например:\n<b>500 аренда</b>\n<b>1250.50 закупка ингредиентов</b>`;

function parseExpenseMessage(text) {
    if (!text) {
        return { success: false, error: 'Empty message' };
    }
    const parts = text.trim().split(/\s+/);
    if (parts.length === 0) {
        return { success: false, error: 'Empty message' };
    }
    const amountStr = parts[0].replace(',', '.');
    const amount = parseFloat(amountStr);

    if (isNaN(amount) || amount <= 0) {
        return { success: false, error: 'Invalid amount' };
    }
    const comment = parts.slice(1).join(' ').trim();
    const expenses = [{
        amount: amount,
        comment: comment || null
    }];

    return { success: true, expenses };
}

/**
 * Находит ID владельца и всех администраторов, связанных с ним.
 * @param {number} ownerUserId - ID пользователя-владельца.
 * @returns {Promise<Array<number>>} - Массив уникальных Telegram ID.
 */
async function getAdminsAndOwner(ownerUserId) {
    try {
        const query = `
            SELECT telegram_id FROM users WHERE id = $1
            UNION
            SELECT shared_with_telegram_id AS telegram_id
            FROM user_access_rights
            WHERE owner_user_id = $1 AND access_level = 'admin'
        `;
        const result = await pool.query(query, [ownerUserId]);
        return result.rows.filter(u => u.telegram_id).map(u => u.telegram_id);
    } catch (error) {
        console.error(`Error fetching admins and owner for ownerUserId ${ownerUserId}:`, error);
        return [];
    }
}

/**
 * Массово отправляет уведомления нескольким пользователям через очередь
 * @param {Array<number>} telegramIds - Массив Telegram ID
 * @param {string} text - Текст сообщения
 * @param {object} keyboard - Инлайн-клавиатура (опционально)
 * @param {boolean} priority - Высокий приоритет
 * @param {string} context - Контекст для логирования
 */
async function sendBulkNotifications(telegramIds, text, keyboard = null, priority = false, context = 'bulk') {
    if (!Array.isArray(telegramIds) || telegramIds.length === 0) {
        console.warn('[BotHelpers] sendBulkNotifications: No telegram IDs provided');
        return;
    }

    console.log(`[BotHelpers] Queueing bulk notifications to ${telegramIds.length} users: ${context}`);

    const promises = telegramIds.map(telegramId => {
        if (keyboard) {
            return sendNotificationWithKeyboard(telegramId, text, keyboard, priority);
        } else {
            // Импортируем queueMessage из botQueue для простых сообщений
            const { queueMessage } = require('./botQueue');
            return queueMessage(telegramId, text, { parse_mode: 'HTML' }, priority, context);
        }
    });

    try {
        await Promise.all(promises);
        console.log(`[BotHelpers] Successfully queued ${telegramIds.length} notifications`);
    } catch (error) {
        console.error('[BotHelpers] Error queueing bulk notifications:', error);
    }
}

module.exports = {
    sendNotificationWithKeyboard,
    sendBulkNotifications,
    EXPENSE_INSTRUCTION,
    parseExpenseMessage,
    getAdminsAndOwner,
};