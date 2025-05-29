// backend/routes/auth.js
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') }); 
const express = require('express');
const jwt = require('jsonwebtoken');
const pool = require('../db');
const axios = require('axios');
const crypto = require('crypto');
const { startImport } = require('../worker/vendista_import_worker');

const router = express.Router();

const VENDISTA_API_URL = process.env.VENDISTA_API_BASE_URL || 'https://api.vendista.ru:99';
const JWT_SECRET = process.env.JWT_SECRET;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

if (!JWT_SECRET) {
    console.error("FATAL ERROR: JWT_SECRET is not defined in .env file.");
    process.exit(1);
}
if (!TELEGRAM_BOT_TOKEN) {
    console.error("FATAL ERROR: TELEGRAM_BOT_TOKEN is not defined in .env file for auth validation.");
    // process.exit(1); // Можно раскомментировать, если валидация initData критична сразу
}

// Helper function to validate Telegram initData
const validateTelegramInitData = (initDataString) => {
  if (!TELEGRAM_BOT_TOKEN) {
    console.error('[Auth Validate] Telegram Bot Token not configured on backend. Skipping initData validation.');
    // В режиме разработки можно разрешить без валидации, но для продакшена это небезопасно.
    // Сейчас мы вернем 'valid: true' если токен не задан, чтобы упростить первоначальную настройку.
    // В продакшене это условие нужно убрать и требовать токен.
    // return { valid: false, data: null }; // Строгий вариант
     try { // Попытка распарсить данные даже без валидации хеша
        const params = new URLSearchParams(initDataString);
        const user = params.get('user');
        if (user) {
            console.warn('[Auth Validate] DEV MODE: Proceeding without hash validation due to missing TELEGRAM_BOT_TOKEN.');
            return { valid: true, data: JSON.parse(decodeURIComponent(user)) };
        }
        return { valid: false, data: null};
     } catch (e) {
        console.error('[Auth Validate] Error parsing user data without validation:', e);
        return { valid: false, data: null };
     }
  }

  const params = new URLSearchParams(initDataString);
  const hash = params.get('hash');
  if (!hash) {
    console.warn('[Auth Validate] No hash found in initData.');
    return { valid: false, data: null };
  }
  params.delete('hash');

  const dataCheckArr = [];
  for (const [key, value] of params.entries()) {
    dataCheckArr.push(`${key}=${value}`);
  }
  dataCheckArr.sort();
  const dataCheckString = dataCheckArr.join('\n');

  try {
    const secretKey = crypto.createHmac('sha256', 'WebAppData').update(TELEGRAM_BOT_TOKEN).digest();
    const calculatedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

    if (calculatedHash === hash) {
      const user = params.get('user');
      return { valid: true, data: JSON.parse(decodeURIComponent(user)) };
    }
    console.warn('[Auth Validate] Hash mismatch.');
    return { valid: false, data: null };
  } catch (e) {
    console.error('[Auth Validate] Error during crypto operations or JSON parsing:', e);
    return { valid: false, data: null };
  }
};


