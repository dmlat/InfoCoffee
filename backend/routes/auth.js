// backend/routes/auth.js
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const express = require('express');
const jwt = require('jsonwebtoken');
const pool = require('../db'); // Это наш объект { query: Function, pool: Pool }
const axios = require('axios');
const crypto = require('crypto');
const { startImport } = require('../worker/vendista_import_worker');
const { sendErrorToAdmin } = require('../utils/adminErrorNotifier'); // <--- НОВЫЙ ИМПОРТ

const router = express.Router();

const VENDISTA_API_URL = process.env.VENDISTA_API_BASE_URL || 'https://api.vendista.ru:99';
const JWT_SECRET = process.env.JWT_SECRET;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;

if (!JWT_SECRET || !TELEGRAM_BOT_TOKEN || !ENCRYPTION_KEY) {
    console.error("FATAL ERROR: JWT_SECRET, TELEGRAM_BOT_TOKEN, or ENCRYPTION_KEY is not defined in .env file.");
    // process.exit(1); 
}

const ALGORITHM = 'aes-256-cbc';
const IV_LENGTH = 16; 

function encrypt(text) {
    if (!ENCRYPTION_KEY) {
        console.error('ENCRYPTION_KEY is not set. Cannot encrypt.');
        throw new Error('Encryption key not set.');
    }
    const key = Buffer.from(ENCRYPTION_KEY, 'hex');
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return iv.toString('hex') + ':' + encrypted;
}

function decrypt(text) { 
    if (!ENCRYPTION_KEY) {
        console.error('ENCRYPTION_KEY is not set. Cannot decrypt.');
        throw new Error('Encryption key not set.');
    }
    if (!text || typeof text !== 'string' || !text.includes(':')) {
        console.error('Invalid text format for decryption:', text);
        return null; 
    }
    try {
        const textParts = text.split(':');
        const iv = Buffer.from(textParts.shift(), 'hex');
        const encryptedText = Buffer.from(textParts.join(':'), 'hex');
        const key = Buffer.from(ENCRYPTION_KEY, 'hex');
        const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
        let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
    } catch (error) {
        console.error('Decryption failed:', error);
        return null;
    }
}

const validateTelegramInitData = (initDataString) => {
    // ... (код validateTelegramInitData остается без изменений)
    if (!TELEGRAM_BOT_TOKEN) {
        console.warn('[Auth Validate] TELEGRAM_BOT_TOKEN not configured. Critical for validation. Skipping hash check (DEV ONLY).');
        try {
            const params = new URLSearchParams(initDataString);
            const user = params.get('user');
            if (!user) return { valid: false, data: null, error: "No user data in initData (dev mode)" };
            return { valid: true, data: JSON.parse(decodeURIComponent(user)) };
        } catch (e) {
            console.error('[Auth Validate] Error parsing user data without validation:', e);
            return { valid: false, data: null, error: "Error parsing user data (dev mode)" };
        }
    }
    try {
        const params = new URLSearchParams(initDataString);
        const hash = params.get('hash');
        if (!hash) {
            return { valid: false, data: null, error: "No hash in initData" };
        }
        params.delete('hash');
        
        const dataCheckArr = [];
        const sortedKeys = Array.from(params.keys()).sort();
        sortedKeys.forEach(key => {
            dataCheckArr.push(`${key}=${params.get(key)}`);
        });
        const dataCheckString = dataCheckArr.join('\n');

        const secretKey = crypto.createHmac('sha256', 'WebAppData').update(TELEGRAM_BOT_TOKEN).digest();
        const calculatedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

        if (calculatedHash === hash) {
            const user = params.get('user');
            if (!user) return { valid: false, data: null, error: "No user data in initData" };
            return { valid: true, data: JSON.parse(decodeURIComponent(user)) };
        }
        console.warn('[Auth Validate] Hash mismatch. Calculated:', calculatedHash, 'Received:', hash, 'DataString:', dataCheckString);
        return { valid: false, data: null, error: "Hash mismatch" };
    } catch (e) {
        console.error('[Auth Validate] Error during validation:', e);
        return { valid: false, data: null, error: e.message };
    }
};

