// backend/routes/tasks.js
const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const db = require('../db');
const { sendErrorToAdmin } = require('../utils/adminErrorNotifier');
const { sendNotificationWithKeyboard } = require('../utils/botHelpers');
const moment = require('moment-timezone'); // Added for date handling

const WEB_APP_URL = process.env.TELEGRAM_WEB_APP_URL || '';

// Получить все терминалы и их текущие настройки обслуживания
router.get('/settings', authMiddleware, async (req, res) => {
    const { ownerUserId, telegramId } = req.user;
    console.log(`[GET /api/tasks/settings] ActorTG: ${telegramId}, OwnerID: ${ownerUserId} - Fetching all service settings.`);
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
        const result = await db.query(query, [ownerUserId]);
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
    const { ownerUserId, telegramId } = req.user;
    const {
        terminal_id,
        cleaning_frequency,
        restock_thresholds,
        assignee_ids
    } = req.body;

    console.log(`[POST /api/tasks/settings] ActorTG: ${telegramId}, OwnerID: ${ownerUserId} - Saving settings for TerminalID: ${terminal_id}.`);

    if (!terminal_id) {
        return res.status(400).json({ success: false, error: 'Не указан ID терминала.' });
    }

    try {
        // Проверка, что терминал принадлежит этому пользователю
        const ownerCheck = await db.query(
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

        const result = await db.query(query, values);
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

// Создать задачу вручную
router.post('/create-manual', authMiddleware, async (req, res) => {
    const { ownerUserId, telegramId } = req.user;
    const { terminal_id, task_type, assignee_ids, comment } = req.body;
    console.log(`[POST /api/tasks/create-manual] ActorTG: ${telegramId}, OwnerID: ${ownerUserId} - Creating manual task for TerminalID: ${terminal_id}.`);

    if (!terminal_id || !task_type || !assignee_ids || assignee_ids.length === 0) {
        return res.status(400).json({ success: false, error: 'Не все поля для создания задачи заполнены.' });
    }

    try {
        // 1. Проверка, что терминал принадлежит пользователю
        const termRes = await db.query(
            'SELECT name FROM terminals WHERE id = $1 AND user_id = $2',
            [terminal_id, ownerUserId]
        );
        if (termRes.rowCount === 0) {
            return res.status(403).json({ success: false, error: 'Доступ к терминалу запрещен.' });
        }
        const terminalName = termRes.rows[0].name;

        // 2. Создание задачи
        const details = {
            comment: comment || null,
            created_by: telegramId
        };
        const insertRes = await db.query(
            `INSERT INTO service_tasks (terminal_id, task_type, status, details, assignee_ids)
             VALUES ($1, $2, 'pending', $3, $4) RETURNING id`,
            [terminal_id, task_type, JSON.stringify(details), assignee_ids]
        );
        const newTaskId = insertRes.rows[0].id;

        // 3. Отправка уведомления
        const taskTypeName = task_type === 'restock' ? 'Пополнение' : 'Уборка';
        let message = `<b>Новая задача: ${taskTypeName}</b>\n\nСтойка: <b>${terminalName}</b>`;
        if (comment) {
            message += `\n\nКомментарий: <i>${comment}</i>`;
        }

        const keyboard = {
            inline_keyboard: [[{ text: '🗃 Открыть задачу', url: `${WEB_APP_URL}/servicetask?taskId=${newTaskId}` }]]
        };
        
        for (const assigneeId of assignee_ids) {
            sendNotificationWithKeyboard(assigneeId, message, keyboard).catch(console.error);
        }

        res.status(201).json({ success: true, message: 'Задача успешно создана.' });

    } catch (err) {
        console.error(`[POST /api/tasks/create-manual] UserID: ${ownerUserId} - Error:`, err);
        sendErrorToAdmin({
            userId: ownerUserId,
            errorContext: 'POST /api/tasks/create-manual',
            errorMessage: err.message,
            errorStack: err.stack,
            additionalInfo: { body: req.body }
        }).catch(console.error);
        res.status(500).json({ success: false, error: 'Ошибка сервера при создании задачи.' });
    }
});


// Получить журнал задач
router.get('/', authMiddleware, async (req, res) => {
    const { ownerUserId, telegramId } = req.user;
    // Оставляем возможность фильтрации, но по умолчанию берем задачи за последние 30 дней
    const dateFrom = req.query.dateFrom || moment().subtract(30, 'days').toISOString();
    console.log(`[GET /api/tasks] ActorTG: ${telegramId}, OwnerID: ${ownerUserId} - Fetching task journal from ${dateFrom}.`);

    try {
        const query = `
            SELECT
                t.id,
                t.terminal_id,
                term.name as terminal_name,
                t.task_type,
                t.status,
                t.created_at,
                t.completed_at,
                t.details,
                (
                    SELECT array_agg(name)
                    FROM (
                        SELECT u.first_name AS name FROM users u WHERE u.id = term.user_id AND u.telegram_id = ANY(t.assignee_ids)
                        UNION
                        SELECT uar.shared_with_name AS name FROM user_access_rights uar WHERE uar.owner_user_id = term.user_id AND uar.shared_with_telegram_id = ANY(t.assignee_ids)
                    ) AS names
                ) as assignees
            FROM service_tasks t
            JOIN terminals term ON t.terminal_id = term.id
            WHERE term.user_id = $1
              AND (t.status = 'pending' OR t.completed_at >= $2)
            ORDER BY t.created_at DESC
        `;
        const result = await db.query(query, [ownerUserId, dateFrom]);
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

// Получить задачи, назначенные на ТЕКУЩЕГО пользователя
router.get('/my', authMiddleware, async (req, res) => {
    const { telegramId, ownerUserId } = req.user;
    console.log(`[GET /api/tasks/my] ActorTG: ${telegramId}, OwnerID: ${ownerUserId} - Fetching assigned tasks for self.`);
    try {
        const query = `
            SELECT
                t.id,
                t.terminal_id,
                term.name as terminal_name,
                t.task_type,
                t.status,
                t.created_at,
                t.details
            FROM service_tasks t
            JOIN terminals term ON t.terminal_id = term.id
            WHERE t.status = 'pending' AND $1::bigint = ANY(t.assignee_ids)
            ORDER BY t.created_at DESC
        `;
        const result = await db.query(query, [telegramId]);
        res.json({ success: true, tasks: result.rows });
    } catch (err) {
        console.error(`[GET /api/tasks/my] UserID: ${req.user.userId} - Error:`, err);
        sendErrorToAdmin({
            userId: req.user.userId,
            errorContext: 'GET /api/tasks/my',
            errorMessage: err.message,
            errorStack: err.stack,
        }).catch(console.error);
        res.status(500).json({ success: false, error: 'Ошибка сервера при получении назначенных задач.' });
    }
});


// Получить информацию для блока "Пополнение"
router.get('/restock-info', authMiddleware, async (req, res) => {
    const { ownerUserId, telegramId } = req.user;
    console.log(`[GET /api/tasks/restock-info] ActorTG: ${telegramId}, OwnerID: ${ownerUserId} - Fetching restock info.`);
    try {
        const query = `
            SELECT
                t.id,
                t.name,
                COALESCE(
                    (SELECT json_agg(
                        json_build_object(
                            'name', i.item_name,
                            'percentage', ROUND(i.current_stock / NULLIF(i.max_stock, 0) * 100),
                            'critical', (i.current_stock <= i.critical_stock)
                        ) ORDER BY i.item_name
                    )
                    FROM inventories i
                    WHERE i.terminal_id = t.id AND i.location = 'machine' AND i.max_stock > 0),
                    '[]'::json
                ) as ingredients
            FROM terminals t
            WHERE t.user_id = $1 AND t.is_active = true
            ORDER BY t.name ASC
        `;
        const result = await db.query(query, [ownerUserId]);
        res.json({ success: true, restockInfo: result.rows });
    } catch (err) {
        console.error(`[GET /api/tasks/restock-info] UserID: ${ownerUserId} - Error:`, err);
        sendErrorToAdmin({
            userId: ownerUserId,
            errorContext: 'GET /api/tasks/restock-info',
            errorMessage: err.message,
            errorStack: err.stack,
        }).catch(console.error);
        res.status(500).json({ success: false, error: 'Ошибка сервера при получении данных для пополнения.' });
    }
});

// Отметить задачу как выполненную
router.post('/:taskId/complete', authMiddleware, async (req, res) => {
    const { telegramId, ownerUserId } = req.user;
    const { taskId } = req.params;
    console.log(`[POST /api/tasks/complete] ActorTG: ${telegramId}, OwnerID: ${ownerUserId} - Completing task ID: ${taskId}.`);

    try {
        const taskRes = await db.query(
            `UPDATE service_tasks
             SET status = 'completed', completed_at = NOW()
             WHERE id = $1 AND ($2::bigint = ANY(assignee_ids) OR EXISTS (SELECT 1 FROM terminals WHERE id = terminal_id AND user_id = $3)) AND status = 'pending'
             RETURNING id, task_type, terminal_id`,
            [taskId, telegramId, ownerUserId]
        );

        if (taskRes.rowCount === 0) {
            return res.status(403).json({ success: false, error: 'Задача не найдена, уже выполнена, или у вас нет прав на её выполнение.' });
        }
        
        // Если была выполнена задача на чистку, сбрасываем счетчик в терминале
        const completedTask = taskRes.rows[0];
        if (completedTask.task_type === 'cleaning') {
            await db.query(
                'UPDATE terminals SET sales_since_cleaning = 0 WHERE id = $1',
                [completedTask.terminal_id]
            );
             console.log(`[POST /:taskId/complete] Sales counter reset for terminal #${completedTask.terminal_id}`);
        }

        res.json({ success: true, message: 'Задача выполнена' });
    } catch (err) {
        console.error(`[POST /api/tasks/:id/complete] UserID: ${req.user.userId} - Error:`, err);
        sendErrorToAdmin({
            userId: req.user.userId,
            errorContext: `POST /api/tasks/${taskId}/complete`,
            errorMessage: err.message,
            errorStack: err.stack,
        }).catch(console.error);
        res.status(500).json({ success: false, error: 'Ошибка сервера при выполнении задачи.' });
    }
});


// Удалить задачу
router.delete('/:taskId', authMiddleware, async (req, res) => {
    const { ownerUserId, telegramId } = req.user;
    const { taskId } = req.params;
    console.log(`[DELETE /api/tasks] ActorTG: ${telegramId}, OwnerID: ${ownerUserId} - Deleting task ID: ${taskId}.`);

    if (req.user.accessLevel !== 'owner' && req.user.accessLevel !== 'admin') {
        return res.status(403).json({ success: false, error: 'Недостаточно прав для удаления задачи.' });
    }
    
    try {
        const checkOwnerQuery = `
            SELECT t.id FROM service_tasks t
            JOIN terminals term ON t.terminal_id = term.id
            WHERE t.id = $1 AND term.user_id = $2
        `;
        const ownerCheck = await db.query(checkOwnerQuery, [taskId, ownerUserId]);

        if (ownerCheck.rowCount === 0) {
            return res.status(404).json({ success: false, error: 'Задача не найдена или у вас нет прав на ее удаление.' });
        }

        const deleteRes = await db.query(
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