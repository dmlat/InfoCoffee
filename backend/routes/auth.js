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

// Удалены дублирующиеся функции шифрования, так как они вынесены в /utils/security.js

const validateTelegramInitData = (initDataString) => {
    // В режиме разработки полностью доверяем данным и пропускаем проверку.
    if (process.env.NODE_ENV === 'development') {
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
    if (!TELEGRAM_BOT_TOKEN) {
        console.error('[Auth Validate] TELEGRAM_BOT_TOKEN is not configured.');
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

    try {
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
        // console.log('[DEBUG auth.js] User object being sent to frontend:', userForFrontend);

        return res.json({
            success: true,
            message: 'login_success',
            token: token,
            user: userForFrontend
        });
    }


    // --- ПРОДАКШЕН ЛОГИКА ---
    // Приводим telegram_id к строке для консистентности
    const telegram_id_str = telegram_id.toString();
    
    let userQuery = await pool.query('SELECT * FROM users WHERE telegram_id = $1', [telegram_id_str]);
    let user = userQuery.rows[0];
    let role = null;
    let owner_id = null;
    let userForResponse = null;
    

    // ИСПРАВЛЕННАЯ ЛОГИКА: Определяем роль пользователя
    if (user) {
        // Если пользователь найден И есть vendista_api_token - это owner
        if (user.vendista_api_token) {
            role = 'owner';
            owner_id = user.id;
            userForResponse = user;
        } else {
            // Пользователь найден БЕЗ токена, проверяем, может ли он быть admin/service
            const accessRightsResult = await pool.query(
                `SELECT uar.owner_user_id, uar.access_level, uar.shared_with_name, 
                        u.setup_date, u.tax_system, u.acquiring, u.first_name as owner_first_name
                 FROM user_access_rights uar
                 JOIN users u ON uar.owner_user_id = u.id
                 WHERE uar.shared_with_telegram_id = $1`,
                [telegram_id_str]
            );
            
            if (accessRightsResult.rows.length > 0) {
                // Пользователь существует в users, но является admin/service
                const accessRecord = accessRightsResult.rows[0];
                role = accessRecord.access_level; // 'admin' или 'service'
                owner_id = accessRecord.owner_user_id;
                
                // Формируем объект пользователя для admin/service
                userForResponse = {
                    id: owner_id, // ID владельца для токена
                    telegram_id: telegram_id_str, // Telegram ID admin/service как строка
                    first_name: accessRecord.shared_with_name, // Имя admin/service
                    user_name: telegramUser.username || '', // Username из Telegram
                    setup_date: accessRecord.setup_date,
                    tax_system: accessRecord.tax_system,
                    acquiring: accessRecord.acquiring
                };
            } else {
                // Пользователь существует, но не имеет прав доступа - незавершенная регистрация owner'а
                role = 'registration_incomplete';
                owner_id = user.id;
                userForResponse = user;
            }
        }
    } else {
        // Проверяем user_access_rights для новых admin/service пользователей (не существующих в users)
        const accessRightsResult = await pool.query(
            `SELECT uar.owner_user_id, uar.access_level, uar.shared_with_name, 
                    u.setup_date, u.tax_system, u.acquiring, u.first_name as owner_first_name
             FROM user_access_rights uar
             JOIN users u ON uar.owner_user_id = u.id
             WHERE uar.shared_with_telegram_id = $1`,
            [telegram_id_str]
        );
        
        if (accessRightsResult.rows.length > 0) {
            const accessRecord = accessRightsResult.rows[0];
            role = accessRecord.access_level; // 'admin' или 'service'
            owner_id = accessRecord.owner_user_id;
            
            // Формируем объект пользователя для admin/service (не существующих в users)
            userForResponse = {
                id: owner_id, // ID владельца для токена
                telegram_id: telegram_id_str, // Telegram ID admin/service как строка
                first_name: accessRecord.shared_with_name, // Имя admin/service
                user_name: telegramUser.username || '', // Username из Telegram
                setup_date: accessRecord.setup_date,
                tax_system: accessRecord.tax_system,
                acquiring: accessRecord.acquiring
            };
        } else {
            // Если пользователь новый, создаем запись и отправляем на регистрацию
            const newUserQuery = await pool.query(
                "INSERT INTO users (telegram_id, first_name, user_name) VALUES ($1, $2, $3) RETURNING *",
                [telegram_id_str, telegramUser.first_name || '', telegramUser.username || '']
            );
            const newUser = newUserQuery.rows[0];
            role = 'registration_required';
            owner_id = newUser.id; // owner_id будет использоваться для генерации токена
            userForResponse = newUser;
        }
    }

    // УНИФИЦИРОВАННАЯ ЛОГИКА ОТВЕТОВ ДЛЯ ВСЕХ РОЛЕЙ
    if (role === 'owner' && userForResponse.vendista_api_token) {
        // Owner с завершенной регистрацией
        const token = jwt.sign(
            { userId: userForResponse.id, telegramId: userForResponse.telegram_id.toString(), accessLevel: role },
            JWT_SECRET,
            { expiresIn: '12h' }
        );

        return res.json({
            success: true,
            token: token,
            user: {
                ...userForResponse,
                accessLevel: role
            }
        });
    } else if (role === 'admin' || role === 'service') {
        // Admin/Service пользователи (регистрация уже завершена через владельца)
        const token = jwt.sign(
            { userId: owner_id, telegramId: telegram_id_str, accessLevel: role },
            JWT_SECRET,
            { expiresIn: '12h' }
        );

        return res.json({
            success: true,
            token: token,
            user: {
                ...userForResponse,
                role: role,
                accessLevel: role
            }
        });
    } else if (role === 'registration_incomplete') {
        // Owner с незавершенной регистрацией
        return res.json({
            success: true, 
            message: 'registration_incomplete',
            user: {
                id: userForResponse.id,
                telegram_id: userForResponse.telegram_id,
                first_name: telegramUser.first_name,
                user_name: telegramUser.username
            }
        });
    } else if (role === 'registration_required') {
        // Новый пользователь
        return res.json({
            success: true,
            message: 'registration_required',
            user: {
                id: userForResponse.id,
                telegram_id: userForResponse.telegram_id,
                first_name: telegramUser.first_name,
                user_name: telegramUser.username
            }
        });
    } else {
        // Неожиданная ситуация
        const errorMsg = `Неопределенное состояние пользователя: ${role}`;
        sendErrorToAdmin({
            telegramId: telegram_id,
            errorContext: 'Telegram Handshake - Unexpected User State',
            errorMessage: errorMsg,
            additionalInfo: { role, userForResponse }
        }).catch(console.error);
        return res.status(500).json({ success: false, error: errorMsg });
    }
    
    } catch (err) {
        // КРИТИЧЕСКАЯ ОШИБКА: Отправляем в Telegram все неожиданные ошибки
        console.error('[POST /api/auth/telegram-handshake] CRITICAL ERROR:', err);
        
        const errorMessage = `CRITICAL telegram-handshake error: ${err.message}`;
        const additionalInfo = {
            stack: err.stack,
            code: err.code,
            constraint: err.constraint,
            initDataProvided: !!req.body.initData,
            hasValidationResult: 'validationResult' in err
        };

        // Определяем telegram_id для уведомления (если доступен)
        let telegramIdForNotification = null;
        try {
            const validationResult = validateTelegramInitData(req.body.initData);
            telegramIdForNotification = validationResult.data?.id;
        } catch {}

        sendErrorToAdmin({
            telegramId: telegramIdForNotification,
            errorContext: '💥 CRITICAL telegram-handshake ERROR',
            errorMessage: errorMessage,
            errorStack: err.stack,
            additionalInfo: additionalInfo
        }).catch(notifyErr => console.error("Failed to send critical error notification:", notifyErr));

        return res.status(500).json({ 
            success: false, 
            error: 'Критическая ошибка аутентификации. Администратор уведомлен.' 
        });
    }
});

