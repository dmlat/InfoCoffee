// backend/utils/botHelpers.js
const bot = require('../bot'); // Импортируем инстанс бота

/**
 * Отправляет сообщение с инлайн-клавиатурой.
 * @param {number|string} chatId - ID чата для отправки.
 * @param {string} text - Текст сообщения (поддерживает HTML).
 * @param {object} keyboard - Объект инлайн-клавиатуры.
 */
function sendNotificationWithKeyboard(chatId, text, keyboard) {
  if (!chatId) {
    console.error('sendNotificationWithKeyboard error: chatId is missing.');
    return;
  }
  
  bot.sendMessage(chatId, text, {
    parse_mode: 'HTML',
    reply_markup: keyboard
  }).catch(error => {
    // Не выводим ошибку, если бот не смог отправить сообщение пользователю, который его заблокировал
    if (error.response && (error.response.statusCode === 403 || error.response.statusCode === 400)) {
        console.warn(`Could not send message to ${chatId}, user might have blocked the bot.`);
    } else {
        console.error(`Error sending message with keyboard to chat ID ${chatId}:`, error.message);
    }
  });
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

module.exports = {
    sendNotificationWithKeyboard,
    EXPENSE_INSTRUCTION,
    parseExpenseMessage,
};