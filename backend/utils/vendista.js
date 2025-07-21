const axios = require('axios');
const db = require('../db');
const { encrypt, decrypt } = require('./security');
const { sendErrorToAdmin } = require('./adminErrorNotifier');

const VENDISTA_API_BASE_URL = process.env.VENDISTA_API_BASE_URL || 'https://api.vendista.ru:99';

async function getNewVendistaToken(login, password) {
    try {
        const response = await axios.get(`${VENDISTA_API_BASE_URL}/token`, {
            params: {
                Login: login,
                Password: password
            }
        });
        if (response.data && response.data.token) {
            return response.data.token;
        }
        return null;
    } catch (error) {
        console.error(`[getNewVendistaToken] Failed to get new token for login ${login}. URL: ${error.config?.url}. Status: ${error.response?.status}.`, error.response?.data);
        return null;
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
                message: `Failed to refresh token for user ${userId}: Credentials not found or decryption failed. Manual intervention required.`,
                context: 'refreshToken'
            });
            return { success: false, error: 'invalid_credentials' };
        }

        const newToken = await getNewVendistaToken(login, password);

        if (newToken) {
            const encryptedToken = encrypt(newToken);
            await client.query(
                "UPDATE users SET vendista_api_token = $1, vendista_token_status = 'valid', updated_at = NOW() WHERE id = $2",
                [encryptedToken, userId]
            );
            await client.query('COMMIT');
            console.log(`[refreshToken] Successfully refreshed and updated token for user ${userId}.`);
            return { success: true, token: newToken };
        } else {
            await client.query("UPDATE users SET vendista_token_status = 'invalid_creds' WHERE id = $1", [userId]);
            await client.query('COMMIT');
            sendErrorToAdmin({
                message: `Failed to get new Vendista token for user ${userId}. Credentials might be invalid.`,
                context: 'refreshToken'
            });
            return { success: false, error: 'token_fetch_failed' };
        }
    } catch (error) {
        if (client) {
            await client.query('ROLLBACK');
        }
        console.error(`[refreshToken] Error refreshing token for user ${userId}:`, error);
        sendErrorToAdmin({
            message: `Critical error during token refresh for user ${userId}: ${error.message}`,
            context: 'refreshToken'
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