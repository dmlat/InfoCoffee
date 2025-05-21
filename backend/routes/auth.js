const express = require('express');
const jwt = require('jsonwebtoken');
// const bcrypt = require('bcryptjs'); // Для хэша — если будет нужно
const pool = require('../db');
const axios = require('axios');
const router = express.Router();
const { startImport } = require('../worker/vendista_import_worker');

// --- Регистрация пользователя ---
router.post('/register', async (req, res) => {
    try {
        const { vendista_login, vendista_password, date_install, tax_system, acquiring } = req.body;
        if (!vendista_login || !vendista_password || !date_install)
            return res.status(400).json({ success: false, error: 'Все поля обязательны!' });

        // Проверяем уникальность
        const exist = await pool.query('SELECT * FROM users WHERE vendista_login = $1', [vendista_login]);
        if (exist.rows.length > 0)
            return res.status(400).json({ success: false, error: 'Пользователь уже зарегистрирован!' });

        // Проверка логина через Vendista (API)
        const tokenResp = await axios.get(`https://api.vendista.ru:99/token`, {
            params: { login: vendista_login, password: vendista_password }
        });
        if (!tokenResp.data.token)
            return res.status(400).json({ success: false, error: 'Vendista логин/пароль невалидны!' });

        // Вставляем пользователя (пароль записываем во временное поле vendista_password_hash)
        await pool.query(
            `INSERT INTO users (vendista_login, vendista_password_hash, setup_date, tax_system, acquiring) VALUES ($1,$2,$3,$4,$5)`,
            [vendista_login, vendista_password, date_install, tax_system, acquiring]
        );
        const userRes = await pool.query('SELECT id FROM users WHERE vendista_login=$1', [vendista_login]);
        const userId = userRes.rows[0].id;

        // Фоновый импорт транзакций
        startImport({
            user_id: userId,
            vendistaLogin: vendista_login,
            vendistaPass: vendista_password,
            first_coffee_date: date_install
        });

        // Выдаём JWT для дальнейших запросов
        const token = jwt.sign({ userId, vendista_login }, process.env.JWT_SECRET, { expiresIn: '12h' });

        res.json({ success: true, token, user: { userId, vendista_login } });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, error: 'Ошибка регистрации: ' + err.message });
    }
});

// --- Логин пользователя ---
router.post('/login', async (req, res) => {
    try {
        const { vendista_login, vendista_password } = req.body;
        if (!vendista_login || !vendista_password)
            return res.status(400).json({ success: false, error: 'Требуется Vendista логин и пароль' });

        const userRes = await pool.query('SELECT id, vendista_password_hash FROM users WHERE vendista_login=$1', [vendista_login]);
        if (userRes.rows.length === 0)
            return res.status(400).json({ success: false, error: 'Пользователь не найден!' });

        // Проверка пароля (plain для MVP)
        const user = userRes.rows[0];
        if (vendista_password !== user.vendista_password_hash)
            return res.status(400).json({ success: false, error: 'Неверный пароль!' });

        // Выдаём JWT
        const token = jwt.sign({ userId: user.id, vendista_login }, process.env.JWT_SECRET, { expiresIn: '12h' });

        res.json({ success: true, token, user: { userId: user.id, vendista_login } });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, error: 'Ошибка входа: ' + err.message });
    }
});

module.exports = router;
