// backend/routes/terminals.js
const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const pool = require('../db');
const axios = require('axios');
const { sendErrorToAdmin } = require('../utils/adminErrorNotifier');
const crypto = require('crypto');

const VENDISTA_API_URL = process.env.VENDISTA_API_URL || 'https://api.vendista.ru:99';
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;
const ALGORITHM = 'aes-256-cbc';

// --- Функция дешифровки токена (в будущем вынесем в общий модуль) ---
function decrypt(text) {
    if (!ENCRYPTION_KEY) {
        console.error('ENCRYPTION_KEY is not set. Cannot decrypt.');
        throw new Error('Encryption key not set for decrypt function.');
    }
    if (!text || typeof text !== 'string' || !text.includes(':')) {
        console.error('Invalid text format for decryption:', text);
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
        return decrypted.toString('utf8');
    } catch (error) {
        console.error('Decryption failed:', error);
        return null;
    }
}

// --- Получить список всех терминалов (стоек) для пользователя ---
router.get('/', authMiddleware, async (req, res) => {
    const userId = req.user.userId;

    try {
        // 1. Получаем зашифрованный токен пользователя из нашей БД
        const userRes = await pool.query('SELECT vendista_api_token FROM users WHERE id = $1', [userId]);
        if (userRes.rows.length === 0 || !userRes.rows[0].vendista_api_token) {
            return res.status(403).json({ success: false, error: 'API токен Vendista не найден для этого пользователя.' });
        }

        const encryptedToken = userRes.rows[0].vendista_api_token;
        const vendistaToken = decrypt(encryptedToken);

        if (!vendistaToken) {
            return res.status(500).json({ success: false, error: 'Не удалось дешифровать API токен.' });
        }

        // 2. Делаем запрос к API Vendista
        const vendistaResponse = await axios.get(`${VENDISTA_API_URL}/terminals`, {
            params: {
                token: vendistaToken,
                ItemsOnPage: 500 // Запрашиваем с запасом
            },
            timeout: 20000 // Таймаут 20 секунд
        });

        if (!vendistaResponse.data.success || !vendistaResponse.data.items) {
             return res.status(502).json({ success: false, error: 'Ошибка от API Vendista: ' + (vendistaResponse.data.error || 'Нет данных') });
        }

        let terminals = vendistaResponse.data.items;

        // 3. Сортируем терминалы: сначала те, что были онлайн за последние 24 часа
        terminals.sort((a, b) => {
            const aOnline = (a.last24_hours_online || 0) > 0;
            const bOnline = (b.last24_hours_online || 0) > 0;
            if (aOnline && !bOnline) return -1;
            if (!aOnline && bOnline) return 1;
            // Если оба онлайн или оба оффлайн, сортируем по имени (comment)
            return (a.comment || '').localeCompare(b.comment || '');
        });

        // TODO: В будущем здесь будет обогащение данных из нашей таблицы `terminals`

        res.json({ success: true, terminals: terminals });

    } catch (err) {
        console.error(`[GET /api/terminals] UserID: ${userId} - Error:`, err);
        sendErrorToAdmin({
            userId: userId,
            errorContext: `GET /api/terminals - UserID: ${userId}`,
            errorMessage: err.message,
            errorStack: err.stack,
        }).catch(console.error);
        res.status(500).json({ success: false, error: 'Ошибка сервера при получении списка стоек' });
    }
});


module.exports = router;