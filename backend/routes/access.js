// backend/routes/access.js
const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const pool = require('../db');
const { sendErrorToAdmin } = require('../utils/adminErrorNotifier');

// Получить список всех, кому предоставлен доступ
router.get('/', authMiddleware, async (req, res) => {
    const ownerUserId = req.user.userId;
    // Убедимся, что у пользователя есть права админа или он владелец
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
    const ownerUserId = req.user.userId;
    const { shared_with_telegram_id, shared_with_name, access_level } = req.body;

    if (req.user.accessLevel !== 'owner' && req.user.accessLevel !== 'admin') {
        return res.status(403).json({ success: false, error: 'Недостаточно прав для предоставления доступа' });
    }

    if (!shared_with_telegram_id || !shared_with_name || !access_level) {
        return res.status(400).json({ success: false, error: 'Не все поля заполнены (telegram_id, name, access_level)' });
    }
    
    // Проверка, не пытается ли пользователь добавить самого себя
    if (String(shared_with_telegram_id) === String(req.user.telegramId)) {
        return res.status(400).json({ success: false, error: 'Вы не можете предоставить доступ самому себе.' });
    }

    try {
        const result = await pool.query(
            `INSERT INTO user_access_rights (owner_user_id, shared_with_telegram_id, shared_with_name, access_level)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (owner_user_id, shared_with_telegram_id) DO UPDATE SET
                shared_with_name = EXCLUDED.shared_with_name,
                access_level = EXCLUDED.access_level
             RETURNING id, shared_with_telegram_id, shared_with_name, access_level`,
            [ownerUserId, shared_with_telegram_id, shared_with_name, access_level]
        );
        res.status(201).json({ success: true, access: result.rows[0] });
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
    const ownerUserId = req.user.userId;
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

        res.json({ success: true, message: 'Доступ успешно обновлен', access: result.rows[0] });
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
    const ownerUserId = req.user.userId;
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

module.exports = router;