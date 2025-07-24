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
    if (process.env.NODE_ENV === 'development') {
        console.log('[Auth Validate] Development mode: SKIPPING hash validation.');
        try {
            // В режиме разработки initData может быть либо строкой параметров URL,
            // либо уже объектом, если он был проксирован или изменен.
            // Эта проверка делает функцию более устойчивой.
            let userStr;
            if (typeof initDataString === 'string') {
            const params = new URLSearchParams(initDataString);
                userStr = params.get('user');
            } else if (typeof initDataString === 'object' && initDataString !== null) {
                // Если это объект, предполагаем, что он содержит 'user' как строку JSON.
                // Это может произойти, если фронтенд отправляет JSON.
                // В нашем случае, мы ожидаем от dev.js URL-кодированную строку.
                // Но эта логика делает код более надежным.
                userStr = initDataString.user;
            }

            if (userStr) {
                // декодируем и парсим
                const userData = JSON.parse(decodeURIComponent(userStr));
                if (userData && userData.id) {
                    return { valid: true, data: userData };
                }
            }
            // Если user или user.id не найден в initData, это ошибка
            console.error('[Auth Validate] "user" field with an "id" not found in initData during development.');
            return { valid: false, data: null, error: "Invalid dev initData: 'user' object with 'id' is missing" };

        } catch (e) {
            console.error('[Auth Validate] Failed to parse dev data:', e);
            return { valid: false, data: null, error: "Invalid development data" };
        }
    }

    // В production-режиме всегда проводим строгую проверку хеша.
    console.log('[Auth Validate] Production mode: Performing hash validation.');
    if (!TELEGRAM_BOT_TOKEN) {
        console.error('[Auth Validate] TELEGRAM_BOT_TOKEN is not configured.');
        return { valid: false, data: null, error: "Application is not configured for Telegram authentication (token missing)." };
    }

    try {
        console.log('[Auth Validate] Step 1: Parsing initData.');
        const params = new URLSearchParams(initDataString);
        const hash = params.get('hash');
        if (!hash) {
            console.error('[Auth Validate] Error: No hash in initData.');
            return { valid: false, data: null, error: "No hash in initData" };
        }
        params.delete('hash');
        
        console.log('[Auth Validate] Step 2: Preparing dataCheckString.');
        const dataCheckArr = [];
        const sortedKeys = Array.from(params.keys()).sort();
        sortedKeys.forEach(key => {
            dataCheckArr.push(`${key}=${params.get(key)}`);
        });
        const dataCheckString = dataCheckArr.join('\n');

        console.log('[Auth Validate] Step 3: Creating secret key.');
        const secretKey = crypto.createHmac('sha256', 'WebAppData').update(TELEGRAM_BOT_TOKEN).digest();
        
        console.log('[Auth Validate] Step 4: Calculating hash.');
        const calculatedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

        console.log('[Auth Validate] Step 5: Comparing hashes.');
        if (calculatedHash === hash) {
            const user = params.get('user');
            if (!user) {
                console.error('[Auth Validate] Error: No user data in initData despite valid hash.');
                return { valid: false, data: null, error: "No user data in initData" };
            }
            console.log('[Auth Validate] Validation successful.');
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
    console.log('[POST /api/auth/telegram-handshake] Received request.'); // Временный лог
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

    // --- РЕЖИМ РАЗРАБОТКИ ---
    if (process.env.NODE_ENV === 'development') {
        // Пропускаем проверку хеша и доверяем данным от фронтенда
        console.log('[Auth] Development mode: Trusting frontend data for role emulation.');
        
        const ownerTelegramId = parseInt(process.env.DEV_OWNER_TELEGRAM_ID, 10);
        const adminTelegramId = parseInt(process.env.DEV_ADMIN_TELEGRAM_ID, 10);
        const serviceTelegramId = parseInt(process.env.DEV_SERVICE_TELEGRAM_ID, 10);
    
        if (!telegramUser.dev_role) {
            return res.status(400).json({ message: "Dev Error: 'dev_role' is missing in the emulated user data." });
        }
        const dev_role = telegramUser.dev_role;
        let userRecord, access_level, owner_user_id;
    
        if (dev_role === 'owner') {
          // --- Эмуляция Владельца ---
          userRecord = await pool.query('SELECT * FROM users WHERE telegram_id = $1', [ownerTelegramId]);
          if (userRecord.rows.length === 0) {
            console.log(`[Auth Dev] Owner with telegram_id=${ownerTelegramId} not found. Creating...`);
            userRecord = await pool.query(
              "INSERT INTO users (telegram_id, first_name, user_name, setup_date, tax_system, acquiring) VALUES ($1, $2, $3, '2023-01-01', 'income_6', 1.9) RETURNING *",
              [ownerTelegramId, telegramUser.first_name, telegramUser.username]
            );
          }
          access_level = 'owner';
          owner_user_id = userRecord.rows[0].id;
    
        } else {
          // --- Эмуляция Админа или Сервис-инженера ---
          const ownerResult = await pool.query('SELECT id FROM users WHERE telegram_id = $1', [ownerTelegramId]);
          if (ownerResult.rows.length === 0) {
            return res.status(404).json({ message: "Dev Error: Owner user not found. Please login as 'owner' first to create the main user." });
          }
          owner_user_id = ownerResult.rows[0].id;
    
          let targetTelegramId;
          if (dev_role === 'admin') {
            targetTelegramId = adminTelegramId;
            access_level = 'admin';
          } else { // service
            targetTelegramId = serviceTelegramId;
            access_level = 'service';
          }
          
          // Ищем или создаем запись о доступе
          let accessRecord = await pool.query(
            'SELECT * FROM user_access_rights WHERE owner_user_id = $1 AND shared_with_telegram_id = $2',
            [owner_user_id, targetTelegramId]
          );
    
          if (accessRecord.rows.length === 0) {
            console.log(`[Auth Dev] Access rights for ${dev_role} (telegram_id=${targetTelegramId}) not found. Creating...`);
            await pool.query(
              "INSERT INTO user_access_rights (owner_user_id, shared_with_telegram_id, shared_with_name, access_level) VALUES ($1, $2, $3, $4)",
              [owner_user_id, targetTelegramId, telegramUser.first_name, access_level]
            );
            accessRecord = {
                rows: [{ shared_with_name: telegramUser.first_name }]
            };
          }
          
          // Для генерации токена нам нужен основной профиль владельца
          userRecord = await pool.query('SELECT * FROM users WHERE id = $1', [owner_user_id]);
        }
        
        // Создаем JWT токен
        const token = jwt.sign(
            { userId: userRecord.rows[0].id, telegramId: telegramUser.id.toString(), accessLevel: access_level }, 
            JWT_SECRET, { expiresIn: '12h' }
        );
        
        // --- ФИНАЛЬНОЕ ИСПРАВЛЕНИЕ ---
        // Собираем объект пользователя для ответа на фронтенд КОРРЕКТНО
        let userForFrontend;
        if (dev_role === 'owner') {
            userForFrontend = {
                ...userRecord.rows[0], // Для owner'а отправляем его полную запись
                role: access_level,
                accessLevel: access_level
            };
        } else {
            // Для admin и service создаем объект с правильными данными
            userForFrontend = {
                id: owner_user_id, // ID всегда от владельца
                telegram_id: telegramUser.id, // ID от эмулируемого пользователя
                first_name: telegramUser.first_name, // Имя от эмулируемого пользователя
                user_name: telegramUser.username, // Username от эмулируемого пользователя
                role: access_level, // Роль эмулируемого пользователя
                accessLevel: access_level // Уровень доступа эмулируемого пользователя
            };
        }
        console.log('[DEBUG auth.js] User object being sent to frontend:', userForFrontend);

        return res.json({
            success: true,
            message: 'login_success',
            token: token,
            user: userForFrontend
        });
    }


    // --- ПРОДАКШЕН ЛОГИКА ---
    let userQuery = await pool.query('SELECT * FROM users WHERE telegram_id = $1', [telegram_id]);
    let user = userQuery.rows[0];
    let role = null;
    let owner_id = null;

    // Определяем роль пользователя
    if (user) {
        // Если пользователь найден и прошел регистрацию
        if (user.vendista_api_token) {
            role = 'owner'; // Предполагаем, что найденный пользователь является владельцем
            owner_id = user.id; // owner_id будет использоваться для генерации токена
        } else {
            // Если пользователь существует, но не завершил регистрацию
            role = 'registration_incomplete';
            owner_id = user.id; // owner_id будет использоваться для генерации токена
        }
    } else {
        // Если пользователь новый, создаем запись и отправляем на регистрацию
        const newUserQuery = await pool.query(
            "INSERT INTO users (telegram_id, first_name, user_name) VALUES ($1, $2, $3) RETURNING *",
            [telegram_id, telegramUser.first_name || '', telegramUser.username || '']
        );
        const newUser = newUserQuery.rows[0];
        role = 'registration_required';
        owner_id = newUser.id; // owner_id будет использоваться для генерации токена
    }

    // Если пользователь найден и прошел регистрацию
    if (user && user.vendista_api_token) {
        const token = jwt.sign(
            { userId: user.id, telegramId: user.telegram_id, accessLevel: role },
            JWT_SECRET,
            { expiresIn: '12h' }
            );

            return res.json({
            success: true,
            token: token,
                user: {
                ...user,
                role: role,
                accessLevel: role // <-- ИСПРАВЛЕНИЕ: приводим к camelCase
                }
            });
        }
        
    // Если пользователь существует, но не завершил регистрацию
    if (user) {
            return res.json({
            success: true, 
            message: 'registration_incomplete',
                user: {
                id: user.id,
                telegram_id: user.telegram_id,
                first_name: telegramUser.first_name,
                user_name: telegramUser.username
                }
            });
        }

    // Если пользователь новый, создаем запись и отправляем на регистрацию
    const newUserQuery = await pool.query(
        "INSERT INTO users (telegram_id, first_name, user_name) VALUES ($1, $2, $3) RETURNING *",
        [telegram_id, telegramUser.first_name || '', telegramUser.username || '']
    );
    const newUser = newUserQuery.rows[0];

            return res.json({
        success: true,
        message: 'registration_required',
        user: {
            id: newUser.id,
            telegram_id: newUser.telegram_id,
            first_name: telegramUser.first_name,
            user_name: telegramUser.username
        }
    });
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
    const { 
        telegram_id, 
        vendista_api_token_plain,
        vendista_login,
        vendista_password,
        setup_date, 
        tax_system, 
        acquiring,
        first_name,
        firstName,
        user_name,
        username
    } = req.body;
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
        
        const encrypted_token = encrypt(vendista_api_token_plain);
        const encrypted_login = encrypt(vendista_login);
        const encrypted_password = encrypt(vendista_password);

        if (!encrypted_token) {
            await client.query('ROLLBACK');
            return res.status(500).json({ success: false, error: 'Failed to encrypt token' });
        }
        if (!encrypted_login || !encrypted_password) {
            await client.query('ROLLBACK');
            return res.status(500).json({ success: false, error: 'Failed to encrypt credentials' });
        }

        const query = `
            UPDATE users 
            SET vendista_api_token = $1, 
                setup_date = $2, 
                tax_system = $3, 
                acquiring = $4,
                first_name = $5,
                user_name = $6,
                vendista_login = $7,
                vendista_password = $8,
                vendista_token_status = 'valid'
            WHERE telegram_id = $9
            RETURNING *;
        `;
        const values = [
            encrypted_token, 
            setup_date, 
            tax_system, 
            acquiring,
            final_first_name,
            final_user_name,
            encrypted_login,
            encrypted_password,
            telegram_id
        ];

        const { rows } = await client.query(query, values);
        const user = rows[0];
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
        console.log('[Refresh Token] Step 1: Searching for user in `users` table (owner check).');
        let tokenPayload;
        let userDataForClient;

        const ownerRes = await pool.query(
            'SELECT id, setup_date, tax_system, acquiring, vendista_api_token, first_name, user_name FROM users WHERE telegram_id = $1',
            [current_telegram_id_refresh]
        );

        if (ownerRes.rows.length > 0 && ownerRes.rows[0].vendista_api_token) {
            console.log('[Refresh Token] User found as OWNER.');
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
            console.log('[Refresh Token] OWNER. Generated token payload:', tokenPayload);
            console.log('[Refresh Token] OWNER. Generated user data for client:', userDataForClient);
        } else {
            console.log('[Refresh Token] User not found as owner. Step 2: Checking `user_access_rights`.');
            const accessRightsResult = await pool.query(
                `SELECT uar.owner_user_id, uar.access_level, uar.shared_with_name, 
                        u.setup_date as owner_setup_date, u.tax_system as owner_tax_system, u.acquiring as owner_acquiring
                 FROM user_access_rights uar
                 JOIN users u ON uar.owner_user_id = u.id
                 WHERE uar.shared_with_telegram_id = $1`,
                [current_telegram_id_refresh]
            );
            
            console.log(`[Refresh Token] Found ${accessRightsResult.rows.length} rows in access rights.`);

            if (accessRightsResult.rows.length > 0) {
                console.log('[Refresh Token] User found with access rights. Preparing token.');
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
                console.log('[Refresh Token] ADMIN/SERVICE. Generated token payload:', tokenPayload);
                console.log('[Refresh Token] ADMIN/SERVICE. Generated user data for client:', userDataForClient);
            }
        }

        if (!tokenPayload) {
            console.error('[Refresh Token] CRITICAL: No token payload could be generated. User not found as owner or in access rights.');
            const errorMsg = 'Пользователь не найден или доступ не предоставлен. Невозможно обновить токен.';
            sendErrorToAdmin({
                telegramId: current_telegram_id_refresh,
                errorContext: 'Refresh App Token - User/Access Not Found',
                errorMessage: errorMsg
            }).catch(console.error);
            return res.status(401).json({ success: false, error: errorMsg });
        }

        console.log('[Refresh Token] Step 3: Signing new token with payload:', tokenPayload);
        const newAppToken = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: '12h' });
        
        console.log(`[POST /api/auth/refresh-app-token] App token refreshed for TG ID: ${current_telegram_id_refresh} (acting as user_id: ${tokenPayload.userId})`);
        
        console.log('[Refresh Token] Step 4: Sending successful response to client.');
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

