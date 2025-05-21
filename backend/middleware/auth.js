const jwt = require('jsonwebtoken');

// Middleware для проверки JWT-токена в Authorization header
function auth(req, res, next) {
    const header = req.headers['authorization'];
    if (!header) {
        return res.status(401).json({ success: false, error: 'Требуется авторизация (нет заголовка)' });
    }

    // Ждём формат: "Bearer <token>"
    const parts = header.split(' ');
    if (parts.length !== 2 || parts[0] !== 'Bearer') {
        return res.status(401).json({ success: false, error: 'Некорректный формат токена (ожидается Bearer)' });
    }

    const token = parts[1];
    if (!token) {
        return res.status(401).json({ success: false, error: 'Пустой токен' });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded; // теперь userId доступен как req.user.userId
        next();
    } catch (err) {
        return res.status(401).json({ success: false, error: 'Невалидный или истёкший токен' });
    }
}

module.exports = auth;