// --- Telegram Login / Initial Handshake ---
router.post('/telegram-login', async (req, res) => {
  const { initData } = req.body;
  console.log('[POST /api/auth/telegram-login] Received request');

  if (!initData) {
    console.log('[POST /api/auth/telegram-login] Failed: initData is required.');
    return res.status(400).json({ success: false, error: 'initData is required.' });
  }

  const validationResult = validateTelegramInitData(initData);
  if (!validationResult.valid || !validationResult.data?.id) {
    console.log('[POST /api/auth/telegram-login] Failed: Invalid Telegram data.', validationResult);
    return res.status(403).json({ success: false, error: 'Invalid Telegram data.' });
  }

  const telegram_id = validationResult.data.id;
  console.log(`[POST /api/auth/telegram-login] Validated Telegram ID: ${telegram_id}`);

  try {
    const userResult = await pool.query('SELECT id, vendista_api_token, setup_date, tax_system, acquiring FROM users WHERE telegram_id = $1', [telegram_id]);

    if (userResult.rows.length > 0) {
      const user = userResult.rows[0];
      console.log(`[POST /api/auth/telegram-login] User found with ID: ${user.id}`);
      if (user.vendista_api_token) {
        console.log(`[POST /api/auth/telegram-login] User ${user.id} is fully registered. Action: login_success`);
        const appToken = jwt.sign({ userId: user.id, telegramId: telegram_id }, JWT_SECRET, { expiresIn: '12h' });
        res.json({
          success: true,
          action: 'login_success',
          token: appToken,
          user: {
            userId: user.id,
            telegram_id: telegram_id.toString(), // Ensure string for consistency
            setup_date: user.setup_date,
            tax_system: user.tax_system,
            acquiring: user.acquiring !== null ? String(user.acquiring) : null,
          }
        });
      } else {
        console.log(`[POST /api/auth/telegram-login] User ${user.id} registration incomplete. Action: registration_incomplete`);
        res.json({
          success: true,
          action: 'registration_incomplete',
          telegram_id: telegram_id.toString(),
          message: 'Please complete your Vendista account setup.'
        });
      }
    } else {
      console.log(`[POST /api/auth/telegram-login] New user. Action: registration_required`);
      res.json({
        success: true,
        action: 'registration_required',
        telegram_id: telegram_id.toString(),
        message: 'Welcome! Please register your Vendista account.'
      });
    }
  } catch (err) {
    console.error("[POST /api/auth/telegram-login] Error:", err);
    res.status(500).json({ success: false, error: 'Server error during login.' });
  }
});