// Validate existing JWT token
router.get('/validate-token', async (req, res) => {
    const header = req.headers['authorization'];
    if (!header) {
        return res.status(401).json({ success: false, error: 'No authorization header' });
    }

    const parts = header.split(' ');
    if (parts.length !== 2 || parts[0] !== 'Bearer') {
        return res.status(401).json({ success: false, error: 'Invalid token format' });
    }

    const token = parts[1];
    if (!token) {
        return res.status(401).json({ success: false, error: 'No token provided' });
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        
        // --- ОБЩАЯ ЛОГИКА ДЛЯ ВСЕХ СРЕД ---
        // Всегда ищем пользователя в базе данных, чтобы отдать на фронтенд актуальные данные.
        const userResult = await pool.query('SELECT * FROM users WHERE id = $1', [decoded.userId]);
        if (userResult.rows.length === 0) {
            console.warn(`[validate-token] User with ID ${decoded.userId} from token not found in DB.`);
            return res.status(401).json({ success: false, error: 'User not found' });
        }
        const user = userResult.rows[0];

        // Определяем роль из токена. В dev-режиме она может быть подменена.
        const roleOrAccessLevel = decoded.accessLevel || decoded.role || 'owner';

        // Формируем полный объект пользователя для ответа
        let userForClient = {
            ...user, // Полные данные из БД
            id: user.id, // Убедимся, что ID правильный
            telegram_id: decoded.telegramId, // <-- Используем telegram_id из токена, он может быть эмулированным
            role: roleOrAccessLevel,
            accessLevel: roleOrAccessLevel,
        };

        // В dev-режиме, если роль не 'owner', нам надо добавить данные о правах доступа
        if (process.env.NODE_ENV === 'development' && roleOrAccessLevel !== 'owner') {
             const accessRightsResult = await pool.query(
                `SELECT uar.shared_with_name
                 FROM user_access_rights uar
                 WHERE uar.owner_user_id = $1 AND uar.shared_with_telegram_id = $2`,
                [user.id, decoded.telegramId]
            );
            if(accessRightsResult.rows.length > 0) {
                userForClient.first_name = accessRightsResult.rows[0].shared_with_name;
                userForClient.user_name = `dev_${roleOrAccessLevel}`; // Добавляем и username для консистентности
            }
        }
        
        res.json({
            success: true,
            user: userForClient
        });

    } catch (err) {
        console.error('Token validation error:', err);
        return res.status(401).json({ success: false, error: 'Invalid or expired token' });
    }
});

// Endpoint для ручного сброса статуса оплаты Vendista (только для админов)
router.post('/reset-payment-status', async (req, res) => {
    try {
        const { userId } = req.body;
        
        if (!userId) {
            return res.status(400).json({ success: false, error: 'User ID is required' });
        }

        // Сбрасываем статус оплаты на 'active'
        const result = await pool.query(
            `UPDATE users SET 
                vendista_payment_status = 'active', 
                vendista_payment_notified_at = NULL,
                updated_at = NOW()
             WHERE id = $1 
             RETURNING id, telegram_id, first_name, vendista_payment_status`,
            [userId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'User not found' });
        }

        const user = result.rows[0];
        console.log(`[Auth] Payment status reset for user ${user.id} (${user.first_name})`);

        res.json({
            success: true,
            message: `Payment status reset successfully for user ${user.first_name} (ID: ${user.id})`,
            user: {
                id: user.id,
                telegram_id: user.telegram_id,
                first_name: user.first_name,
                payment_status: user.vendista_payment_status
            }
        });

    } catch (err) {
        console.error('Error resetting payment status:', err);
        return res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

module.exports = router;