// backend/middleware/auth.js
const path = require('path'); // Добавь это
require('dotenv').config({ path: path.resolve(__dirname, '../.env') }); // И это, если JWT_SECRET в .env

const jwt = require('jsonwebtoken');

// Middleware для проверки JWT-токена в Authorization header
function auth(req, res, next) {
    const header = req.headers['authorization'];
    if (!header) {
        return res.status(401).json({ success: false, error: 'Требуется авторизация (нет заголовка)' });
    }

    const parts = header.split(' ');
    if (parts.length !== 2 || parts[0] !== 'Bearer') {
        return res.status(401).json({ success: false, error: 'Некорректный формат токена (ожидается Bearer)' });
    }

    const token = parts[1];
    if (!token) {
        return res.status(401).json({ success: false, error: 'Пустой токен' });
    }

    try {
        // Убедись, что JWT_SECRET доступен
        if (!process.env.JWT_SECRET) {
            console.error('[Middleware Auth] FATAL: JWT_SECRET is not defined!');
            return res.status(500).json({ success: false, error: 'Ошибка конфигурации сервера (JWT)' });
        }
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded; // теперь userId доступен как req.user.userId (и telegramId)
        next();
    } catch (err) {
        console.error('[Middleware Auth] JWT Verification Error:', err.message);
        return res.status(401).json({ success: false, error: 'Невалидный или истёкший токен' });
    }
}

module.exports = auth;