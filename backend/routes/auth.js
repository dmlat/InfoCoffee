// backend/routes/auth.js
const path = require('path');
// require('dotenv').config(...); <-- ЭТА ЛОГИКА УДАЛЕНА, Т.К. ЦЕНТРАЛИЗОВАНА

const express = require('express');
const jwt = require('jsonwebtoken');
const { pool } = require('../db');
const axios = require('axios');
const crypto = require('crypto');
const { encrypt, decrypt } = require('../utils/security'); // Импортируем из нового файла
const { startImport } = require('../worker/vendista_import_worker');
const { syncTerminalsForUser } = require('../worker/terminal_sync_worker');
const { sendErrorToAdmin } = require('../utils/adminErrorNotifier');
const { clearUserDataFromLocalStorage } = require('../../frontend/src/utils/user');

const router = express.Router();

const VENDISTA_API_URL = process.env.VENDISTA_API_BASE_URL || 'https://api.vendista.ru:99';
const JWT_SECRET = process.env.JWT_SECRET;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
// Удаляем ENCRYPTION_KEY, так как он теперь используется только в security.js
// const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;

// --- ФИНАЛЬНАЯ УМНАЯ ПРОВЕРКА ---
// В продакшене требуем все ключи, включая токен бота.
// Убираем проверку ENCRYPTION_KEY, так как она перенесена в security.js
if (process.env.NODE_ENV === 'production' && (!JWT_SECRET || !TELEGRAM_BOT_TOKEN)) {
    console.error("FATAL PRODUCTION ERROR: One of the critical environment variables (JWT_SECRET, TELEGRAM_BOT_TOKEN) is not defined.");
    process.exit(1);
}
// В разработке требуем только ключи, необходимые для работы приложения.
if (process.env.NODE_ENV !== 'production' && !JWT_SECRET) {
    console.error("FATAL DEVELOPMENT ERROR: JWT_SECRET is not defined in .env.development file.");
    process.exit(1);
}
// ------------------------------------

// Удаляем дублирующиеся функции и константы
// const ALGORITHM = 'aes-256-cbc';
// const IV_LENGTH = 16; 
// function encrypt(text) { ... }
// function decrypt(text) { ... }

