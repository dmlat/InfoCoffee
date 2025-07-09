// backend/routes/access.js
const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const pool = require('../db');
const { sendErrorToAdmin } = require('../utils/adminErrorNotifier');
const { sendNotification } = require('../utils/botNotifier'); // <-- НОВЫЙ ИМПОРТ

const formatAccessLevelName = (level) => {
    if (level === 'admin') return 'Администратор';
    if (level === 'service') return 'Обслуживание точек';
    return level;
};

// Получить список всех, кому предоставлен доступ
router.get('/', authMiddleware, async (req, res) => {
    const ownerUserId = req.user.ownerUserId;
    if (req.user.accessLevel !== 'owner' && req.user.accessLevel !== 'admin') {
        return res.status(403).json({ success: false, error: 'Недостаточно прав для просмотра доступов' });
    }

    try {
        const result = await pool.query(
            'SELECT id, shared_with_telegram_id, shared_with_name, access_level FROM user_access_rights WHERE owner_user_id = $1 ORDER BY created_at DESC',
            [ownerUserId]
        );
        res.json({ success: true, accessList: result.rows });
    } catch (err) {
        console.error(`[GET /api/access] UserID: ${ownerUserId} - Error:`, err);
        sendErrorToAdmin({
            userId: ownerUserId,
            errorContext: `GET /api/access - UserID: ${ownerUserId}`,
            errorMessage: err.message,
            errorStack: err.stack
        }).catch(console.error);
        res.status(500).json({ success: false, error: 'Ошибка сервера при получении списка доступов' });
    }
});

// Предоставить доступ новому пользователю
router.post('/', authMiddleware, async (req, res) => {
    const ownerUserId = req.user.ownerUserId;
    const { shared_with_telegram_id, shared_with_name, access_level } = req.body;

    if (req.user.accessLevel !== 'owner' && req.user.accessLevel !== 'admin') {
        return res.status(403).json({ success: false, error: 'Недостаточно прав для предоставления доступа' });
    }

    if (!shared_with_telegram_id || !shared_with_name || !access_level) {
        return res.status(400).json({ success: false, error: 'Не все поля заполнены (telegram_id, name, access_level)' });
    }
    
    if (String(shared_with_telegram_id) === String(req.user.telegramId)) {
        return res.status(400).json({ success: false, error: 'Вы не можете предоставить доступ самому себе.' });
    }

    try {
        const result = await pool.query(
            `INSERT INTO user_access_rights (owner_user_id, shared_with_telegram_id, shared_with_name, access_level)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (owner_user_id, shared_with_telegram_id) DO UPDATE SET
                shared_with_name = EXCLUDED.shared_with_name,
                access_level = EXCLUDED.access_level,
                created_at = NOW()
             RETURNING id, shared_with_telegram_id, shared_with_name, access_level`,
            [ownerUserId, shared_with_telegram_id, shared_with_name, access_level]
        );

        const newAccess = result.rows[0];
        res.status(201).json({ success: true, access: newAccess });

        // --- ОТПРАВКА УВЕДОМЛЕНИЯ ---
        const accessName = formatAccessLevelName(newAccess.access_level);
        const message = `Вам предоставили доступ к приложению InfoCoffee с уровнем "<b>${accessName}</b>".\n\nЗапустите бота, чтобы начать: /start`;
        sendNotification(newAccess.shared_with_telegram_id, message).catch(console.error);

    } catch (err) {
        console.error(`[POST /api/access] UserID: ${ownerUserId} - Error:`, err);
        sendErrorToAdmin({
            userId: ownerUserId,
            errorContext: `POST /api/access - UserID: ${ownerUserId}`,
            errorMessage: err.message,
            errorStack: err.stack,
            additionalInfo: { body: req.body }
        }).catch(console.error);
        res.status(500).json({ success: false, error: 'Ошибка сервера при добавлении доступа' });
    }
});

