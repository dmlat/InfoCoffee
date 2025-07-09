// backend/routes/tasks.js
const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const pool = require('../db');
const { sendErrorToAdmin } = require('../utils/adminErrorNotifier');
const { sendNotification } = require('../utils/botNotifier');
const moment = require('moment-timezone'); // Added for date handling

// Получить все терминалы и их текущие настройки обслуживания
router.get('/settings', authMiddleware, async (req, res) => {
    const ownerUserId = req.user.ownerUserId;
    try {
        const query = `
            SELECT
                t.id,
                t.name,
                s.cleaning_frequency,
                s.restock_thresholds,
                s.assignee_ids
            FROM terminals t
            LEFT JOIN stand_service_settings s ON t.id = s.terminal_id
            WHERE t.user_id = $1
            ORDER BY t.name ASC
        `;
        const result = await pool.query(query, [ownerUserId]);
        res.json({ success: true, settings: result.rows });

    } catch (err) {
        console.error(`[GET /api/tasks/settings] UserID: ${ownerUserId} - Error:`, err);
        sendErrorToAdmin({
            userId: ownerUserId,
            errorContext: 'GET /api/tasks/settings',
            errorMessage: err.message,
            errorStack: err.stack,
        }).catch(console.error);
        res.status(500).json({ success: false, error: 'Ошибка сервера при получении настроек обслуживания.' });
    }
});

// Сохранить или обновить настройки для одного терминала
router.post('/settings', authMiddleware, async (req, res) => {
    const ownerUserId = req.user.ownerUserId;
    const {
        terminal_id,
        cleaning_frequency,
        restock_thresholds,
        assignee_ids
    } = req.body;

    if (!terminal_id) {
        return res.status(400).json({ success: false, error: 'Не указан ID терминала.' });
    }

    try {
        // Проверка, что терминал принадлежит этому пользователю
        const ownerCheck = await pool.query(
            'SELECT id FROM terminals WHERE id = $1 AND user_id = $2',
            [terminal_id, ownerUserId]
        );
        if (ownerCheck.rowCount === 0) {
            return res.status(403).json({ success: false, error: 'Доступ к терминалу запрещен.' });
        }

        const query = `
            INSERT INTO stand_service_settings (terminal_id, cleaning_frequency, restock_thresholds, assignee_ids)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (terminal_id) DO UPDATE SET
                cleaning_frequency = EXCLUDED.cleaning_frequency,
                restock_thresholds = EXCLUDED.restock_thresholds,
                assignee_ids = EXCLUDED.assignee_ids,
                updated_at = NOW()
            RETURNING *;
        `;

        const values = [
            terminal_id,
            cleaning_frequency || null,
            restock_thresholds || {},
            assignee_ids || []
        ];

        const result = await pool.query(query, values);
        res.status(201).json({ success: true, settings: result.rows[0] });

    } catch (err) {
        console.error(`[POST /api/tasks/settings] UserID: ${ownerUserId} - Error:`, err);
        sendErrorToAdmin({
            userId: ownerUserId,
            errorContext: 'POST /api/tasks/settings',
            errorMessage: err.message,
            errorStack: err.stack,
            additionalInfo: { body: req.body }
        }).catch(console.error);
        res.status(500).json({ success: false, error: 'Ошибка сервера при сохранении настроек.' });
    }
});


// Получить журнал задач
router.get('/', authMiddleware, async (req, res) => {
    const ownerUserId = req.user.ownerUserId;
    const moscowTime = moment().tz('Europe/Moscow');
    // Получаем задачи, которые либо в работе, либо были выполнены сегодня
    const todayStart = moscowTime.startOf('day').toISOString();

    try {
        const query = `
            SELECT
                t.id,
                term.name as terminal_name,
                t.task_type,
                t.status,
                t.details,
                t.created_at,
                t.completed_at,
                (
                    SELECT array_agg(COALESCE(rights.shared_with_name, u.first_name, u.user_name, ids.id::text))
                    FROM unnest(t.assignee_ids) AS ids(id)
                    LEFT JOIN user_access_rights rights ON rights.shared_with_telegram_id = ids.id AND rights.owner_user_id = term.user_id
                    LEFT JOIN users u ON u.telegram_id = ids.id
                ) as assignees
            FROM service_tasks t
            JOIN terminals term ON t.terminal_id = term.id
            WHERE term.user_id = $1
              AND (t.status = 'pending' OR t.completed_at >= $2)
            ORDER BY t.created_at DESC
        `;
        const result = await pool.query(query, [ownerUserId, todayStart]);
        res.json({ success: true, tasks: result.rows });
    } catch (err) {
        console.error(`[GET /api/tasks] UserID: ${ownerUserId} - Error:`, err);
        sendErrorToAdmin({
            userId: ownerUserId,
            errorContext: 'GET /api/tasks',
            errorMessage: err.message,
            errorStack: err.stack,
        }).catch(console.error);
        res.status(500).json({ success: false, error: 'Ошибка сервера при получении журнала задач.' });
    }
});

// Удалить задачу
router.delete('/:taskId', authMiddleware, async (req, res) => {
    const ownerUserId = req.user.ownerUserId;
    const { taskId } = req.params;

    if (req.user.accessLevel !== 'owner' && req.user.accessLevel !== 'admin') {
        return res.status(403).json({ success: false, error: 'Недостаточно прав для удаления задачи.' });
    }
    
    try {
        const checkOwnerQuery = `
            SELECT t.id FROM service_tasks t
            JOIN terminals term ON t.terminal_id = term.id
            WHERE t.id = $1 AND term.user_id = $2
        `;
        const ownerCheck = await pool.query(checkOwnerQuery, [taskId, ownerUserId]);

        if (ownerCheck.rowCount === 0) {
            return res.status(404).json({ success: false, error: 'Задача не найдена или у вас нет прав на ее удаление.' });
        }

        const deleteRes = await pool.query(
            'DELETE FROM service_tasks WHERE id = $1 RETURNING id',
            [taskId]
        );

        res.json({ success: true, message: 'Задача успешно удалена.', deletedId: taskId });
    } catch (err) {
        console.error(`[DELETE /api/tasks/:id] UserID: ${ownerUserId} - Error:`, err);
        sendErrorToAdmin({
            userId: ownerUserId,
            errorContext: `DELETE /api/tasks/${taskId}`,
            errorMessage: err.message,
            errorStack: err.stack,
        }).catch(console.error);
        res.status(500).json({ success: false, error: 'Ошибка сервера при удалении задачи.' });
    }
});

module.exports = router; 