router.post('/telegram-handshake', async (req, res) => {
    const { initData } = req.body;
    console.log('[POST /api/auth/telegram-handshake] Received initData request');

    if (!initData) {
        return res.status(400).json({ success: false, error: 'initData is required.' });
    }

    const validationResult = validateTelegramInitData(initData);
    let telegramUserForError = null;
    if (validationResult.data) {
        telegramUserForError = validationResult.data;
    }


    if (!validationResult.valid || !validationResult.data?.id) {
        const errorMsg = `Invalid Telegram data: ${validationResult.error || 'Unknown validation error'}`;
        console.warn('[POST /api/auth/telegram-handshake] Failed: Invalid Telegram data.', validationResult.error || 'Unknown validation error');
        sendErrorToAdmin({
            telegramId: telegramUserForError?.id,
            userFirstName: telegramUserForError?.first_name,
            userUsername: telegramUserForError?.username,
            errorContext: 'Telegram Handshake Validation',
            errorMessage: errorMsg,
            additionalInfo: { initDataProvided: !!initData }
        }).catch(notifyErr => console.error("Failed to send admin notification from telegram-handshake validation:", notifyErr));
        return res.status(403).json({ success: false, error: errorMsg });
    }

    const telegramUser = validationResult.data;
    const telegram_id = telegramUser.id;
    console.log(`[POST /api/auth/telegram-handshake] Validated Telegram ID: ${telegram_id}`);

    try {
        const userResult = await pool.query('SELECT id, vendista_api_token, setup_date, tax_system, acquiring, first_name, user_name FROM users WHERE telegram_id = $1', [telegram_id]);

        if (userResult.rows.length > 0) {
            const user = userResult.rows[0];
            console.log(`[POST /api/auth/telegram-handshake] User found with ID: ${user.id}`);
            if (user.vendista_api_token) {
                console.log(`[POST /api/auth/telegram-handshake] User ${user.id} is fully registered. Action: login_success`);
                const appToken = jwt.sign({ userId: user.id, telegramId: telegram_id.toString() }, JWT_SECRET, { expiresIn: '12h' });
                res.json({
                    success: true,
                    action: 'login_success',
                    token: appToken,
                    user: {
                        userId: user.id,
                        telegramId: telegram_id.toString(),
                        firstName: user.first_name || telegramUser.first_name, // Данные из БД, если есть, иначе из initData
                        username: user.user_name || telegramUser.username,     // Данные из БД, если есть, иначе из initData
                        setup_date: user.setup_date,
                        tax_system: user.tax_system,
                        acquiring: user.acquiring !== null ? String(user.acquiring) : null,
                    }
                });
            } else {
                console.log(`[POST /api/auth/telegram-handshake] User ${user.id} registration incomplete (no Vendista token). Action: registration_incomplete`);
                res.json({
                    success: true,
                    action: 'registration_incomplete',
                    telegram_id: telegram_id.toString(), 
                    firstName: user.first_name || telegramUser.first_name,
                    username: user.user_name || telegramUser.username,
                });
            }
        } else {
            console.log(`[POST /api/auth/telegram-handshake] New user. Action: registration_required`);
            res.json({
                success: true,
                action: 'registration_required',
                telegram_id: telegram_id.toString(),
                firstName: telegramUser.first_name,
                username: telegramUser.username,
            });
        }
    } catch (err) {
        console.error("[POST /api/auth/telegram-handshake] Database/server error:", err);
        sendErrorToAdmin({
            telegramId: telegram_id,
            userFirstName: telegramUser?.first_name,
            userUsername: telegramUser?.username,
            errorContext: 'Telegram Handshake DB/Server',
            errorMessage: err.message,
            errorStack: err.stack
        }).catch(notifyErr => console.error("Failed to send admin notification from telegram-handshake DB error:", notifyErr));
        res.status(500).json({ success: false, error: 'Server error during handshake.' });
    }
});

