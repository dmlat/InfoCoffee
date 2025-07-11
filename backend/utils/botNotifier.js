// backend/utils/botNotifier.js
const bot = require('../bot');

/**
 * Отправляет простое текстовое уведомление пользователю.
 * Поддерживает HTML для форматирования.
 * @param {number|string} chatId ID чата для отправки
 * @param {string} message Сообщение для отправки
 */
const sendNotification = (chatId, message) => {
  if (!chatId) {
    console.error('sendNotification error: chatId is missing.');
    return;
  }
  bot.sendMessage(chatId, message, { parse_mode: 'HTML' }).catch(err => {
    // Не спамим в лог, если пользователь заблокировал бота
    if (err.response && (err.response.statusCode === 403 || err.response.statusCode === 400)) {
        console.warn(`Could not send message to ${chatId}, user might have blocked the bot.`);
    } else {
        console.error(`Error sending notification to chat ${chatId}: ${err.message}`);
    }
  });
};

module.exports = {
  sendNotification,
};