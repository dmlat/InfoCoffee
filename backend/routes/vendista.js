const express = require('express');
const router = express.Router();
const axios = require('axios');
const db = require('../db');
const bcrypt = require('bcrypt');

// 1. Проверка Vendista профиля (по терминалам)
router.post('/validate', async (req, res) => {
    const { login, password } = req.body;
    try {
        const tokenResp = await axios.get('https://api.vendista.ru:99/token', {
            params: { login, password }
        });
        const token = tokenResp.data.token;
        if (!token) return res.json({ success: false, error: 'Vendista: не удалось получить токен' });

        const terminalsResp = await axios.get('https://api.vendista.ru:99/terminals', {
            params: { token }
        });
        if (!terminalsResp.data.items || terminalsResp.data.items.length === 0) {
            return res.json({ success: false, error: 'Vendista: нет терминалов или неверные данные' });
        }
        return res.json({ success: true, terminals: terminalsResp.data.items.length });
    } catch (e) {
        return res.json({ success: false, error: 'Ошибка Vendista: ' + e.message });
    }
});

// 2. Регистрация + запуск импорта
router.post('/register-and-import', async (req, res) => {
    const { email, password, vendistaLogin, vendistaPass, setupDate, taxSystem, acq } = req.body;
    try {
        // Проверяем есть ли уже пользователь
        let existing = await db.query('SELECT id FROM users WHERE email=$1', [email]);
        if (existing.rows.length > 0) return res.status(400).json({ error: 'Пользователь уже существует' });

        // Хэшируем пароль
        const saltRounds = 10;
        const password_hash = await bcrypt.hash(password, saltRounds);

        // Вставляем пользователя
        const insertRes = await db.query(
            `INSERT INTO users (email, password_hash, created_at, first_coffee_date, tax_mode, acquiring_commis)
             VALUES ($1, $2, NOW(), $3, $4, $5) RETURNING id`,
            [email, password_hash, setupDate, taxSystem || null, acq || null]
        );
        const user_id = insertRes.rows[0].id;

        // Запускаем фонового воркера (async, не ждём ответа)
        require('../worker/vendista_import_worker').startImport({
            user_id,
            vendistaLogin,
            vendistaPass,
            first_coffee_date: setupDate
        });

        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: 'Ошибка регистрации: ' + e.message });
    }
});

module.exports = router;
