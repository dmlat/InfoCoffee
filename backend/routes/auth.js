// backend/routes/auth.js
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const express = require('express');
const jwt = require('jsonwebtoken');
const pool = require('../db');
const axios = require('axios');
const crypto = require('crypto');
const { startImport } = require('../worker/vendista_import_worker');
const { sendErrorToAdmin } = require('../utils/adminErrorNotifier');
const { clearUserDataFromLocalStorage } = require('../../frontend/src/utils/user');

const router = express.Router();

const VENDISTA_API_URL = process.env.VENDISTA_API_BASE_URL || 'https://api.vendista.ru:99';
const JWT_SECRET = process.env.JWT_SECRET;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;

// --- ФИНАЛЬНАЯ УМНАЯ ПРОВЕРКА ---
// В продакшене требуем все ключи, включая токен бота.
if (process.env.NODE_ENV === 'production' && (!JWT_SECRET || !ENCRYPTION_KEY || !TELEGRAM_BOT_TOKEN)) {
    console.error("FATAL PRODUCTION ERROR: One of the critical environment variables (JWT_SECRET, ENCRYPTION_KEY, TELEGRAM_BOT_TOKEN) is not defined.");
    process.exit(1);
}
// В разработке требуем только ключи, необходимые для работы приложения.
if (process.env.NODE_ENV !== 'production' && (!JWT_SECRET || !ENCRYPTION_KEY)) {
    console.error("FATAL DEVELOPMENT ERROR: JWT_SECRET or ENCRYPTION_KEY is not defined in .env.development file.");
    process.exit(1);
}
// ------------------------------------

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
    // ИЗМЕНЕНИЕ: Явная проверка на пустой токен для режима разработки
    if (!TELEGRAM_BOT_TOKEN) {
        console.warn('[Auth Validate] TELEGRAM_BOT_TOKEN is missing or empty. Skipping hash check (DEV MODE).');
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

    if (!initData) {
        return res.status(400).json({ success: false, error: 'initData is required.' });
    }

    const validationResult = validateTelegramInitData(initData);

    if (!validationResult.valid || !validationResult.data?.id) {
        const errorMsg = `Invalid Telegram data: ${validationResult.error || 'Unknown validation error'}`;
        sendErrorToAdmin({
            telegramId: validationResult.data?.id,
            errorContext: 'Telegram Handshake Validation',
            errorMessage: errorMsg,
            additionalInfo: { initDataProvided: !!initData }
        }).catch(notifyErr => console.error("Failed to send admin notification from telegram-handshake validation:", notifyErr));
        return res.status(403).json({ success: false, error: errorMsg });
    }

    const telegramUser = validationResult.data;
    const telegram_id = telegramUser.id;

    try {
        const userResult = await pool.query('SELECT id, vendista_api_token, setup_date, tax_system, acquiring, first_name, user_name FROM users WHERE telegram_id = $1', [telegram_id]);

        if (userResult.rows.length > 0 && userResult.rows[0].vendista_api_token) {
            const user = userResult.rows[0];
            const appToken = jwt.sign(
                { userId: user.id, telegramId: telegram_id.toString(), accessLevel: 'owner' }, 
                JWT_SECRET, { expiresIn: '12h' }
            );
            return res.json({
                success: true, action: 'login_success', token: appToken,
                user: {
                    userId: user.id, telegramId: telegram_id.toString(), firstName: user.first_name || telegramUser.first_name,
                    username: user.user_name || telegramUser.username, setup_date: user.setup_date, tax_system: user.tax_system,
                    acquiring: user.acquiring !== null ? String(user.acquiring) : null, accessLevel: 'owner'
                }
            });
        }
        
        const accessResult = await pool.query(
            `SELECT owner_user_id, access_level, shared_with_name FROM user_access_rights WHERE shared_with_telegram_id = $1`, 
            [telegram_id]
        );

        if (accessResult.rows.length > 0) {
            const access = accessResult.rows[0];
            const appToken = jwt.sign(
                { userId: access.owner_user_id, telegramId: telegram_id.toString(), accessLevel: access.access_level, sharedName: access.shared_with_name },
                JWT_SECRET, { expiresIn: '12h' }
            );
            return res.json({
                success: true, action: 'login_shared_access', token: appToken,
                user: {
                    userId: access.owner_user_id, telegramId: telegram_id.toString(), firstName: access.shared_with_name,
                    username: telegramUser.username || '', accessLevel: access.access_level
                }
            });
        }

        if (userResult.rows.length > 0) {
            return res.json({
                success: true, action: 'registration_incomplete', telegram_id: telegram_id.toString(), 
                firstName: userResult.rows[0].first_name || telegramUser.first_name,
                username: userResult.rows[0].user_name || telegramUser.username,
            });
        }
        
        return res.json({
            success: true, action: 'registration_required', telegram_id: telegram_id.toString(),
            firstName: telegramUser.first_name, username: telegramUser.username,
        });

    } catch (err) {
        console.error("[POST /api/auth/telegram-handshake] Database/server error:", err);
        sendErrorToAdmin({ telegramId: telegram_id, errorContext: 'Telegram Handshake DB/Server', errorMessage: err.message, errorStack: err.stack })
        .catch(notifyErr => console.error("Failed to send admin notification from telegram-handshake DB error:", notifyErr));
        res.status(500).json({ success: false, error: 'Server error during handshake.' });
    }
});