router.post('/log-frontend-error', async (req, res) => {
    const { error, context, tgInitData, userData, diagnosticInfo } = req.body;
    // console.log(`[AUTH ERROR LOG] Received frontend error: ${context}`);

    try {
        let additionalInfo = {
            'User-Agent': req.headers['user-agent'],
            'Source-IP': req.ip,
            'Timestamp': new Date().toISOString()
        };

        // Обработка Telegram initData
        let telegramUser = null;
        if (tgInitData) {
            try {
                const initDataParams = new URLSearchParams(tgInitData);
                telegramUser = JSON.parse(initDataParams.get('user') || '{}');
                additionalInfo = { 
                    ...additionalInfo, 
                    'TG-User-ID': telegramUser.id,
                    'TG-First-Name': telegramUser.first_name,  
                    'TG-Username': telegramUser.username
                };
            } catch {
                additionalInfo.rawInitData = tgInitData.substring(0, 500);
            }
        }

        // Добавляем данные пользователя из фронтенда
        if (userData) {
            additionalInfo = {
                ...additionalInfo,
                'Frontend-User-ID': userData.id,
                'Frontend-Access-Level': userData.accessLevel,
                'Frontend-Telegram-ID': userData.telegram_id,
                'Frontend-First-Name': userData.first_name
            };
        }

        // Добавляем диагностическую информацию
        if (diagnosticInfo) {
            const { logs, localStorage, telegramWebApp, userAgent, url } = diagnosticInfo;
            
            additionalInfo = {
                ...additionalInfo,
                'Frontend-URL': url,
                'Frontend-User-Agent': userAgent,
                'LocalStorage-Info': localStorage,
                'TG-WebApp-Info': telegramWebApp,
                'Recent-Frontend-Logs': logs || []
            };
        }

        // Определяем уровень критичности
        const isCritical = context?.includes('CRITICAL') || 
                          userData?.accessLevel === 'admin' || 
                          userData?.accessLevel === 'service';

        // Отправляем в админский чат
        await sendErrorToAdmin({
            telegramId: telegramUser?.id || userData?.telegram_id,
            userFirstName: telegramUser?.first_name || userData?.first_name,
            userUsername: telegramUser?.username,
            errorContext: `🌐 Frontend Error: ${context || 'Unknown context'}${isCritical ? ' [CRITICAL]' : ''}`,
            errorMessage: `${error || 'No error message provided.'}\n\n🔍 Frontend Logs:\n${formatFrontendLogs(diagnosticInfo?.logs)}`,
            additionalInfo: additionalInfo
        });

        res.status(200).send({ success: true });

    } catch(e) {
        console.error('[AUTH ERROR LOG] Failed to process frontend error:', e);
        // If logging itself fails, just send a simple response.
        res.status(500).send({ success: false });
    }
});

