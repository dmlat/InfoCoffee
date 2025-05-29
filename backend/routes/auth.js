// backend/routes/auth.js
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const express = require('express');
const jwt = require('jsonwebtoken');
const pool = require('../db'); // Это наш объект { query: Function, pool: Pool }
const axios = require('axios');
const crypto = require('crypto');
const { startImport } = require('../worker/vendista_import_worker');

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
    let encrypted = cipher.update(text, 'utf8'); // Указываем кодировку для Buffer.from(text)
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    return iv.toString('hex') + ':' + encrypted.toString('hex');
}

function decrypt(text) { // Эта функция пока не используется в auth.js, но может пригодиться
    if (!ENCRYPTION_KEY) {
        console.error('ENCRYPTION_KEY is not set. Cannot decrypt.');
        throw new Error('Encryption key not set.');
    }
    if (!text || typeof text !== 'string' || !text.includes(':')) {
        console.error('Invalid text format for decryption:', text);
        // Можно возвращать null или выбрасывать ошибку в зависимости от логики использования
        return null; 
    }
    try {
        const key = Buffer.from(ENCRYPTION_KEY, 'hex');
        const textParts = text.split(':');
        const iv = Buffer.from(textParts.shift(), 'hex');
        const encryptedText = Buffer.from(textParts.join(':'), 'hex');
        const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
        let decrypted = decipher.update(encryptedText);
        decrypted = Buffer.concat([decrypted, decipher.final()]);
        return decrypted.toString('utf8'); // Указываем кодировку
    } catch (error) {
        console.error('Decryption failed:', error);
        return null; // Или throw error;
    }
}

const validateTelegramInitData = (initDataString) => {
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
        for (const [key, value] of params.entries()) {
            dataCheckArr.push(`${key}=${value}`);
        }
        dataCheckArr.sort();
        const dataCheckString = dataCheckArr.join('\n');

        const secretKey = crypto.createHmac('sha256', 'WebAppData').update(TELEGRAM_BOT_TOKEN).digest();
        const calculatedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

        if (calculatedHash === hash) {
            const user = params.get('user');
            if (!user) return { valid: false, data: null, error: "No user data in initData" };
            return { valid: true, data: JSON.parse(decodeURIComponent(user)) };
        }
        console.warn('[Auth Validate] Hash mismatch.');
        return { valid: false, data: null, error: "Hash mismatch" };
    } catch (e) {
        console.error('[Auth Validate] Error during validation:', e);
        return { valid: false, data: null, error: e.message };
    }
};