router.post('/validate-vendista', async (req, res) => {
    const { telegram_id, vendista_login, vendista_password } = req.body;
    console.log(`[POST /api/auth/validate-vendista] TG ID: ${telegram_id}, Login: ${vendista_login}`);

    if (!telegram_id || !vendista_login || !vendista_password) {
        return res.status(400).json({ success: false, error: 'Telegram ID, Vendista login, and password are required.' });
    }

    try {
        console.log(`[POST /api/auth/validate-vendista] Requesting Vendista token from ${VENDISTA_API_URL}/token`);
        const tokenResp = await axios.get(`${VENDISTA_API_URL}/token`, {
            params: { login: vendista_login, password: vendista_password },
            timeout: 15000 
        });

        if (tokenResp.data && tokenResp.data.token) {
            const vendista_api_token = tokenResp.data.token;
            console.log(`[POST /api/auth/validate-vendista] Vendista token obtained for TG ID: ${telegram_id}`);
            res.json({ success: true, vendista_api_token_plain: vendista_api_token });
        } else {
            const errorMsg = tokenResp.data.error || 'Неверные учетные данные Vendista или не удалось получить токен.';
            console.warn(`[POST /api/auth/validate-vendista] Failed to get Vendista token for TG ID: ${telegram_id}. Response:`, tokenResp.data);
            sendErrorToAdmin({
                telegramId: telegram_id,
                errorContext: `Validate Vendista API for TG ID: ${telegram_id}`,
                errorMessage: errorMsg,
                additionalInfo: { vendistaResponse: tokenResp.data }
            }).catch(notifyErr => console.error("Failed to send admin notification from validate-vendista API error:", notifyErr));
            res.status(401).json({ success: false, error: errorMsg });
        }
    } catch (err) {
        console.error("[POST /api/auth/validate-vendista] Error:", err.response?.data || err.message);
        let errorMessage = 'Ошибка подключения к Vendista.';
        if (err.response?.status === 401 || err.response?.data?.error?.toLowerCase().includes('auth')) {
            errorMessage = 'Неверный логин или пароль Vendista.';
        } else if (err.response?.data?.error) {
            errorMessage = err.response.data.error;
        } else if (err.code === 'ECONNABORTED') {
            errorMessage = 'Тайм-аут при подключении к Vendista.';
        }
        sendErrorToAdmin({
            telegramId: telegram_id,
            errorContext: `Validate Vendista Network/Server for TG ID: ${telegram_id}`,
            errorMessage: errorMessage,
            errorStack: err.stack,
            additionalInfo: { responseData: err.response?.data, errorCode: err.code }
        }).catch(notifyErr => console.error("Failed to send admin notification from validate-vendista catch:", notifyErr));
        res.status(err.response?.status || 500).json({ success: false, error: errorMessage });
    }
});

