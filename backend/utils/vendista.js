const axios = require('axios');
const db = require('../db');
const { encrypt, decrypt } = require('./security');
const { sendErrorToAdmin } = require('./adminErrorNotifier');

const VENDISTA_API_BASE_URL = process.env.VENDISTA_API_BASE_URL || 'https://api.vendista.ru:99';

async function getNewVendistaToken(login, password) {
    const VENDISTA_API_URL = process.env.VENDISTA_API_BASE_URL || 'https://api.vendista.ru:99';
    try {
        const response = await axios.get(`${VENDISTA_API_URL}/token`, {
            params: {
                Login: login,
                Password: password
            },
            timeout: 15000
        });
        if (response.data && response.data.token) {
            return { success: true, token: response.data.token };
        } else {
            return { success: false, error: 'Ответ API не содержит токен' };
        }
    } catch (error) {
        console.error(`[Vendista Util] Error fetching new token for login ${login}:`, error.message);
        if (error.response) {
            if (error.response.status === 404 || error.response.status === 401) {
                 return { success: false, error: 'Неверный логин или пароль Vendista' };
            }
            if (error.response.status === 402) {
                return { success: false, error: 'Требуется оплата Vendista' };
            }
            return { success: false, error: `Ошибка API Vendista: ${error.response.status} ${error.response.statusText}` };
        }
        return { success: false, error: 'Ошибка сети при подключении к Vendista' };
    }
}

async function refreshToken(userId) {
    let client;
    try {
        client = await db.pool.connect();
        await client.query('BEGIN');

        const { rows: userRows } = await client.query('SELECT vendista_login, vendista_password FROM users WHERE id = $1', [userId]);
        if (userRows.length === 0) {
            throw new Error(`User with ID ${userId} not found.`);
        }

        const user = userRows[0];
        const login = decrypt(user.vendista_login);
        const password = decrypt(user.vendista_password);

        if (!login || !password) {
            await client.query("UPDATE users SET vendista_token_status = 'invalid_creds' WHERE id = $1", [userId]);
            await client.query('COMMIT');
            sendErrorToAdmin({
                errorMessage: `Failed to refresh token for user ${userId}: Credentials not found or decryption failed. Manual intervention required.`,
                errorContext: 'refreshToken',
                userId: userId
            });
            return { success: false, error: 'invalid_credentials' };
        }

        const newTokenResponse = await getNewVendistaToken(login, password);

        if (newTokenResponse.success) {
            const encryptedToken = encrypt(newTokenResponse.token);
            await client.query(
                "UPDATE users SET vendista_api_token = $1, vendista_token_status = 'valid', updated_at = NOW() WHERE id = $2",
                [encryptedToken, user.id]
            );
            await client.query('COMMIT');
            return { success: true, token: newTokenResponse.token };
        } else {
            // Если не удалось обновить токен из-за неверных учетных данных
            await client.query(
                "UPDATE users SET vendista_token_status = 'invalid_creds', updated_at = NOW() WHERE id = $1",
                [userId]
            );
            await client.query('COMMIT');
            sendErrorToAdmin({
                errorMessage: `Failed to refresh token for user ${userId}: Invalid credentials.`,
                errorContext: 'refreshToken',
                userId: userId
            });
            return { success: false, error: newTokenResponse.error };
        }

    } catch (error) {
        if (client) {
            await client.query('ROLLBACK');
        }
        console.error(`[Vendista Util] Critical error during token refresh for user ${userId}:`, error);
        sendErrorToAdmin({
            errorMessage: `Critical error during token refresh for user ${userId}: ${error.message}`,
            errorContext: 'refreshToken',
            userId: userId,
            errorStack: error.stack
        });
        return { success: false, error: 'internal_error' };
    } finally {
        if (client) {
            client.release();
        }
    }
}

module.exports = {
    getNewVendistaToken,
    refreshToken
}; 