// Обновить доступ
router.put('/:accessId', authMiddleware, async (req, res) => {
    const ownerUserId = req.user.ownerUserId;
    const { accessId } = req.params;
    const { shared_with_name, access_level } = req.body;

    if (req.user.accessLevel !== 'owner' && req.user.accessLevel !== 'admin') {
        return res.status(403).json({ success: false, error: 'Недостаточно прав для изменения доступа' });
    }

    try {
        const result = await pool.query(
            `UPDATE user_access_rights
             SET shared_with_name = COALESCE($1, shared_with_name), access_level = COALESCE($2, access_level)
             WHERE id = $3 AND owner_user_id = $4
             RETURNING *`,
            [shared_with_name, access_level, accessId, ownerUserId]
        );

        if (result.rowCount === 0) {
            return res.status(404).json({ success: false, error: 'Запись о доступе не найдена или у вас нет прав на её изменение.' });
        }
        
        const updatedAccess = result.rows[0];
        res.json({ success: true, message: 'Доступ успешно обновлен', access: updatedAccess });

        // --- ОТПРАВКА УВЕДОМЛЕНИЯ ОБ ИЗМЕНЕНИИ ---
        if (access_level) { // Отправляем только если уровень доступа действительно менялся
            const accessName = formatAccessLevelName(updatedAccess.access_level);
            const message = `Ваш уровень доступа в InfoCoffee был изменен на "<b>${accessName}</b>".`;
            sendNotification(updatedAccess.shared_with_telegram_id, message).catch(console.error);
        }

    } catch (err) {
        console.error(`[PUT /api/access/:id] UserID: ${ownerUserId} - Error:`, err);
        sendErrorToAdmin({
            userId: ownerUserId,
            errorContext: `PUT /api/access/:${accessId} - UserID: ${ownerUserId}`,
            errorMessage: err.message,
            errorStack: err.stack,
            additionalInfo: { body: req.body }
        }).catch(console.error);
        res.status(500).json({ success: false, error: 'Ошибка сервера при обновлении доступа.' });
    }
});

// Отозвать доступ
router.delete('/:accessId', authMiddleware, async (req, res) => {
    const ownerUserId = req.user.ownerUserId;
    const { accessId } = req.params;

     if (req.user.accessLevel !== 'owner' && req.user.accessLevel !== 'admin') {
        return res.status(403).json({ success: false, error: 'Недостаточно прав для отзыва доступа' });
    }

    try {
        const deleteResult = await pool.query(
            'DELETE FROM user_access_rights WHERE id = $1 AND owner_user_id = $2 RETURNING id',
            [accessId, ownerUserId]
        );

        if (deleteResult.rowCount === 0) {
            return res.status(404).json({ success: false, error: 'Запись о доступе не найдена или у вас нет прав на её удаление.' });
        }

        res.json({ success: true, message: 'Доступ успешно отозван', deletedId: accessId });
    } catch (err) {
        console.error(`[DELETE /api/access/:id] UserID: ${ownerUserId} - Error:`, err);
        sendErrorToAdmin({
            userId: ownerUserId,
            errorContext: `DELETE /api/access/:${accessId} - UserID: ${ownerUserId}`,
            errorMessage: err.message,
            errorStack: err.stack
        }).catch(console.error);
        res.status(500).json({ success: false, error: 'Ошибка сервера при отзыве доступа.' });
    }
});

// Получить список всех пользователей, кому предоставлен доступ (включая владельца)
router.get('/users/list', authMiddleware, async (req, res) => {
    const ownerUserId = req.user.ownerUserId;

    try {
        // Получаем владельца
        const ownerRes = await pool.query('SELECT id, telegram_id, name FROM users WHERE id = $1', [ownerUserId]);
        const owner = ownerRes.rows[0] 
            ? { 
                id: ownerRes.rows[0].id, 
                telegram_id: ownerRes.rows[0].telegram_id, 
                name: `${ownerRes.rows[0].name} (Владелец)` 
              } 
            : null;

        // Получаем тех, кому дали доступ
        const sharedUsersRes = await pool.query(
            'SELECT id, shared_with_telegram_id as telegram_id, shared_with_name as name FROM user_access_rights WHERE owner_user_id = $1',
            [ownerUserId]
        );

        let allUsers = [];
        if (owner) {
            allUsers.push(owner);
        }
        
        // Добавляем остальных, избегая дубликатов по telegram_id
        const existingTelegramIds = new Set(allUsers.map(u => u.telegram_id));
        sharedUsersRes.rows.forEach(user => {
            if (!existingTelegramIds.has(user.telegram_id)) {
                allUsers.push(user);
                existingTelegramIds.add(user.telegram_id);
            }
        });
        
        res.json({ success: true, users: allUsers });

    } catch (err) {
        console.error(`[GET /api/access/users/list] UserID: ${ownerUserId} - Error:`, err);
        sendErrorToAdmin({
            userId: ownerUserId,
            errorContext: `GET /api/access/users/list`,
            errorMessage: err.message,
            errorStack: err.stack
        }).catch(console.error);
        res.status(500).json({ success: false, error: 'Ошибка сервера при получении списка пользователей.' });
    }
});


module.exports = router;