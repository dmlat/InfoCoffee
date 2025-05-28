require('dotenv').config();
const express = require('express');
const jwt = require('jsonwebtoken');
const pool = require('../db');
const axios = require('axios');
const crypto = require('crypto');
const { startImport } = require('../worker/vendista_import_worker');

const router = express.Router();

const VENDISTA_API_URL = process.env.VENDISTA_API_BASE_URL || 'https://api.vendista.ru:99';

// Helper function to validate Telegram initData
const validateTelegramInitData = (initDataString) => {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    console.error('Telegram Bot Token not configured on backend.');
    return { valid: false, data: null };
  }

  const params = new URLSearchParams(initDataString);
  const hash = params.get('hash');
  params.delete('hash');

  // Sort keys alphabetically for hash calculation
  const dataCheckArr = [];
  for (const [key, value] of params.entries()) {
    dataCheckArr.push(`${key}=${value}`);
  }
  dataCheckArr.sort();
  const dataCheckString = dataCheckArr.join('\n');

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const calculatedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  if (calculatedHash === hash) {
    const user = params.get('user');
    try {
      return { valid: true, data: JSON.parse(decodeURIComponent(user)) };
    } catch (e) {
      console.error('Error parsing Telegram user data:', e);
      return { valid: false, data: null };
    }
  }
  return { valid: false, data: null };
};


// --- Telegram Login / Initial Handshake ---
router.post('/telegram-login', async (req, res) => {
  const { initData } = req.body;

  if (!initData) {
    return res.status(400).json({ success: false, error: 'initData is required.' });
  }

  const validationResult = validateTelegramInitData(initData);
  if (!validationResult.valid || !validationResult.data?.id) {
    return res.status(403).json({ success: false, error: 'Invalid Telegram data.' });
  }

  const telegram_id = validationResult.data.id;

  try {
    const userResult = await pool.query('SELECT id, vendista_api_token, setup_date, tax_system, acquiring FROM users WHERE telegram_id = $1', [telegram_id]);

    if (userResult.rows.length > 0) {
      const user = userResult.rows[0];
      if (user.vendista_api_token) {
        // User exists and is fully registered
        const appToken = jwt.sign({ userId: user.id, telegramId: telegram_id }, process.env.JWT_SECRET, { expiresIn: '12h' });
        res.json({
          success: true,
          action: 'login_success',
          token: appToken,
          user: {
            userId: user.id,
            telegram_id: telegram_id,
            setup_date: user.setup_date,
            tax_system: user.tax_system,
            acquiring: user.acquiring,
            // vendista_api_token: user.vendista_api_token // Client might not need this
          }
        });
      } else {
        // User exists but registration is incomplete (missing Vendista token)
        res.json({
          success: true,
          action: 'registration_incomplete',
          telegram_id: telegram_id,
          message: 'Please complete your Vendista account setup.'
        });
      }
    } else {
      // New user, registration required
      res.json({
        success: true,
        action: 'registration_required',
        telegram_id: telegram_id,
        message: 'Welcome! Please register your Vendista account.'
      });
    }
  } catch (err) {
    console.error("Error in /telegram-login:", err);
    res.status(500).json({ success: false, error: 'Server error during login.' });
  }
});

// --- Step 1 of Registration: Validate Vendista & Get Long-Lived Token ---
router.post('/vendista-credentials', async (req, res) => {
  const { telegram_id, vendista_login, vendista_password } = req.body;

  if (!telegram_id || !vendista_login || !vendista_password) {
    return res.status(400).json({ success: false, error: 'Telegram ID, Vendista login, and password are required.' });
  }

  try {
    // For MVP, we assume the token obtained from /token IS the long-lived one.
    // In a real scenario, Vendista might have a different endpoint or method for permanent tokens.
    const tokenResp = await axios.get(`${VENDISTA_API_URL}/token`, {
      params: { login: vendista_login, password: vendista_password },
      timeout: 15000
    });

    if (tokenResp.data && tokenResp.data.token) {
      const vendista_api_token = tokenResp.data.token;
      // Further validation (e.g., fetching terminals) can be done here if needed
      // For now, a successful token fetch is considered validation.
      res.json({ success: true, vendista_api_token: vendista_api_token });
    } else {
      res.status(401).json({ success: false, error: 'Invalid Vendista credentials or unable to fetch token.' });
    }
  } catch (err) {
    console.error("Error validating Vendista credentials:", err.response?.data || err.message);
    let errorMessage = 'Error connecting to Vendista.';
    if (err.response?.status === 401 || err.response?.data?.error?.includes('auth')) {
        errorMessage = 'Invalid Vendista login or password.';
    } else if (err.response?.data?.error) {
        errorMessage = err.response.data.error;
    }
    res.status(err.response?.status || 500).json({ success: false, error: errorMessage });
  }
});