router.post('/log-frontend-error', async (req, res) => {
    const { error, context, tgInitData } = req.body;

    try {
        let additionalInfo = {
            'User-Agent': req.headers['user-agent'],
            'Source-IP': req.ip
        };

        if (tgInitData) {
            try {
                const initDataParams = new URLSearchParams(tgInitData);
                const user = JSON.parse(initDataParams.get('user') || '{}');
                additionalInfo = { ...additionalInfo, ...user };
            } catch {
                additionalInfo.rawInitData = tgInitData.substring(0, 500); // Log part of the raw data if parsing fails
            }
        }
        
        await sendErrorToAdmin({
            errorContext: `Frontend Auth Error: ${context || 'Unknown context'}`,
            errorMessage: error || 'No error message provided.',
            additionalInfo: additionalInfo
        });

        res.status(200).send({ success: true });

    } catch(e) {
        // If logging itself fails, just send a simple response.
        res.status(500).send({ success: false });
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
                telegramId: telegram_id, errorContext: `Validate Vendista API for TG ID: ${telegram_id}`,
                errorMessage: errorMsg, additionalInfo: { vendistaResponse: tokenResp.data }
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
            telegramId: telegram_id, errorContext: `Validate Vendista Network/Server for TG ID: ${telegram_id}`,
            errorMessage: errorMessage, errorStack: err.stack, additionalInfo: { responseData: err.response?.data, errorCode: err.code }
        }).catch(notifyErr => console.error("Failed to send admin notification from validate-vendista catch:", notifyErr));
        res.status(err.response?.status || 500).json({ success: false, error: errorMessage });
    }
});