router.post('/complete-registration', async (req, res) => {
    const { telegram_id, vendista_api_token_plain, setup_date, tax_system, acquiring, firstName, username } = req.body;
    console.log(`[POST /api/auth/complete-registration] Completing registration for TG ID: ${telegram_id}`);

    if (!telegram_id || !vendista_api_token_plain || !setup_date) {
        return res.status(400).json({ success: false, error: 'Отсутствуют необходимые данные для регистрации (telegram_id, vendista_api_token_plain, setup_date).' });
    }

    let encryptedVendistaToken;
    try {
        encryptedVendistaToken = encrypt(vendista_api_token_plain);
    } catch (encErr) {
        console.error("[POST /api/auth/complete-registration] Encryption error:", encErr);
        sendErrorToAdmin({ // <--- Уведомление об ошибке шифрования
            telegramId: telegram_id,
            userFirstName: firstName,
            userUsername: username,
            errorContext: `Complete Registration - Encryption for TG ID: ${telegram_id}`,
            errorMessage: encErr.message,
            errorStack: encErr.stack
        }).catch(notifyErr => console.error("Failed to send admin notification from encryption error:", notifyErr));
        return res.status(500).json({ success: false, error: 'Ошибка шифрования токена на сервере.' });
    }
    
    const client = await pool.pool.connect();
    try {
        await client.query('BEGIN');
        let userQueryResult = await client.query('SELECT id FROM users WHERE telegram_id = $1', [telegram_id]);
        let userId;
        let userAction = '';

        const acquiringValue = acquiring !== null && acquiring !== undefined && String(acquiring).trim() !== '' ? parseFloat(String(acquiring).replace(',', '.')) : null;

        if (userQueryResult.rows.length > 0) {
            userId = userQueryResult.rows[0].id;
            userAction = 'updated';
            console.log(`[POST /api/auth/complete-registration] Updating existing user ID: ${userId} for TG ID: ${telegram_id}`);
            // Теперь first_name и user_name есть в таблице, и этот запрос должен работать
            await client.query(
                `UPDATE users SET vendista_api_token = $1, setup_date = $2, tax_system = $3, acquiring = $4, updated_at = NOW(), first_name = $6, user_name = $7
                 WHERE id = $5`,
                [encryptedVendistaToken, setup_date, tax_system || null, acquiringValue, userId, firstName || null, username || null]
            );
        } else {
            userAction = 'created';
            console.log(`[POST /api/auth/complete-registration] Inserting new user for TG ID: ${telegram_id}`);
            // Теперь first_name и user_name есть в таблице, и этот запрос должен работать
            const insertResult = await client.query(
                `INSERT INTO users (telegram_id, vendista_api_token, setup_date, tax_system, acquiring, first_name, user_name, created_at, updated_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW()) RETURNING id`,
                [BigInt(telegram_id), encryptedVendistaToken, setup_date, tax_system || null, acquiringValue, firstName || null, username || null]
            );
            userId = insertResult.rows[0].id;
            console.log(`[POST /api/auth/complete-registration] New user created with ID: ${userId}`);
        }
        await client.query('COMMIT');

        console.log(`[POST /api/auth/complete-registration] Initiating first import for user ID: ${userId}`);
        startImport({
            user_id: userId,
            vendistaApiToken: vendista_api_token_plain, 
            first_coffee_date: setup_date
        }).catch(importError => {
            console.error(`[POST /api/auth/complete-registration] Initial import failed for user ${userId}:`, importError.message, importError.stack);
            sendErrorToAdmin({ // <--- Уведомление об ошибке импорта
                userId: userId,
                telegramId: telegram_id,
                userFirstName: firstName,
                userUsername: username,
                errorContext: `Initial Import after registration for User ID: ${userId}`,
                errorMessage: importError.message,
                errorStack: importError.stack
            }).catch(notifyErr => console.error("Failed to send admin notification for initial import error:", notifyErr));
        });

        const appToken = jwt.sign({ userId: userId, telegramId: telegram_id.toString() }, JWT_SECRET, { expiresIn: '12h' });

        res.status(userAction === 'created' ? 201 : 200).json({
            success: true,
            token: appToken,
            user: { 
                userId: userId,
                telegramId: telegram_id.toString(),
                firstName: firstName, 
                username: username,   
                setup_date: setup_date,
                tax_system: tax_system,
                acquiring: acquiringValue !== null ? String(acquiringValue) : null,
            }
        });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error("[POST /api/auth/complete-registration] Error during DB transaction:", err);
        sendErrorToAdmin({ // <--- Уведомление об ошибке транзакции БД
            telegramId: telegram_id,
            userFirstName: firstName,
            userUsername: username,
            errorContext: `Complete Registration DB Transaction for TG ID: ${telegram_id}`,
            errorMessage: err.message,
            errorStack: err.stack,
            additionalInfo: { code: err.code, constraint: err.constraint }
        }).catch(notifyErr => console.error("Failed to send admin notification for DB transaction error:", notifyErr));

        if (err.code === '23505' && err.constraint === 'users_telegram_id_unique') {
            return res.status(409).json({ success: false, error: 'Этот Telegram аккаунт уже зарегистрирован.' });
        }
        res.status(500).json({ success: false, error: 'Ошибка сервера при завершении регистрации.' });
    } finally {
        client.release();
    }
});