// --- Step 2 of Registration: Complete User Profile & Store Vendista Token ---
router.post('/complete-registration', async (req, res) => {
  const { telegram_id, vendista_api_token, setup_date, tax_system, acquiring } = req.body;

  if (!telegram_id || !vendista_api_token || !setup_date) {
    return res.status(400).json({ success: false, error: 'Missing required registration data.' });
  }

  try {
    // Check if user with this telegram_id already exists
    let userResult = await pool.query('SELECT id FROM users WHERE telegram_id = $1', [telegram_id]);
    let userId;

    if (userResult.rows.length > 0) {
      // User exists (incomplete registration case), update them
      userId = userResult.rows[0].id;
      await pool.query(
        `UPDATE users SET vendista_api_token = $1, setup_date = $2, tax_system = $3, acquiring = $4, updated_at = NOW()
         WHERE id = $5`,
        [vendista_api_token, setup_date, tax_system || null, acquiring || null, userId]
      );
    } else {
      // New user, insert them
      const insertResult = await pool.query(
        `INSERT INTO users (telegram_id, vendista_api_token, setup_date, tax_system, acquiring, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, NOW(), NOW()) RETURNING id`,
        [telegram_id, vendista_api_token, setup_date, tax_system || null, acquiring || null]
      );
      userId = insertResult.rows[0].id;
    }

    // Initial data import (async, don't wait)
    startImport({
      user_id: userId,
      vendistaApiToken: vendista_api_token, // Worker needs the token now
      first_coffee_date: setup_date
    }).catch(importError => console.error(`Initial import failed for user ${userId}:`, importError));

    const appToken = jwt.sign({ userId: userId, telegramId: telegram_id }, process.env.JWT_SECRET, { expiresIn: '12h' });

    res.status(201).json({
      success: true,
      token: appToken,
      user: {
        userId: userId,
        telegram_id: telegram_id,
        setup_date: setup_date,
        tax_system: tax_system,
        acquiring: acquiring,
      }
    });

  } catch (err) {
    console.error("Error in /complete-registration:", err);
    if (err.code === '23505' && err.constraint === 'users_telegram_id_unique') {
        return res.status(409).json({ success: false, error: 'This Telegram account is already registered.' });
    }
    res.status(500).json({ success: false, error: 'Server error during registration completion.' });
  }
});


// --- Refresh App Token (used by frontend interceptor on 401) ---
router.post('/refresh-app-token', async (req, res) => {
    const { initData } = req.body; // Expect full initData for validation

    if (!initData) {
        return res.status(400).json({ success: false, error: 'initData is required for token refresh.' });
    }

    const validationResult = validateTelegramInitData(initData);
    if (!validationResult.valid || !validationResult.data?.id) {
        console.warn('[refresh-app-token] Invalid Telegram initData received.');
        return res.status(401).json({ success: false, error: 'Invalid or missing Telegram data. Cannot refresh token.' });
    }
    
    const telegram_id = validationResult.data.id;

    try {
        const userRes = await pool.query(
            'SELECT id, setup_date, tax_system, acquiring, vendista_api_token FROM users WHERE telegram_id = $1',
            [telegram_id]
        );

        if (userRes.rows.length === 0) {
            console.warn(`[refresh-app-token] User not found for Telegram ID: ${telegram_id}`);
            return res.status(401).json({ success: false, error: 'User not found. Please log in again.' });
        }
        
        const user = userRes.rows[0];

        if (!user.vendista_api_token) {
            console.warn(`[refresh-app-token] User ${user.id} (TG: ${telegram_id}) missing Vendista API token. Registration likely incomplete.`);
            return res.status(401).json({ success: false, error: 'Account setup incomplete. Cannot refresh token.' });
        }

        // For MVP, we trust the stored vendista_api_token.
        // A more robust solution might re-validate it with Vendista if it can expire or be revoked.

        const newAppToken = jwt.sign(
            { userId: user.id, telegramId: telegram_id },
            process.env.JWT_SECRET,
            { expiresIn: '12h' }
        );
        
        console.log(`[refresh-app-token] App token refreshed for user ${user.id} (TG: ${telegram_id})`);
        res.json({
            success: true,
            token: newAppToken,
            user: { // Send back user data so frontend can update localStorage
                userId: user.id,
                telegram_id: telegram_id,
                setup_date: user.setup_date,
                tax_system: user.tax_system,
                acquiring: user.acquiring,
            }
        });

    } catch (err) {
        console.error("Error in /refresh-app-token:", err);
        res.status(500).json({ success: false, error: 'Internal server error during token refresh.' });
    }
});


module.exports = router;