// --- Step 1 of Registration: Validate Vendista & Get Long-Lived Token ---
router.post('/vendista-credentials', async (req, res) => {
  const { telegram_id, vendista_login, vendista_password } = req.body;
  console.log(`[POST /api/auth/vendista-credentials] Received for TG ID: ${telegram_id}, Login: ${vendista_login}`);

  if (!telegram_id || !vendista_login || !vendista_password) {
    return res.status(400).json({ success: false, error: 'Telegram ID, Vendista login, and password are required.' });
  }

  try {
    console.log(`[POST /api/auth/vendista-credentials] Requesting Vendista token from ${VENDISTA_API_URL}/token`);
    const tokenResp = await axios.get(`${VENDISTA_API_URL}/token`, {
      params: { login: vendista_login, password: vendista_password },
      timeout: 15000
    });

    if (tokenResp.data && tokenResp.data.token) {
      const vendista_api_token = tokenResp.data.token;
      console.log(`[POST /api/auth/vendista-credentials] Vendista token obtained successfully for TG ID: ${telegram_id}`);
      res.json({ success: true, vendista_api_token: vendista_api_token });
    } else {
      console.log(`[POST /api/auth/vendista-credentials] Failed to get Vendista token. Response:`, tokenResp.data);
      res.status(401).json({ success: false, error: 'Invalid Vendista credentials or unable to fetch token.' });
    }
  } catch (err) {
    console.error("[POST /api/auth/vendista-credentials] Error validating Vendista credentials:", err.response?.data || err.message);
    let errorMessage = 'Error connecting to Vendista.';
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

// --- Step 2 of Registration: Complete User Profile & Store Vendista Token ---
router.post('/complete-registration', async (req, res) => {
  const { telegram_id, vendista_api_token, setup_date, tax_system, acquiring } = req.body;
  console.log(`[POST /api/auth/complete-registration] Received for TG ID: ${telegram_id}`);

  if (!telegram_id || !vendista_api_token || !setup_date) {
    return res.status(400).json({ success: false, error: 'Missing required registration data.' });
  }

  try {
    let userResult = await pool.query('SELECT id FROM users WHERE telegram_id = $1', [telegram_id]);
    let userId;

    if (userResult.rows.length > 0) {
      userId = userResult.rows[0].id;
      console.log(`[POST /api/auth/complete-registration] Updating existing user ID: ${userId} for TG ID: ${telegram_id}`);
      await pool.query(
        `UPDATE users SET vendista_api_token = $1, setup_date = $2, tax_system = $3, acquiring = $4, updated_at = NOW()
         WHERE id = $5`,
        [vendista_api_token, setup_date, tax_system || null, acquiring || null, userId]
      );
    } else {
      console.log(`[POST /api/auth/complete-registration] Inserting new user for TG ID: ${telegram_id}`);
      const insertResult = await pool.query(
        `INSERT INTO users (telegram_id, vendista_api_token, setup_date, tax_system, acquiring, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, NOW(), NOW()) RETURNING id`,
        [BigInt(telegram_id), vendista_api_token, setup_date, tax_system || null, acquiring || null]
      );
      userId = insertResult.rows[0].id;
      console.log(`[POST /api/auth/complete-registration] New user created with ID: ${userId}`);
    }

    console.log(`[POST /api/auth/complete-registration] Initiating first import for user ID: ${userId}`);
    startImport({
      user_id: userId,
      vendistaApiToken: vendista_api_token,
      first_coffee_date: setup_date
    }).catch(importError => console.error(`[POST /api/auth/complete-registration] Initial import failed for user ${userId}:`, importError.message));

    const appToken = jwt.sign({ userId: userId, telegramId: telegram_id }, JWT_SECRET, { expiresIn: '12h' });

    res.status(201).json({
      success: true,
      token: appToken,
      user: {
        userId: userId,
        telegram_id: telegram_id.toString(),
        setup_date: setup_date,
        tax_system: tax_system,
        acquiring: acquiring !== null ? String(acquiring) : null,
      }
    });

  } catch (err) {
    console.error("[POST /api/auth/complete-registration] Error:", err);
    if (err.code === '23505' && err.constraint === 'users_telegram_id_unique') {
        return res.status(409).json({ success: false, error: 'This Telegram account is already registered.' });
    }
    res.status(500).json({ success: false, error: 'Server error during registration completion.' });
  }
});


// --- Refresh App Token (used by frontend interceptor on 401) ---
router.post('/refresh-app-token', async (req, res) => {
    const { initData } = req.body;
    console.log('[POST /api/auth/refresh-app-token] Received request');

    if (!initData) {
        console.log('[POST /api/auth/refresh-app-token] Failed: initData is required.');
        return res.status(400).json({ success: false, error: 'initData is required for token refresh.' });
    }

    const validationResult = validateTelegramInitData(initData);
    if (!validationResult.valid || !validationResult.data?.id) {
        console.log('[POST /api/auth/refresh-app-token] Failed: Invalid Telegram initData.');
        return res.status(401).json({ success: false, error: 'Invalid or missing Telegram data. Cannot refresh token.' });
    }
    
    const telegram_id = validationResult.data.id;
    console.log(`[POST /api/auth/refresh-app-token] Validated Telegram ID: ${telegram_id} for refresh`);

    try {
        const userRes = await pool.query(
            'SELECT id, setup_date, tax_system, acquiring, vendista_api_token FROM users WHERE telegram_id = $1',
            [telegram_id]
        );

        if (userRes.rows.length === 0) {
            console.warn(`[POST /api/auth/refresh-app-token] User not found for Telegram ID: ${telegram_id}`);
            return res.status(401).json({ success: false, error: 'User not found. Please log in again.' });
        }
        
        const user = userRes.rows[0];
        console.log(`[POST /api/auth/refresh-app-token] User ${user.id} found.`);

        if (!user.vendista_api_token) {
            console.warn(`[POST /api/auth/refresh-app-token] User ${user.id} (TG: ${telegram_id}) missing Vendista API token.`);
            return res.status(401).json({ success: false, error: 'Account setup incomplete. Cannot refresh token.' });
        }
        
        const newAppToken = jwt.sign(
            { userId: user.id, telegramId: telegram_id },
            JWT_SECRET,
            { expiresIn: '12h' }
        );
        
        console.log(`[POST /api/auth/refresh-app-token] App token refreshed for user ${user.id} (TG: ${telegram_id})`);
        res.json({
            success: true,
            token: newAppToken,
            user: { 
                userId: user.id,
                telegram_id: telegram_id.toString(),
                setup_date: user.setup_date,
                tax_system: user.tax_system,
                acquiring: user.acquiring !== null ? String(user.acquiring) : null,
            }
        });

    } catch (err) {
        console.error("[POST /api/auth/refresh-app-token] Error:", err);
        res.status(500).json({ success: false, error: 'Internal server error during token refresh.' });
    }
});

module.exports = router;