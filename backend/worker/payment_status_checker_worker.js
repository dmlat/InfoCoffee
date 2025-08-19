const { pool } = require('../db');
const { sendErrorToAdmin } = require('../utils/adminErrorNotifier');
const { getNewVendistaToken, refreshToken } = require('../utils/vendista');
const { decrypt, encrypt } = require('../utils/security');
const axios = require('axios');

const VENDISTA_API_URL = process.env.VENDISTA_API_BASE_URL || 'https://api.vendista.ru:99';

/**
 * Проверяет пользователей со статусом 'payment_required' и пытается их реактивировать.
 */
async function checkPaymentStatus() {
    console.log('[PaymentStatusChecker] Starting job to check users with payment_required status.');
    const client = await pool.connect();
    try {
        // 1. Найти всех пользователей, у которых требуется оплата
        const { rows: users } = await client.query(
            "SELECT id, vendista_login, vendista_password, telegram_id, first_name FROM users WHERE vendista_payment_status = 'payment_required'"
        );

        if (users.length === 0) {
            console.log('[PaymentStatusChecker] No users found with payment_required status. Job finished.');
            return;
        }

        console.log(`[PaymentStatusChecker] Found ${users.length} user(s) to check.`);

        for (const user of users) {
            console.log(`[PaymentStatusChecker] Checking user ID: ${user.id} (${user.first_name})...`);

            try {
                // 2. Попытаться выполнить легковесный тестовый запрос к API Vendista
                // Используем получение токена как проверку, так как это базовый запрос
                const vendistaLogin = decrypt(user.vendista_login);
                const vendistaPassword = decrypt(user.vendista_password);

                if (!vendistaLogin || !vendistaPassword) {
                    console.warn(`[PaymentStatusChecker] User ${user.id} has no credentials to check. Skipping.`);
                    continue;
                }
                
                // Это сама проверка. Если она успешна, значит, доступ восстановлен.
                const tokenResponse = await getNewVendistaToken(vendistaLogin, vendistaPassword);

                if (tokenResponse.success) {
                    console.log(`[PaymentStatusChecker] User ${user.id} API access is restored. Reactivating user.`);
                    
                    // 3. Если запрос успешен, обновляем статус и токен
                    await client.query(
                        `UPDATE users 
                         SET 
                            vendista_payment_status = 'active',
                            vendista_api_token = $1, -- Сохраняем свежий токен
                            vendista_token_status = 'valid',
                            updated_at = NOW()
                         WHERE id = $2`,
                        [encrypt(tokenResponse.token), user.id]
                    );

                    console.log(`[PaymentStatusChecker] User ${user.id} status updated to 'active'.`);

                    // 4. Отправляем уведомление администратору
                    await sendErrorToAdmin({
                        errorContext: `Пользователь ID ${user.id} реактивирован`,
                        errorMessage: `✅ Пользователь ${user.first_name} (ID: ${user.id}) оплатил подписку Vendista. Автоматические операции для него возобновлены.`,
                        isInfo: true // Флаг для информационных сообщений
                    });

                } else {
                    // Если запрос не прошел, но это не ошибка 402, возможно другая проблема
                    console.log(`[PaymentStatusChecker] User ${user.id} still has API access issues, but not necessarily payment-related. Details: ${tokenResponse.error}`);
                }

            } catch (error) {
                // Если Vendista API все еще возвращает ошибку, связанную с оплатой, мы ее ожидаем.
                // Логируем, но не считаем это сбоем самого воркера.
                if (error.response && error.response.status === 402) {
                    console.log(`[PaymentStatusChecker] User ${user.id} still requires payment. No changes made.`);
                } else {
                    console.error(`[PaymentStatusChecker] An unexpected error occurred while checking user ${user.id}:`, error.message);
                }
            }
        }

    } catch (error) {
        console.error('[PaymentStatusChecker] A critical error occurred during the job:', error);
        await sendErrorToAdmin({
            errorContext: 'PaymentStatusChecker Worker Failed',
            errorMessage: error.message,
            errorStack: error.stack
        });
    } finally {
        client.release();
        console.log('[PaymentStatusChecker] Job finished.');
    }
}


module.exports = {
    checkPaymentStatus
};