const validateTelegramInitData = (initDataString) => {
    // В режиме разработки полностью доверяем данным и пропускаем проверку.
    // Это позволяет удобно работать в браузере с фейковыми данными.
    if (process.env.NODE_ENV === 'development') {
        try {
            const params = new URLSearchParams(initDataString);
            const userStr = params.get('user');
            if (userStr) {
                console.warn(`[Auth Validate] ВНИМАНИЕ: Проверка хеша отключена, т.к. NODE_ENV=development.`);
                return { valid: true, data: JSON.parse(decodeURIComponent(userStr)) };
            }
        } catch (e) {
            console.error('[Auth Validate] Не удалось разобрать dev-данные:', e);
            return { valid: false, data: null, error: "Invalid development data" };
        }
    }

    // В продакшене (когда NODE_ENV='production' или не установлен)
    // всегда проводим строгую проверку хеша.
    if (!TELEGRAM_BOT_TOKEN) {
        return { valid: false, data: null, error: "Application is not configured for Telegram authentication (token missing)." };
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
        
        console.warn('[Auth Validate] Hash mismatch. Possible unauthorized access attempt.');
        return { valid: false, data: null, error: "Hash mismatch" };

    } catch (e) {
        console.error('[Auth Validate] Critical error during validation:', e);
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

    // --- DEV MODE ROLE EMULATION ---
    // Этот блок выполняется только в режиме разработки, если в мок-данных есть специальное поле dev_role
    if (process.env.NODE_ENV === 'development' && telegramUser.dev_role) {
        const dev_role = telegramUser.dev_role;
        console.log(`[DEV_MODE] Emulating role: "${dev_role}" for TG ID: ${telegram_id}`);
        
        const devOwnerId = 1; // Используем постоянный ID владельца для консистентности в тестах
        
        const tokenPayload = { 
            userId: devOwnerId, 
            telegramId: telegram_id.toString(),
            accessLevel: dev_role
        };
        
        const userPayloadForClient = {
            userId: devOwnerId,
            telegramId: telegram_id.toString(),
            firstName: telegramUser.first_name || `Dev ${dev_role}`,
            username: telegramUser.username || `dev_${dev_role}`,
            accessLevel: dev_role
        };

        const appToken = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: '12h' });
        const action = (dev_role === 'owner') ? 'login_success' : 'login_shared_access';

        return res.json({
            success: true,
            action: action,
            token: appToken,
            user: userPayloadForClient
        });
    }
    // --- END DEV MODE ROLE EMULATION ---

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
    const { telegram_id, vendista_api_token_plain, setup_date, tax_system, acquiring } = req.body;
    // Handle both camelCase and snake_case for names to make the endpoint more robust against client-side changes.
    const final_first_name = req.body.first_name || req.body.firstName;
    const final_user_name = req.body.user_name || req.body.username;
    
    console.log(`[POST /api/auth/complete-registration] Attempting to register user, TG ID: ${telegram_id}`);

    if (!telegram_id || !vendista_api_token_plain || !setup_date) {
        const errorMsg = 'Одно или несколько обязательных полей для регистрации отсутствовали.';
        console.error(`[POST /api/auth/complete-registration] Validation Failed for TG ID ${telegram_id}. Error: ${errorMsg}. Body:`, req.body);
        
        sendErrorToAdmin({
            telegramId: telegram_id,
            userFirstName: final_first_name,
            userUsername: final_user_name,
            errorContext: `Registration Error: Missing Fields`,
            errorMessage: 'A user failed to complete registration due to missing required fields. This might indicate a frontend issue.',
            additionalInfo: { 
                note: "This error occurs when the backend endpoint /api/auth/complete-registration does not receive all required data from the client.",
                expected: ['telegram_id', 'vendista_api_token_plain', 'setup_date'],
                receivedBody: req.body 
            }
        }).catch(err => console.error("Failed to send admin notification for missing registration fields:", err));

        return res.status(400).json({ success: false, error: 'Все поля являются обязательными: telegram_id, токен Vendista, дата установки.' });
    }

    const client = await pool.connect();

    try {
        await client.query('BEGIN');
        
        const encryptedToken = encrypt(vendista_api_token_plain);
        if (!encryptedToken) {
            await client.query('ROLLBACK');
            return res.status(500).json({ success: false, error: 'Server encryption error.' });
        }

        const userInsertQuery = `
            INSERT INTO users (telegram_id, vendista_api_token, setup_date, tax_system, acquiring, first_name, user_name)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            ON CONFLICT (telegram_id) DO UPDATE SET
                vendista_api_token = EXCLUDED.vendista_api_token,
                setup_date = EXCLUDED.setup_date,
                tax_system = EXCLUDED.tax_system,
                acquiring = EXCLUDED.acquiring,
                first_name = EXCLUDED.first_name,
                user_name = EXCLUDED.user_name,
                updated_at = NOW()
            RETURNING id, setup_date, tax_system, acquiring, first_name, user_name;
        `;
        const userResult = await client.query(userInsertQuery, [telegram_id, encryptedToken, setup_date, tax_system, acquiring, final_first_name, final_user_name]);
        const user = userResult.rows[0];
        console.log(`[POST /api/auth/complete-registration] User registered/updated successfully! DB User ID: ${user.id}, TG ID: ${telegram_id}`);

        await client.query('COMMIT');

        const appToken = jwt.sign(
            { userId: user.id, telegramId: telegram_id.toString(), accessLevel: 'owner' },
            JWT_SECRET, { expiresIn: '12h' }
        );

        console.log(`[POST /api/auth/complete-registration] Triggering initial data sync for user ID: ${user.id}`);
        // Запускаем синхронизацию и импорт в фоновом режиме, не блокируя ответ
        (async () => {
            try {
                console.log(`[Initial Sync] User ${user.id}: Starting terminal sync...`);
                await syncTerminalsForUser(user.id, vendista_api_token_plain);
                console.log(`[Initial Sync] User ${user.id}: Terminal sync finished. Starting transaction import...`);
                await startImport({
                    user_id: user.id,
                    vendistaApiToken: vendista_api_token_plain,
                    first_coffee_date: setup_date,
                });
                 console.log(`[Initial Sync] User ${user.id}: Initial transaction import finished.`);
            } catch (importError) {
                console.error(`[POST /api/auth/complete-registration] Initial import failed for user ${user.id}:`, importError.message, importError.stack);
                sendErrorToAdmin({ 
                    userId: user.id, telegramId: telegram_id, userFirstName: final_first_name, userUsername: final_user_name,
                    errorContext: `Initial Import after registration for User ID: ${user.id}`,
                    errorMessage: importError.message, errorStack: importError.stack
                }).catch(notifyErr => console.error("Failed to send admin notification for initial import error:", notifyErr));
            }
        })();

        res.status(200).json({
            success: true, token: appToken,
            user: { 
                userId: user.id, telegramId: telegram_id.toString(), firstName: final_first_name, username: final_user_name,   
                setup_date: setup_date, tax_system: user.tax_system,
                acquiring: user.acquiring !== null ? String(user.acquiring) : null, accessLevel: 'owner'
            }
        });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error("[POST /api/auth/complete-registration] Error during DB transaction:", err);
        sendErrorToAdmin({ 
            telegramId: telegram_id, userFirstName: final_first_name, userUsername: final_user_name,
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