router.post('/complete-registration', async (req, res) => {
    const { telegram_id, vendista_api_token_plain, setup_date, tax_system, acquiring, firstName, username, lastName, languageCode, photoUrl } = req.body;
    console.log(`[POST /api/auth/complete-registration] Completing registration for TG ID: ${telegram_id}`);

    if (!telegram_id || !vendista_api_token_plain || !setup_date) {
        return res.status(400).json({ success: false, error: 'Отсутствуют необходимые данные для регистрации (telegram_id, vendista_api_token_plain, setup_date).' });
    }

    let encryptedVendistaToken;
    try {
        encryptedVendistaToken = encrypt(vendista_api_token_plain);
    } catch (encErr) {
        console.error("[POST /api/auth/complete-registration] Encryption error:", encErr);
        sendErrorToAdmin({ 
            telegramId: telegram_id, userFirstName: firstName, userUsername: username,
            errorContext: `Complete Registration - Encryption for TG ID: ${telegram_id}`,
            errorMessage: encErr.message, errorStack: encErr.stack
        }).catch(notifyErr => console.error("Failed to send admin notification for encryption error:", notifyErr));
        return res.status(500).json({ success: false, error: 'Ошибка шифрования токена на сервере.' });
    }
    
    const client = await pool.pool.connect();
    try {
        await client.query('BEGIN');
        let userQueryResult = await client.query('SELECT id FROM users WHERE telegram_id = $1', [BigInt(telegram_id)]);
        let userId;
        let userAction = '';
        const effectiveName = firstName || username || `User ${telegram_id}`;

        const acquiringValue = acquiring !== null && acquiring !== undefined && String(acquiring).trim() !== '' ? parseFloat(String(acquiring).replace(',', '.')) : null;

        if (userQueryResult.rows.length > 0) {
            userId = userQueryResult.rows[0].id;
            userAction = 'updated';
            console.log(`[POST /api/auth/complete-registration] Updating existing user ID: ${userId} for TG ID: ${telegram_id}`);
            await client.query(
                `UPDATE users SET 
                    vendista_api_token = $1, setup_date = $2, tax_system = $3, acquiring = $4, 
                    first_name = $5, user_name = $6, last_name = $7, language_code = $8, photo_url = $9,
                    name = $10, updated_at = NOW() 
                 WHERE id = $11`,
                [encryptedVendistaToken, setup_date, tax_system || null, acquiringValue, 
                 firstName || null, username || null, lastName || null, languageCode || null, photoUrl || null,
                 effectiveName, userId]
            );
        } else {
            userAction = 'created';
            console.log(`[POST /api/auth/complete-registration] Inserting new user for TG ID: ${telegram_id}`);
            const insertResult = await client.query(
                `INSERT INTO users (telegram_id, vendista_api_token, setup_date, tax_system, acquiring, 
                                     first_name, user_name, last_name, language_code, photo_url, name, 
                                     created_at, updated_at, registration_date)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(), NOW(), NOW()) RETURNING id`,
                [BigInt(telegram_id), encryptedVendistaToken, setup_date, tax_system || null, acquiringValue, 
                 firstName || null, username || null, lastName || null, languageCode || null, photoUrl || null,
                 effectiveName]
            );
            userId = insertResult.rows[0].id;
            console.log(`[POST /api/auth/complete-registration] New user created with ID: ${userId}`);
        }
        await client.query('COMMIT');

        const appTokenForWorker = jwt.sign(
            { userId: userId, telegramId: telegram_id.toString(), accessLevel: 'owner' },
            JWT_SECRET, { expiresIn: '15m' } 
        );

        console.log(`[POST /api/auth/complete-registration] Initiating first import for user ID: ${userId}`);
        startImport({
            user_id: userId,
            vendistaApiToken: vendista_api_token_plain, 
            first_coffee_date: setup_date,
            appToken: appTokenForWorker
        }).catch(importError => {
            console.error(`[POST /api/auth/complete-registration] Initial import failed for user ${userId}:`, importError.message, importError.stack);
            sendErrorToAdmin({ 
                userId: userId, telegramId: telegram_id, userFirstName: firstName, userUsername: username,
                errorContext: `Initial Import after registration for User ID: ${userId}`,
                errorMessage: importError.message, errorStack: importError.stack
            }).catch(notifyErr => console.error("Failed to send admin notification for initial import error:", notifyErr));
        });

        const appToken = jwt.sign(
            { userId: userId, telegramId: telegram_id.toString(), accessLevel: 'owner' }, 
            JWT_SECRET, { expiresIn: '12h' }
        );

        res.status(userAction === 'created' ? 201 : 200).json({
            success: true, token: appToken,
            user: { 
                userId: userId, telegramId: telegram_id.toString(), firstName: firstName, username: username,   
                setup_date: setup_date, tax_system: tax_system,
                acquiring: acquiringValue !== null ? String(acquiringValue) : null, accessLevel: 'owner'
            }
        });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error("[POST /api/auth/complete-registration] Error during DB transaction:", err);
        sendErrorToAdmin({ 
            telegramId: telegram_id, userFirstName: firstName, userUsername: username,
            errorContext: `Complete Registration DB Transaction for TG ID: ${telegram_id}`,
            errorMessage: err.message, errorStack: err.stack, additionalInfo: { code: err.code, constraint: err.constraint }
        }).catch(notifyErr => console.error("Failed to send admin notification for DB transaction error:", notifyErr));

        if (err.code === '23505' && err.constraint === 'users_telegram_id_key') {
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
    const telegramUser = validationResult.data || {};

    if (!validationResult.valid || !telegramUser.id) {
        const errorMsg = `Invalid Telegram data for refresh: ${validationResult.error || 'Unknown'}`;
        sendErrorToAdmin({
            telegramId: telegramUser.id,
            errorContext: 'Refresh App Token Validation',
            errorMessage: errorMsg,
            additionalInfo: { initDataProvided: !!initData }
        }).catch(console.error);
        return res.status(401).json({ success: false, error: errorMsg });
    }
    
    const current_telegram_id_refresh = BigInt(telegramUser.id);
    console.log(`[POST /api/auth/refresh-app-token] Validated Telegram ID: ${current_telegram_id_refresh} for refresh`);

    try {
        let tokenPayload;
        let userDataForClient;

        const ownerRes = await pool.query(
            'SELECT id, setup_date, tax_system, acquiring, vendista_api_token, first_name, user_name FROM users WHERE telegram_id = $1',
            [current_telegram_id_refresh]
        );

        if (ownerRes.rows.length > 0 && ownerRes.rows[0].vendista_api_token) {
            const ownerUser = ownerRes.rows[0];
            tokenPayload = { 
                userId: ownerUser.id, 
                telegramId: current_telegram_id_refresh.toString(),
                accessLevel: 'owner'
            };
            userDataForClient = {
                userId: ownerUser.id,
                telegramId: current_telegram_id_refresh.toString(),
                firstName: ownerUser.first_name || telegramUser.first_name,
                username: ownerUser.user_name || telegramUser.username,
                setup_date: ownerUser.setup_date,
                tax_system: ownerUser.tax_system,
                acquiring: ownerUser.acquiring !== null ? String(ownerUser.acquiring) : null,
                accessLevel: 'owner'
            };
        } else {
            const accessRightsResult = await pool.query(
                `SELECT uar.owner_user_id, uar.access_level, uar.shared_with_name, 
                        u.setup_date as owner_setup_date, u.tax_system as owner_tax_system, u.acquiring as owner_acquiring
                 FROM user_access_rights uar
                 JOIN users u ON uar.owner_user_id = u.id
                 WHERE uar.shared_with_telegram_id = $1`,
                [current_telegram_id_refresh]
            );

            if (accessRightsResult.rows.length > 0) {
                const accessRecord = accessRightsResult.rows[0];
                tokenPayload = {
                    userId: accessRecord.owner_user_id,
                    telegramId: current_telegram_id_refresh.toString(),
                    accessLevel: accessRecord.access_level,
                    sharedName: accessRecord.shared_with_name
                };
                 userDataForClient = {
                    userId: accessRecord.owner_user_id,
                    telegramId: current_telegram_id_refresh.toString(),
                    firstName: accessRecord.shared_with_name,
                    username: telegramUser.username,
                    setup_date: accessRecord.owner_setup_date,
                    tax_system: accessRecord.owner_tax_system,
                    acquiring: accessRecord.owner_acquiring,
                    accessLevel: accessRecord.access_level
                };
            }
        }

        if (!tokenPayload) {
            const errorMsg = 'Пользователь не найден или доступ не предоставлен. Невозможно обновить токен.';
            sendErrorToAdmin({
                telegramId: current_telegram_id_refresh,
                errorContext: 'Refresh App Token - User/Access Not Found',
                errorMessage: errorMsg
            }).catch(console.error);
            return res.status(401).json({ success: false, error: errorMsg });
        }

        const newAppToken = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: '12h' });
        
        console.log(`[POST /api/auth/refresh-app-token] App token refreshed for TG ID: ${current_telegram_id_refresh} (acting as user_id: ${tokenPayload.userId})`);
        
        res.json({
            success: true,
            token: newAppToken,
            user: userDataForClient
        });

    } catch (err) {
        console.error(`[POST /api/auth/refresh-app-token] Error for TG ID ${current_telegram_id_refresh}:`, err);
        sendErrorToAdmin({
            telegramId: current_telegram_id_refresh,
            errorContext: `Refresh App Token - DB/Server Error`,
            errorMessage: err.message,
            errorStack: err.stack
        }).catch(console.error);
        res.status(500).json({ success: false, error: 'Внутренняя ошибка сервера при обновлении токена.' });
    }
});

module.exports = router;