router.post('/telegram-handshake', async (req, res) => {
    const { initData } = req.body;
    console.log('[POST /api/auth/telegram-handshake] Received request');

    if (!initData) {
        return res.status(400).json({ success: false, error: 'initData is required.' });
    }

    const validationResult = validateTelegramInitData(initData);
    if (!validationResult.valid || !validationResult.data?.id) {
        console.warn('[POST /api/auth/telegram-handshake] Failed: Invalid Telegram data.', validationResult.error || 'Unknown validation error');
        return res.status(403).json({ success: false, error: `Invalid Telegram data: ${validationResult.error || 'Unknown validation error'}` });
    }

    const telegramUser = validationResult.data;
    const telegram_id = telegramUser.id; // Это число
    console.log(`[POST /api/auth/telegram-handshake] Validated Telegram ID: ${telegram_id}`);

    try {
        const userResult = await pool.query('SELECT id, vendista_api_token, setup_date, tax_system, acquiring FROM users WHERE telegram_id = $1', [telegram_id]);

        if (userResult.rows.length > 0) {
            const user = userResult.rows[0];
            console.log(`[POST /api/auth/telegram-handshake] User found with ID: ${user.id}`);
            if (user.vendista_api_token) {
                console.log(`[POST /api/auth/telegram-handshake] User ${user.id} is fully registered. Action: login_success`);
                const appToken = jwt.sign({ userId: user.id, telegramId: telegram_id }, JWT_SECRET, { expiresIn: '12h' });
                res.json({
                    success: true,
                    action: 'login_success',
                    token: appToken,
                    user: {
                        userId: user.id,
                        telegramId: telegram_id.toString(),
                        firstName: telegramUser.first_name,
                        username: telegramUser.username,
                        setup_date: user.setup_date,
                        tax_system: user.tax_system,
                        acquiring: user.acquiring !== null ? String(user.acquiring) : null,
                    }
                });
            } else {
                console.log(`[POST /api/auth/telegram-handshake] User ${user.id} registration incomplete. Action: registration_incomplete`);
                res.json({
                    success: true,
                    action: 'registration_incomplete',
                    telegram_id: telegram_id.toString(),
                    firstName: telegramUser.first_name,
                    username: telegramUser.username,
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
            console.warn(`[POST /api/auth/validate-vendista] Failed to get Vendista token for TG ID: ${telegram_id}. Response:`, tokenResp.data);
            res.status(401).json({ success: false, error: 'Неверные учетные данные Vendista или не удалось получить токен.' });
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
        res.status(err.response?.status || 500).json({ success: false, error: errorMessage });
    }
});

router.post('/complete-registration', async (req, res) => {
    const { telegram_id, vendista_api_token_plain, setup_date, tax_system, acquiring, firstName, username } = req.body;
    console.log(`[POST /api/auth/complete-registration] TG ID: ${telegram_id}`);

    if (!telegram_id || !vendista_api_token_plain || !setup_date) {
        return res.status(400).json({ success: false, error: 'Отсутствуют необходимые данные для регистрации.' });
    }

    let encryptedVendistaToken;
    try {
        encryptedVendistaToken = encrypt(vendista_api_token_plain);
    } catch (encErr) {
        console.error("[POST /api/auth/complete-registration] Encryption error:", encErr);
        return res.status(500).json({ success: false, error: 'Ошибка шифрования на сервере.' });
    }
    
    // ИЗМЕНЕНИЕ ЗДЕСЬ: используем pool.pool для получения клиента для транзакции
    const client = await pool.pool.connect(); // <--- ИЗМЕНЕНИЕ

    try {
        await client.query('BEGIN');
        let userQueryResult = await client.query('SELECT id FROM users WHERE telegram_id = $1', [telegram_id]);
        let userId;
        let userAction = '';

        if (userQueryResult.rows.length > 0) {
            userId = userQueryResult.rows[0].id;
            userAction = 'updated';
            console.log(`[POST /api/auth/complete-registration] Updating existing user ID: ${userId} for TG ID: ${telegram_id}`);
            await client.query(
                `UPDATE users SET vendista_api_token = $1, setup_date = $2, tax_system = $3, acquiring = $4, updated_at = NOW()
                 WHERE id = $5`,
                [encryptedVendistaToken, setup_date, tax_system || null, acquiring || null, userId]
            );
        } else {
            userAction = 'created';
            console.log(`[POST /api/auth/complete-registration] Inserting new user for TG ID: ${telegram_id}`);
            const insertResult = await client.query(
                `INSERT INTO users (telegram_id, vendista_api_token, setup_date, tax_system, acquiring, created_at, updated_at)
                 VALUES ($1, $2, $3, $4, $5, NOW(), NOW()) RETURNING id`,
                [BigInt(telegram_id), encryptedVendistaToken, setup_date, tax_system || null, acquiring || null]
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
        }).catch(importError => console.error(`[POST /api/auth/complete-registration] Initial import failed for user ${userId}:`, importError.message));

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
                acquiring: acquiring !== null ? String(acquiring) : null,
            }
        });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error("[POST /api/auth/complete-registration] Error:", err);
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
    console.log('[POST /api/auth/refresh-app-token] Received request');

    if (!initData) {
        return res.status(400).json({ success: false, error: 'initData is required.' });
    }

    const validationResult = validateTelegramInitData(initData);
    if (!validationResult.valid || !validationResult.data?.id) {
        console.warn('[POST /api/auth/refresh-app-token] Failed: Invalid Telegram initData.', validationResult.error);
        return res.status(401).json({ success: false, error: `Invalid Telegram data for refresh: ${validationResult.error || 'Unknown'}` });
    }
    
    const telegramUser = validationResult.data;
    const telegram_id = telegramUser.id;
    console.log(`[POST /api/auth/refresh-app-token] Validated Telegram ID: ${telegram_id} for refresh`);

    try {
        const userRes = await pool.query(
            'SELECT id, setup_date, tax_system, acquiring, vendista_api_token FROM users WHERE telegram_id = $1',
            [telegram_id]
        );

        if (userRes.rows.length === 0) {
            console.warn(`[POST /api/auth/refresh-app-token] User not found for TG ID: ${telegram_id}`);
            return res.status(401).json({ success: false, error: 'Пользователь не найден. Пожалуйста, войдите снова.' });
        }
        
        const user = userRes.rows[0];
        if (!user.vendista_api_token) {
            console.warn(`[POST /api/auth/refresh-app-token] User ${user.id} (TG: ${telegram_id}) missing Vendista API token.`);
            return res.status(401).json({ success: false, error: 'Настройка аккаунта не завершена. Невозможно обновить токен.' });
        }
        
        const newAppToken = jwt.sign({ userId: user.id, telegramId: telegram_id.toString() }, JWT_SECRET, { expiresIn: '12h' });
        
        console.log(`[POST /api/auth/refresh-app-token] App token refreshed for user ${user.id} (TG: ${telegram_id})`);
        res.json({
            success: true,
            token: newAppToken,
            user: { 
                userId: user.id,
                telegramId: telegram_id.toString(),
                firstName: telegramUser.first_name,
                username: telegramUser.username,
                setup_date: user.setup_date,
                tax_system: user.tax_system,
                acquiring: user.acquiring !== null ? String(user.acquiring) : null,
            }
        });
    } catch (err) {
        console.error("[POST /api/auth/refresh-app-token] Error:", err);
        res.status(500).json({ success: false, error: 'Внутренняя ошибка сервера при обновлении токена.' });
    }
});

module.exports = router;