// backend/utils/botNotifier.js
const { sendNotification: queueNotification } = require('./botQueue');

/**
 * Отправляет простое текстовое уведомление пользователю через систему очередей.
 * Поддерживает HTML для форматирования.
 * @param {number|string} chatId ID чата для отправки
 * @param {string} message Сообщение для отправки
 * @param {boolean} priority Высокий приоритет отправки (по умолчанию false)
 * @returns {Promise<boolean>} true если добавлено в очередь
 */
const sendNotification = (chatId, message, priority = false) => {
  if (!chatId) {
    console.error('[BotNotifier] sendNotification error: chatId is missing.');
    return Promise.resolve(false);
  }
  
  return queueNotification(chatId, message, priority);
};

/**
 * Отправляет уведомления с высоким приоритетом (для критических сообщений)
 * @param {number|string} chatId ID чата для отправки  
 * @param {string} message Сообщение для отправки
 * @returns {Promise<boolean>} true если добавлено в приоритетную очередь
 */
const sendPriorityNotification = (chatId, message) => {
  return sendNotification(chatId, message, true);
};

module.exports = {
  sendNotification,
  sendPriorityNotification,
};