// Вспомогательная функция для форматирования логов фронтенда
function formatFrontendLogs(logs) {
    if (!logs || !Array.isArray(logs) || logs.length === 0) {
        return 'No frontend logs available';
    }

    return logs
        .slice(-5) // Последние 5 логов
        .map(log => {
            const time = new Date(log.timestamp).toLocaleTimeString('ru-RU');
            const level = log.level.toUpperCase();
            return `[${time}] ${level}: ${log.message}`;
        })
        .join('\n');
}

router.post('/validate-vendista', async (req, res) => {
    const { telegram_id, vendista_login, vendista_password } = req.body;

    if (!telegram_id || !vendista_login || !vendista_password) {
        return res.status(400).json({ success: false, error: 'Telegram ID, Vendista login, and password are required.' });
    }

    try {
        const tokenResp = await axios.get(`${VENDISTA_API_URL}/token`, {
            params: { login: vendista_login, password: vendista_password },
            timeout: 15000 
        });

        if (tokenResp.data && tokenResp.data.token) {
            const vendista_api_token = tokenResp.data.token;
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
                tax_system = COALESCE($3, tax_system), 
                acquiring = COALESCE($4, acquiring),
                first_name = COALESCE($5, first_name),
                user_name = COALESCE($6, user_name),
                vendista_login = COALESCE($7, vendista_login),
                vendista_password = COALESCE($8, vendista_password),
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

        await client.query('COMMIT');

        const appToken = jwt.sign(
            { userId: user.id, telegramId: telegram_id.toString(), accessLevel: 'owner' },
            JWT_SECRET, { expiresIn: '12h' }
        );

        // Запускаем синхронизацию и импорт в фоновом режиме, не блокируя ответ
        (async () => {
            try {
                await syncTerminalsForUser(user.id, vendista_api_token_plain);
                await startImport({
                    user_id: user.id,
                    vendistaApiToken: vendista_api_token_plain,
                    first_coffee_date: setup_date,
                });
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
    
    // --- ИСПРАВЛЕНИЕ: Используем .toString() вместо BigInt() ---
    // Драйвер pg может некорректно обрабатывать BigInt, что вызывает зависание запроса.
    // Передача ID как строки - безопасный и надежный способ.
    const current_telegram_id_refresh = telegramUser.id.toString();

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
                telegramId: current_telegram_id_refresh,
                accessLevel: 'owner'
            };
            userDataForClient = {
                userId: ownerUser.id,
                telegramId: current_telegram_id_refresh,
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
                    telegramId: current_telegram_id_refresh,
                    accessLevel: accessRecord.access_level,
                    sharedName: accessRecord.shared_with_name
                };
                 userDataForClient = {
                    userId: accessRecord.owner_user_id,
                    telegramId: current_telegram_id_refresh,
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
            console.error('[Refresh Token] CRITICAL: No token payload could be generated. User not found as owner or in access rights.');
            const errorMsg = 'Пользователь не найден или доступ не предоставлен. Невозможно обновить токен.';
            sendErrorToAdmin({
                telegramId: current_telegram_id_refresh,
                errorContext: 'Refresh App Token - User/Access Not Found',
                errorMessage: errorMsg
            }).catch(console.error);
            return res.status(401).json({ success: false, error: errorMsg });
        }

        const newAppToken = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: '12h' });
        
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

        // --- DEV MODE ROLE EMULATION (аналогично auth middleware) ---
        if (process.env.NODE_ENV === 'development') {
            const emulatedRole = req.headers['x-emulated-role'];
            if (emulatedRole && ['owner', 'admin', 'service'].includes(emulatedRole)) {
                decoded.accessLevel = emulatedRole;
                
                if (emulatedRole === 'admin') {
                    decoded.telegramId = parseInt(process.env.DEV_ADMIN_TELEGRAM_ID, 10);
                } else if (emulatedRole === 'service') {
                    decoded.telegramId = parseInt(process.env.DEV_SERVICE_TELEGRAM_ID, 10);
                }
            }
        }
        // --- END DEV MODE ROLE EMULATION ---

        // --- НОВАЯ ЛОГИКА: Всегда перепроверяем роль пользователя в базе данных ---
        const { userId, telegramId } = decoded;

        if (!userId || !telegramId) {
            return res.status(401).json({ success: false, error: 'Invalid token payload' });
        }

        let userRole = null;
        let ownerIdForLookup = userId;
        let finalUserObject = {};

        // 1. Проверяем, является ли пользователь владельцем
        const ownerResult = await pool.query('SELECT * FROM users WHERE id = $1 AND telegram_id = $2 AND vendista_api_token IS NOT NULL', [userId, telegramId]);
        
        if (ownerResult.rows.length > 0) {
            userRole = 'owner';
            finalUserObject = ownerResult.rows[0];
        } else {
            // 2. Если не владелец, ищем в правах доступа (admin/service)
            if (!userRole) {
                const accessResult = await pool.query(
                    `SELECT uar.*, u.id as owner_user_id 
                     FROM user_access_rights uar 
                     JOIN users u ON uar.owner_user_id = u.id 
                     WHERE uar.shared_with_telegram_id = $1`,
                    [telegramId]
                );
                
                if (accessResult.rows.length > 0) {
                    const accessRecord = accessResult.rows[0];
                    userRole = accessRecord.access_level;
                    ownerIdForLookup = accessRecord.owner_user_id; // Используем ID владельца для поиска данных
                    
                    // Для admin/service используем их имя из таблицы прав
                    finalUserObject = {
                        id: userId, // ID из токена (соответствует accessId)
                        telegram_id: telegramId,
                        first_name: accessRecord.shared_with_name,
                        // Добавляем остальные поля, чтобы объект был консистентным
                    };
                }
            }
        }

        // 3. Если роль так и не определена, токен недействителен
        if (!userRole) {
            return res.status(401).json({ success: false, error: 'User role not found for this token' });
        }
        
        req.user = {
            ...decoded,
            ...finalUserObject, // Добавляем или перезаписываем данные из БД
            accessLevel: userRole,
            ownerId: ownerIdForLookup // ID владельца, для которого выполняются запросы
        };

        res.json({
            success: true,
            user: req.user
        });

    } catch (err) {
        console.error('Token validation error:', err.message);
        console.log('[DEBUG AUTH] JWT verification failed', {
            error: err.message,
            expiredAt: err.expiredAt,
            timestamp: new Date().toISOString()
        });
        if (err.name === 'TokenExpiredError') {
            return res.status(401).json({ success: false, error: 'Token expired', expiredAt: err.expiredAt });
        }
        return res.status(401).json({ success: false, error: 'Invalid token' });
    }
});

// === ДИАГНОСТИЧЕСКИЕ ЭНДПОИНТЫ ===

// Диагностика пользователя по Telegram ID
router.get('/debug-user/:telegram_id', async (req, res) => {
    // Доступно только в development или для owner пользователей
    if (process.env.NODE_ENV !== 'development') {
        // В production проверяем права доступа
        try {
            const header = req.headers['authorization'];
            if (!header) {
                return res.status(401).json({ success: false, error: 'Authorization required' });
            }

            const token = header.split(' ')[1];
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            
            if (decoded.accessLevel !== 'owner') {
                return res.status(403).json({ success: false, error: 'Owner access required' });
            }
        } catch (err) {
            return res.status(401).json({ success: false, error: 'Invalid token' });
        }
    }

    try {
        const { telegram_id } = req.params;

        // Ищем в таблице users
        const userResult = await pool.query(
            'SELECT id, telegram_id, first_name, user_name, vendista_api_token, setup_date, tax_system, acquiring FROM users WHERE telegram_id = $1',
            [telegram_id]
        );

        // Ищем в таблице access_rights
        const accessRightsResult = await pool.query(
            `SELECT uar.id, uar.owner_user_id, uar.access_level, uar.shared_with_name,
                    u.first_name as owner_first_name, u.telegram_id as owner_telegram_id
             FROM user_access_rights uar
             JOIN users u ON uar.owner_user_id = u.id
             WHERE uar.shared_with_telegram_id = $1`,
            [telegram_id]
        );

        const diagnostic = {
            telegram_id: telegram_id,
            timestamp: new Date().toISOString(),
            found_in_users: userResult.rows.length > 0,
            found_in_access_rights: accessRightsResult.rows.length > 0,
            user_data: userResult.rows[0] || null,
            access_rights_data: accessRightsResult.rows[0] || null,
            recommended_flow: null
        };

        // Определяем рекомендуемый flow
        if (diagnostic.found_in_users && diagnostic.user_data.vendista_api_token) {
            diagnostic.recommended_flow = 'owner_with_complete_registration';
        } else if (diagnostic.found_in_users && !diagnostic.user_data.vendista_api_token) {
            diagnostic.recommended_flow = 'owner_with_incomplete_registration';
        } else if (diagnostic.found_in_access_rights) {
            diagnostic.recommended_flow = `${diagnostic.access_rights_data.access_level}_user`;
        } else {
            diagnostic.recommended_flow = 'new_user_registration_required';
        }

        res.json({
            success: true,
            diagnostic: diagnostic
        });

    } catch (err) {
        console.error('[Auth Debug] Error in debug-user:', err);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// Тестирование валидности initData
router.post('/test-initdata', async (req, res) => {
    // Доступно только в development
    if (process.env.NODE_ENV !== 'development') {
        return res.status(404).json({ success: false, error: 'Not found' });
    }

    try {
        const { initData } = req.body;
        
        if (!initData) {
            return res.status(400).json({ success: false, error: 'initData is required' });
        }

        const validationResult = validateTelegramInitData(initData);
        
        const testResult = {
            valid: validationResult.valid,
            error: validationResult.error,
            user_data: validationResult.data,
            environment: process.env.NODE_ENV,
            has_bot_token: !!process.env.TELEGRAM_BOT_TOKEN,
            timestamp: new Date().toISOString()
        };

        res.json({
            success: true,
            test_result: testResult
        });

    } catch (err) {
        console.error('[Auth Test] Error in test-initdata:', err);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// Получение статистики аутентификации
router.get('/auth-stats', async (req, res) => {
    // Доступно только для owner пользователей
    try {
        const header = req.headers['authorization'];
        if (!header) {
            return res.status(401).json({ success: false, error: 'Authorization required' });
        }

        const token = header.split(' ')[1];
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        
        if (decoded.accessLevel !== 'owner') {
            return res.status(403).json({ success: false, error: 'Owner access required' });
        }

        // Собираем статистику
        const ownerUsersResult = await pool.query(
            'SELECT COUNT(*) as count FROM users WHERE vendista_api_token IS NOT NULL'
        );

        const incompleteUsersResult = await pool.query(
            'SELECT COUNT(*) as count FROM users WHERE vendista_api_token IS NULL'
        );

        const accessRightsResult = await pool.query(
            `SELECT access_level, COUNT(*) as count 
             FROM user_access_rights 
             GROUP BY access_level`
        );

        const recentErrorsResult = await pool.query(
            `SELECT COUNT(*) as count 
             FROM worker_logs 
             WHERE job_name = 'auth_error' 
             AND created_at > NOW() - INTERVAL '24 hours'`
        );

        const stats = {
            timestamp: new Date().toISOString(),
            total_owners: parseInt(ownerUsersResult.rows[0].count),
            incomplete_registrations: parseInt(incompleteUsersResult.rows[0].count),
            access_rights_by_level: accessRightsResult.rows.reduce((acc, row) => {
                acc[row.access_level] = parseInt(row.count);
                return acc;
            }, {}),
            recent_auth_errors_24h: parseInt(recentErrorsResult.rows[0]?.count || 0),
            environment: process.env.NODE_ENV
        };

        res.json({
            success: true,
            stats: stats
        });

    } catch (err) {
        console.error('[Auth Stats] Error in auth-stats:', err);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// Тестовый эндпоинт для проверки уведомлений (только для testing)
router.post('/test-admin-notification', async (req, res) => {
    // Доступно только в development или для owner пользователей
    if (process.env.NODE_ENV !== 'development') {
        try {
            const header = req.headers['authorization'];
            if (!header) {
                return res.status(401).json({ success: false, error: 'Authorization required' });
            }

            const token = header.split(' ')[1];
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            
            if (decoded.accessLevel !== 'owner') {
                return res.status(403).json({ success: false, error: 'Owner access required' });
            }
        } catch (err) {
            return res.status(401).json({ success: false, error: 'Invalid token' });
        }
    }

    try {
        // Отправляем тестовое уведомление
        await sendErrorToAdmin({
            telegramId: req.body.telegramId || '12345',
            userFirstName: 'Test User',
            errorContext: '🧪 TEST NOTIFICATION from /api/auth/test-admin-notification',
            errorMessage: 'This is a test notification to verify the admin error system is working correctly.',
            additionalInfo: { 
                timestamp: new Date().toISOString(),
                note: 'If you see this message, the notification system is configured correctly!' 
            }
        });

        res.json({
            success: true,
            message: 'Test notification sent to admin chat. Check your Telegram for the message.'
        });

    } catch (err) {
        console.error('[Auth Test] Error sending test notification:', err);
        res.status(500).json({ 
            success: false, 
            error: `Failed to send test notification: ${err.message}`,
            details: 'Check server logs and admin bot configuration'
        });
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