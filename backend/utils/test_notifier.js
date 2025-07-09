// backend/utils/test_notifier.js
const path = require('path');
const envPath = process.env.NODE_ENV === 'development' ? '.env.development' : '.env';
require('dotenv').config({ path: path.resolve(__dirname, `../../${envPath}`) });

const { sendNotification } = require('./botNotifier');
const { sendNotificationWithKeyboard } = require('./botHelpers');

async function testNotify() {
    const args = process.argv.slice(2);
    const telegramId = args[0];
    const message = args[1];
    const useKeyboard = args[2] === 'keyboard';

    if (!telegramId || !message) {
        console.error('Usage: node backend/utils/test_notifier.js <TELEGRAM_ID> "<MESSAGE>" [keyboard]');
        console.error('Example: node backend/utils/test_notifier.js 12345678 "<b>Test Message</b>"');
        console.error('Example with keyboard: node backend/utils/test_notifier.js 12345678 "Test with button" keyboard');
        return;
    }

    console.log(`Sending message to ${telegramId}...`);

    try {
        if (useKeyboard) {
            const keyboard = {
                inline_keyboard: [
                    [{ text: '✅ Тест Выполнено', callback_data: `task_complete_99999` }]
                ]
            };
            await sendNotificationWithKeyboard(telegramId, message, keyboard);
        } else {
            await sendNotification(telegramId, message);
        }
        console.log('Message sent successfully!');
    } catch (error) {
        console.error('Failed to send message:', error.message);
    }
}

testNotify().then(() => process.exit(0));