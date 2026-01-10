// backend/scripts/test_admin_notification.js
require('../utils/envLoader');
const { sendErrorToAdmin } = require('../utils/adminErrorNotifier');

async function test() {
    console.log('Testing Admin Error Notification...');
    try {
        await sendErrorToAdmin({
            userId: 999999,
            errorContext: 'MANUAL_TEST_SCRIPT',
            errorMessage: 'This is a test error notification initiated by the deployment process.',
            errorStack: new Error('Test Error Stack Trace').stack
        });
        console.log('✅ Notification sent successfully (check Admin Telegram chat).');
    } catch (error) {
        console.error('❌ Failed to send notification:', error);
    }
}

test();

