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

// --- Вспомогательная функция для поиска или создания терминала в нашей БД ---
async function findOrCreateTerminal(client, userId, vendistaId, details = {}) {
    let terminalRes = await client.query('SELECT id FROM terminals WHERE vendista_terminal_id = $1 AND user_id = $2', [vendistaId, userId]);
    let internalTerminalId;

    if (terminalRes.rows.length === 0) {
        const { name, serial_number } = details;
        const insertRes = await client.query(
            'INSERT INTO terminals (user_id, vendista_terminal_id, name, serial_number) VALUES ($1, $2, $3, $4) RETURNING id',
            [userId, vendistaId, name || `Терминал ${vendistaId}`, serial_number || '']
        );
        internalTerminalId = insertRes.rows[0].id;
    } else {
        internalTerminalId = terminalRes.rows[0].id;
    }
    return internalTerminalId;
}


// Получить список всех терминалов (стоек) для пользователя
router.get('/', authMiddleware, async (req, res) => {
    const userId = req.user.userId;

    try {
        const userRes = await pool.query('SELECT vendista_api_token FROM users WHERE id = $1', [userId]);
        if (userRes.rows.length === 0 || !userRes.rows[0].vendista_api_token) {
            return res.status(403).json({ success: false, error: 'API токен Vendista не найден для этого пользователя.' });
        }

        const encryptedToken = userRes.rows[0].vendista_api_token;
        const vendistaToken = decrypt(encryptedToken);

        if (!vendistaToken) {
            return res.status(500).json({ success: false, error: 'Не удалось дешифровать API токен.' });
        }

        const vendistaResponse = await axios.get(`${VENDISTA_API_URL}/terminals`, {
            params: { token: vendistaToken, ItemsOnPage: 500 },
            timeout: 20000
        });

        if (!vendistaResponse.data.success || !vendistaResponse.data.items) {
             return res.status(502).json({ success: false, error: 'Ошибка от API Vendista: ' + (vendistaResponse.data.error || 'Нет данных') });
        }

        let terminals = vendistaResponse.data.items;

        terminals.sort((a, b) => {
            const aOnline = (a.last24_hours_online || 0) > 0;
            const bOnline = (b.last24_hours_online || 0) > 0;
            if (aOnline && !bOnline) return -1;
            if (!aOnline && bOnline) return 1;
            return (a.comment || '').localeCompare(b.comment || '');
        });

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

// Получить детали конкретного терминала по его VENDISTA ID
router.get('/vendista/:vendistaId/details', authMiddleware, async (req, res) => {
    const userId = req.user.userId;
    const { vendistaId } = req.params;

    if (!vendistaId || isNaN(parseInt(vendistaId))) {
        return res.status(400).json({ success: false, error: 'Некорректный ID терминала' });
    }

    const client = await pool.pool.connect();
    try {
        const internalTerminalId = await findOrCreateTerminal(client, userId, vendistaId, req.query);
        
        const inventoryRes = await client.query(
            "SELECT item_name, location, current_stock, max_stock, critical_stock FROM inventories WHERE user_id = $1 AND terminal_id = $2 ORDER BY item_name",
            [userId, internalTerminalId]
        );
        
        res.json({
            success: true,
            details: { inventory: inventoryRes.rows }
        });

    } catch (err) {
        console.error(`[GET /api/terminals/vendista/:id/details] UserID: ${userId} - Error:`, err);
        sendErrorToAdmin({
            userId: userId, errorContext: `GET /api/terminals/vendista/${vendistaId}/details`,
            errorMessage: err.message, errorStack: err.stack,
        }).catch(console.error);
        res.status(500).json({ success: false, error: 'Ошибка сервера при получении деталей стойки' });
    } finally {
        client.release();
    }
});

// --- НОВЫЙ ЭНДПОИНТ ДЛЯ СОХРАНЕНИЯ НАСТРОЕК ---
router.post('/vendista/:vendistaId/settings', authMiddleware, async (req, res) => {
    const userId = req.user.userId;
    const { vendistaId } = req.params;
    const { inventorySettings } = req.body; // Ожидаем массив объектов

    if (!vendistaId || isNaN(parseInt(vendistaId))) {
        return res.status(400).json({ success: false, error: 'Некорректный ID терминала' });
    }
    if (!Array.isArray(inventorySettings)) {
        return res.status(400).json({ success: false, error: 'Неверный формат данных' });
    }

    const client = await pool.pool.connect();
    try {
        await client.query('BEGIN');

        const internalTerminalId = await findOrCreateTerminal(client, userId, vendistaId);

        // Используем цикл для обновления или вставки каждой настройки
        for (const item of inventorySettings) {
            const { item_name, location, max_stock, critical_stock } = item;
            
            // Валидация
            if (!item_name || !location) continue;
            const max = max_stock !== null && !isNaN(parseFloat(max_stock)) ? parseFloat(max_stock) : null;
            const critical = critical_stock !== null && !isNaN(parseFloat(critical_stock)) ? parseFloat(critical_stock) : null;

            await client.query(
                `INSERT INTO inventories (user_id, terminal_id, item_name, location, max_stock, critical_stock)
                 VALUES ($1, $2, $3, $4, $5, $6)
                 ON CONFLICT (user_id, terminal_id, item_name, location) 
                 DO UPDATE SET
                    max_stock = EXCLUDED.max_stock,
                    critical_stock = EXCLUDED.critical_stock,
                    updated_at = NOW()`,
                [userId, internalTerminalId, item_name, location, max, critical]
            );
        }

        await client.query('COMMIT');
        res.json({ success: true, message: 'Настройки успешно сохранены!' });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error(`[POST /api/terminals/vendista/:id/settings] UserID: ${userId} - Error:`, err);
        sendErrorToAdmin({
            userId: userId, errorContext: `POST /api/terminals/vendista/${vendistaId}/settings`,
            errorMessage: err.message, errorStack: err.stack,
        }).catch(console.error);
        res.status(500).json({ success: false, error: 'Ошибка сервера при сохранении настроек' });
    } finally {
        client.release();
    }
});

module.exports = router;