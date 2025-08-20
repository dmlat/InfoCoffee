// backend/devBotHandlers.js

const { sendErrorToAdmin, getNotificationStats, sendCriticalError } = require('./utils/adminErrorNotifier');

// Импортируем функции мониторинга, которые мы создадим позже
const { checkNginxStatus, checkSslCertificate } = require('./utils/monitoring');

function setupAdminBotCommands(bot) {
    if (process.env.NODE_ENV === 'development') {
        console.log("Регистрация админ-команд в DEV-режиме...");
    }

    // --- Команда /status: Проверка состояния системы ---
    bot.onText(/\/status/, async (msg) => {
        const chatId = msg.chat.id;

        // Проверяем, что команду вызывает администратор
        if (String(chatId) !== process.env.ADMIN_TELEGRAM_CHAT_ID_FOR_ERRORS) {
            bot.sendMessage(chatId, "Эта команда доступна только администратору.");
            return;
        }

        try {
            // 1. Статус Nginx
            const nginxStatus = await checkNginxStatus();

            // 2. Статус SSL сертификата
            const sslStatus = await checkSslCertificate();

            // 3. Статистика ошибок из adminErrorNotifier
            const errorStats = getNotificationStats();
            
            // Формируем сообщение
            let statusMessage = `<b>📊 Системный статус InfoCoffee 📊</b>\n\n`;
            statusMessage += `<b>Веб-сервер (Nginx):</b> ${nginxStatus.status}\n`;
            if (nginxStatus.error) {
                statusMessage += `   - Ошибка: <code>${nginxStatus.error}</code>\n`;
            }

            statusMessage += `\n<b>SSL Сертификат (infocoffee.ru):</b>\n`;
            statusMessage += `   - ${sslStatus.status}\n`;
            if (sslStatus.daysRemaining !== null) {
                statusMessage += `   - Осталось дней: ${sslStatus.daysRemaining}\n`;
            }
            if (sslStatus.error) {
                statusMessage += `   - Ошибка: <code>${sslStatus.error}</code>\n`;
            }
            
            statusMessage += `\n<b>Уведомления об ошибках:</b>\n`;
            statusMessage += `   - Ошибок в очереди: ${errorStats.queueLength}\n`;
            statusMessage += `   - Сообщений за час: ${errorStats.hourlyMessageCount} / 20\n`;
            statusMessage += `   - Размер кэша: ${errorStats.cacheSize}\n`;
            
            bot.sendMessage(chatId, statusMessage, { parse_mode: 'HTML' });

        } catch (error) {
            console.error("Ошибка при выполнении /status:", error);
            bot.sendMessage(chatId, "Не удалось получить статус системы. Проверьте логи.");
            sendCriticalError(error.message, 'Команда /status');
        }
    });

    // --- Команда /help: Список команд ---
    bot.onText(/\/help/, (msg) => {
        const chatId = msg.chat.id;
        
        if (String(chatId) !== process.env.ADMIN_TELEGRAM_CHAT_ID_FOR_ERRORS) {
            return; 
        }

        const helpMessage = `<b>Админ-панель InfoCoffee Bot</b>\n\n` +
                            `Доступные команды:\n` +
                            `/status - Показать текущий статус Nginx, SSL и системы ошибок.\n` +
                            `/help - Показать это сообщение.\n`;

        bot.sendMessage(chatId, helpMessage, { parse_mode: 'HTML' });
    });
    
    if (process.env.NODE_ENV === 'development') {
        console.log("Админ-команды зарегистрированы.");
    }
}

module.exports = { setupAdminBotCommands };