router.post('/refresh-app-token', async (req, res) => {
    const { initData } = req.body;
    console.log('[POST /api/auth/refresh-app-token] Received request for token refresh');

    if (!initData) {
        return res.status(400).json({ success: false, error: 'initData is required for token refresh.' });
    }

    const validationResult = validateTelegramInitData(initData);
    let telegramUserForErrorRefresh = null;
    if (validationResult.data) {
        telegramUserForErrorRefresh = validationResult.data;
    }

    if (!validationResult.valid || !validationResult.data?.id) {
        const errorMsg = `Invalid Telegram data for refresh: ${validationResult.error || 'Unknown'}`;
        console.warn('[POST /api/auth/refresh-app-token] Failed: Invalid Telegram initData for refresh.', validationResult.error);
        sendErrorToAdmin({
            telegramId: telegramUserForErrorRefresh?.id,
            userFirstName: telegramUserForErrorRefresh?.first_name,
            userUsername: telegramUserForErrorRefresh?.username,
            errorContext: 'Refresh App Token Validation',
            errorMessage: errorMsg
        }).catch(notifyErr => console.error("Failed to send admin notification from refresh token validation:", notifyErr));
        return res.status(401).json({ success: false, error: errorMsg });
    }
    
    const telegramUser = validationResult.data;
    const telegram_id = telegramUser.id;
    console.log(`[POST /api/auth/refresh-app-token] Validated Telegram ID: ${telegram_id} for refresh`);

    try {
        const userRes = await pool.query(
            'SELECT id, setup_date, tax_system, acquiring, vendista_api_token, first_name, user_name FROM users WHERE telegram_id = $1',
            [telegram_id]
        );

        if (userRes.rows.length === 0) {
            const errorMsg = 'Пользователь не найден. Пожалуйста, войдите снова.';
            console.warn(`[POST /api/auth/refresh-app-token] User not found for TG ID: ${telegram_id}. Cannot refresh token.`);
            sendErrorToAdmin({
                telegramId: telegram_id,
                userFirstName: telegramUser.first_name,
                userUsername: telegramUser.username,
                errorContext: 'Refresh App Token - User Not Found',
                errorMessage: errorMsg
            }).catch(notifyErr => console.error("Failed to send admin notification for refresh token user not found:", notifyErr));
            return res.status(401).json({ success: false, error: errorMsg });
        }
        
        const user = userRes.rows[0];
        if (!user.vendista_api_token) {
            const errorMsg = 'Настройка аккаунта не завершена. Невозможно обновить токен.';
            console.warn(`[POST /api/auth/refresh-app-token] User ${user.id} (TG: ${telegram_id}) missing Vendista API token. Cannot refresh.`);
             sendErrorToAdmin({
                userId: user.id,
                telegramId: telegram_id,
                userFirstName: user.first_name || telegramUser.first_name,
                userUsername: user.user_name || telegramUser.username,
                errorContext: 'Refresh App Token - Vendista Token Missing',
                errorMessage: errorMsg
            }).catch(notifyErr => console.error("Failed to send admin notification for refresh token missing vendista token:", notifyErr));
            return res.status(401).json({ success: false, error: errorMsg });
        }
        
        const newAppToken = jwt.sign({ userId: user.id, telegramId: telegram_id.toString() }, JWT_SECRET, { expiresIn: '12h' });
        
        console.log(`[POST /api/auth/refresh-app-token] App token refreshed for user ${user.id} (TG: ${telegram_id})`);
        res.json({
            success: true,
            token: newAppToken,
            user: { 
                userId: user.id,
                telegramId: telegram_id.toString(),
                firstName: user.first_name || telegramUser.first_name, 
                username: user.user_name || telegramUser.username,   
                setup_date: user.setup_date,
                tax_system: user.tax_system,
                acquiring: user.acquiring !== null ? String(user.acquiring) : null,
            }
        });
    } catch (err) {
        console.error("[POST /api/auth/refresh-app-token] Error during token refresh:", err);
        sendErrorToAdmin({
            telegramId: telegram_id,
            userFirstName: telegramUser?.first_name,
            userUsername: telegramUser?.username,
            errorContext: 'Refresh App Token - Server Error',
            errorMessage: err.message,
            errorStack: err.stack
        }).catch(notifyErr => console.error("Failed to send admin notification for refresh token server error:", notifyErr));
        res.status(500).json({ success: false, error: 'Внутренняя ошибка сервера при обновлении токена.' });
    }
});

module.exports = router;