// backend/middleware/auth.js
const path = require('path');
// require('dotenv').config(...); <-- ЭТА ЛОГИКА УДАЛЕНА, Т.К. ЦЕНТРАЛИЗОВАНА В DB.JS
const jwt = require('jsonwebtoken');
const pool = require('../db'); // <-- НОВЫЙ ИМПОРТ

// Middleware для проверки JWT-токена в Authorization header
async function auth(req, res, next) { // <-- ИЗМЕНЕНИЕ: функция стала асинхронной
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
        if (!process.env.JWT_SECRET) {
            console.error('[Middleware Auth] FATAL: JWT_SECRET is not defined!');
            return res.status(500).json({ success: false, error: 'Ошибка конфигурации сервера (JWT)' });
        }
        
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded; 

        // Если accessLevel не установлен (например, для владельца), по умолчанию ставим 'owner'
        if (!req.user.accessLevel) {
            req.user.accessLevel = 'owner';
        }

        // --- DEV MODE ROLE EMULATION ---
        if (process.env.NODE_ENV === 'development') {
            const emulatedRole = req.headers['x-emulated-role'];
            if (emulatedRole && ['owner', 'admin', 'service'].includes(emulatedRole)) {
                req.user.accessLevel = emulatedRole;
                
                // Для ролей 'admin' и 'service' подменяем telegramId на тестовые значения,
                // чтобы бэкенд мог корректно найти назначенные им задачи.
                // Эти ID должны совпадать с теми, на которые назначаются задачи в dev-среде.
                if (emulatedRole === 'admin') {
                    req.user.telegramId = parseInt(process.env.DEV_ADMIN_TELEGRAM_ID, 10); // Тестовый ID для админа
                } else if (emulatedRole === 'service') {
                    req.user.telegramId = parseInt(process.env.DEV_SERVICE_TELEGRAM_ID, 10); // Тестовый ID для сервисника
                }
                // Для 'owner' оставляем его реальный telegramId из токена.
            }
        }
        // --- END DEV MODE ROLE EMULATION ---

        // --- НОВАЯ ЛОГИКА ОПРЕДЕЛЕНИЯ ID ВЛАДЕЛЬЦA ---
        if (req.user.accessLevel === 'owner') {
            // Если это владелец, его ID и есть ID владельца
            req.user.ownerUserId = req.user.userId;
        } else {
            // Для админа или сервисника ищем ID владельца в таблице доступов
            const accessRightRes = await pool.query(
                'SELECT owner_user_id FROM user_access_rights WHERE shared_with_telegram_id = $1::bigint',
                [req.user.telegramId]
            );

            if (accessRightRes.rowCount === 0) {
                console.warn(`[Auth Middleware] User with access level "${req.user.accessLevel}" and telegramId ${req.user.telegramId} not found in access rights table.`);
                return res.status(403).json({ success: false, error: 'Доступ не найден. Обратитесь к владельцу.' });
            }
            req.user.ownerUserId = accessRightRes.rows[0].owner_user_id;
        }
        
        next();

    } catch (err) {
        console.error('[Middleware Auth] JWT Verification Error or DB Error:', err.message);
        return res.status(401).json({ success: false, error: 'Невалидный или истёкший токен, или ошибка доступа.' });
    }
}

module.exports = auth;