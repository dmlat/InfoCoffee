// backend/routes/tasks.js
const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const db = require('../db');
const { sendErrorToAdmin } = require('../utils/adminErrorNotifier');
const { sendNotificationWithKeyboard, getAdminsAndOwner } = require('../utils/botHelpers');
const { sendNotification } = require('../utils/botNotifier');
const { logInventoryChange } = require('../utils/inventoryLogger');
const moment = require('moment-timezone');

const WEB_APP_URL = process.env.TELEGRAM_WEB_APP_URL || '';

// REFACTORED: Получить все терминалы и их текущие настройки обслуживания
router.get('/settings', authMiddleware, async (req, res) => {
    const { ownerUserId, telegramId } = req.user;
    try {
        const query = `
            SELECT
                t.id,
                t.name,
                t.sales_since_cleaning,
                s.assignee_id_restock,
                -- Проверка конфигурации контейнеров: есть ли хоть один айтем без заданного max_stock > 0
                COALESCE(config_check.needs_containers_config, true) AS needs_containers_config
            FROM terminals t
            LEFT JOIN stand_service_settings s ON t.id = s.terminal_id
            LEFT JOIN (
                SELECT
                    terminal_id,
                    COUNT(item_name) FILTER (WHERE location = 'machine' AND (max_stock IS NULL OR max_stock <= 0)) > 0 AS needs_containers_config
                FROM inventories
                WHERE user_id = $1
                GROUP BY terminal_id
            ) AS config_check ON t.id = config_check.terminal_id
            WHERE t.user_id = $1
            ORDER BY t.name ASC
        `;
        const result = await db.query(query, [ownerUserId]);
        res.json({ success: true, settings: result.rows });

    } catch (err) {
        console.error(`[GET /api/tasks/settings] UserID: ${ownerUserId} - Error:`, err);
        sendErrorToAdmin({ userId: ownerUserId, errorContext: 'GET /api/tasks/settings', errorMessage: err.message, errorStack: err.stack }).catch(console.error);
        res.status(500).json({ success: false, error: 'Ошибка сервера при получении настроек обслуживания.' });
    }
});

// REFACTORED: Сохранить или обновить настройки для одного терминала
router.post('/settings', authMiddleware, async (req, res) => {
    const { ownerUserId, telegramId } = req.user;
    const {
        terminal_id,
        assignee_id_restock
    } = req.body;

    if (!terminal_id) {
        return res.status(400).json({ success: false, error: 'Не указан ID терминала.' });
    }

    try {
        const ownerCheck = await db.query('SELECT id FROM terminals WHERE id = $1 AND user_id = $2', [terminal_id, ownerUserId]);
        if (ownerCheck.rowCount === 0) {
            return res.status(403).json({ success: false, error: 'Доступ к терминалу запрещен.' });
        }

        const query = `
            INSERT INTO stand_service_settings (terminal_id, assignee_id_restock)
            VALUES ($1, $2)
            ON CONFLICT (terminal_id) DO UPDATE SET
                assignee_id_restock = EXCLUDED.assignee_id_restock,
                updated_at = NOW()
            RETURNING *;
        `;

        const values = [
            terminal_id,
            assignee_id_restock || null
        ];

        const result = await db.query(query, values);
        res.status(201).json({ success: true, settings: result.rows[0] });

    } catch (err) {
        console.error(`[POST /api/tasks/settings] UserID: ${ownerUserId} - Error:`, err);
        sendErrorToAdmin({ userId: ownerUserId, errorContext: 'POST /api/tasks/settings', errorMessage: err.message, errorStack: err.stack, additionalInfo: { body: req.body } }).catch(console.error);
        res.status(500).json({ success: false, error: 'Ошибка сервера при сохранении настроек.' });
    }
});

// REFACTORED: Создать задачу вручную для нескольких терминалов и исполнителей
router.post('/create-manual', authMiddleware, async (req, res) => {
    const { ownerUserId, telegramId, accessLevel, sharedName } = req.user;
    const { tasks } = req.body; // tasks is an array of { terminalId, taskType, assigneeId, comment }

    if (accessLevel !== 'owner' && accessLevel !== 'admin') {
        return res.status(403).send('Forbidden: You do not have permission to create tasks.');
    }

    const client = await db.pool.connect();
    try {
        await client.query('BEGIN');

        let createdTasksCount = 0;
        const createdTasksInfo = []; 

        for (const task of tasks) {
            const { terminalId, taskType, assigneeId, comment } = task;

            if (!terminalId || !assigneeId) { // taskType is no longer needed from frontend
                // Пропускаем неполные задачи, но не прерываем весь процесс
                console.warn(`[POST /api/tasks/create-manual] Skipping incomplete task object for owner ${ownerUserId}. Task:`, task);
                continue;
            }

            const terminalCheck = await client.query('SELECT name FROM terminals WHERE id = $1 AND user_id = $2', [terminalId, ownerUserId]);
            if (terminalCheck.rowCount === 0) {
                console.warn(`[POST /api/tasks/create-manual] Attempt to create task for unowned terminal ${terminalId} by owner ${ownerUserId}.`);
                continue;
            }
            const terminalName = terminalCheck.rows[0].name;

            // --- ИЗМЕНЕНИЕ: Получаем имя и username исполнителя ---
            let assigneeName = assigneeId; // Fallback to ID
            let assigneeUsername = null;

            const assigneeDetails = await client.query(`
                SELECT name, user_name FROM (
                    SELECT shared_with_telegram_id::text AS id, shared_with_name AS name, NULL AS user_name
                    FROM user_access_rights
                    WHERE owner_user_id = $1 AND shared_with_telegram_id = $2
                    UNION
                    SELECT telegram_id::text AS id, COALESCE(first_name, user_name) AS name, user_name
                    FROM users
                    WHERE id = $1 AND telegram_id = $2
                ) AS u LIMIT 1;
            `, [ownerUserId, assigneeId]);

            if (assigneeDetails.rows.length > 0) {
                assigneeName = assigneeDetails.rows[0].name;
                assigneeUsername = assigneeDetails.rows[0].user_name;
            }
            // --- КОНЕЦ ИЗМЕНЕНИЯ ---

            // 3. Create the task
            const insertTaskQuery = `
                INSERT INTO service_tasks (terminal_id, task_type, status, assignee_id, comment, details)
                VALUES ($1, 'restock', 'pending', $2, $3, $4)
                RETURNING id, created_at;
            `;
            const taskRes = await client.query(insertTaskQuery, [terminalId, assigneeId, comment, { is_manual: true }]);
            const newTaskId = taskRes.rows[0].id;
            
            createdTasksInfo.push({ terminalName, assigneeId, assigneeName, assigneeUsername, taskType: 'restock', comment });
            
            // 4. Notify the specific assignee
            const taskTypeNameForMsg = 'Пополнение';
            let assigneeMessage = `🧹 Новая задача: <b>${taskTypeNameForMsg}</b>\n📍 Стойка: <b>${terminalName}</b>`;
            if (comment) {
                assigneeMessage += `\n\n💬 <i>${comment}</i>`;
            }
            const taskLink = `${WEB_APP_URL}`;
            const keyboard = { inline_keyboard: [[{ text: '🗃 Открыть задачи', web_app: { url: taskLink } }]] };
            sendNotificationWithKeyboard(assigneeId, assigneeMessage, keyboard).catch(err => console.error(`Failed to send notification to assignee ${assigneeId}`, err));
        }
        
        // 5. Send one summary notification to admins and owner if any tasks were created
        if (createdTasksInfo.length > 0) {
            const adminsAndOwner = await getAdminsAndOwner(ownerUserId);
            const creatorName = sharedName || 'Владелец'; // Если sharedName нет, значит это сам владелец

            let summaryMessage = `<b>${creatorName}</b> создал(а) ${createdTasksInfo.length} новых задач:\n\n`;
            createdTasksInfo.forEach(info => {
                const taskTypeName = 'Пополнение';
                // --- ИЗМЕНЕНИЕ: Используем имя и username ---
                let assigneeIdentifier;
                if (info.assigneeUsername) {
                    assigneeIdentifier = `@${info.assigneeUsername}`; // Кликабельный username
                } else {
                    assigneeIdentifier = `<b>${info.assigneeName}</b>`; // Или просто имя, если username нет
                }
                
                summaryMessage += ` • <b>${taskTypeName}</b> для <i>${info.terminalName}</i> ➜ ${assigneeIdentifier}`;
                // --- КОНЕЦ ИЗМЕНЕНИЯ ---
                if(info.comment) summaryMessage += ` (<i>${info.comment}</i>)`;
                summaryMessage += `\n`;
            });

            adminsAndOwner.forEach(user => {
                // Не отправляем создателю задачи, если он админ/владелец
                if (user.telegram_id && String(user.telegram_id) !== String(telegramId)) {
                    sendNotification(user.telegram_id, summaryMessage).catch(err => console.error(`Failed to send summary notification to admin ${user.telegram_id}`, err));
                }
            });
        }
        
        await client.query('COMMIT');
        res.status(201).json({ success: true, message: `${createdTasksInfo.length} задач успешно создано.` });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error(`[POST /api/tasks/create-manual] UserID: ${ownerUserId} - Error:`, error);
        sendErrorToAdmin({ userId: ownerUserId, errorContext: 'POST /api/tasks/create-manual', errorMessage: error.message, errorStack: error.stack, additionalInfo: { body: req.body } }).catch(console.error);
        res.status(500).send('Internal Server Error');
    } finally {
        client.release();
    }
});

// Получить информацию для блока "Пополнение" (без изменений)
router.get('/restock-info', authMiddleware, async (req, res) => {
    const { ownerUserId, telegramId } = req.user;
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
        sendErrorToAdmin({ userId: ownerUserId, errorContext: 'GET /api/tasks/restock-info', errorMessage: err.message, errorStack: err.stack, }).catch(console.error);
        res.status(500).json({ success: false, error: 'Ошибка сервера при получении данных для пополнения.' });
    }
});

// REFACTORED: Получить журнал задач
router.get('/', authMiddleware, async (req, res) => {
    const { ownerUserId, telegramId } = req.user;

    try {
        // Получаем начало текущего дня по московскому времени
        const moscowStartOfDay = moment().tz('Europe/Moscow').startOf('day').utc().format();
        
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
                t.comment,
                t.assignee_id,
                COALESCE(uar.shared_with_name, u.first_name, u.user_name) as assignee_name
            FROM service_tasks t
            JOIN terminals term ON t.terminal_id = term.id
            LEFT JOIN user_access_rights uar ON t.assignee_id = uar.shared_with_telegram_id AND term.user_id = uar.owner_user_id
            LEFT JOIN users u ON t.assignee_id = u.telegram_id AND term.user_id = u.id
            WHERE term.user_id = $1
              AND t.task_type = 'restock'
              AND (t.status = 'pending' OR t.completed_at >= $2)
            ORDER BY t.created_at DESC
        `;
        const result = await db.query(query, [ownerUserId, moscowStartOfDay]);
        res.json({ success: true, tasks: result.rows });
    } catch (err) {
        console.error(`[GET /api/tasks] UserID: ${ownerUserId} - Error:`, err);
        sendErrorToAdmin({ userId: ownerUserId, errorContext: 'GET /api/tasks', errorMessage: err.message, errorStack: err.stack }).catch(console.error);
        res.status(500).json({ success: false, error: 'Ошибка сервера при получении журнала задач.' });
    }
});

// REFACTORED: Получить задачи, назначенные на ТЕКУЩЕГО пользователя
router.get('/my', authMiddleware, async (req, res) => {
    const { telegramId, ownerUserId } = req.user;
    
    try {
        const query = `
            SELECT
                t.id,
                t.terminal_id,
                term.name as terminal_name,
                t.task_type,
                t.status,
                t.created_at,
                t.details,
                t.comment,
                (SELECT json_agg(
                    json_build_object(
                        'name', i.item_name,
                        'percentage', ROUND(i.current_stock / NULLIF(i.max_stock, 0) * 100),
                        'critical', (i.current_stock <= i.critical_stock)
                    ) ORDER BY i.item_name
                )
                FROM inventories i
                WHERE i.terminal_id = t.terminal_id AND i.location = 'machine' AND i.max_stock > 0
                ) as ingredients
            FROM service_tasks t
            JOIN terminals term ON t.terminal_id = term.id
            WHERE t.status = 'pending' AND t.assignee_id = $1 AND t.task_type = 'restock'
            ORDER BY t.created_at DESC
        `;
        const result = await db.query(query, [telegramId]);
        res.json({ success: true, tasks: result.rows });
    } catch (err) {
        console.error(`[GET /api/tasks/my] UserID: ${ownerUserId} - Error:`, err);
        sendErrorToAdmin({ userId: ownerUserId, errorContext: 'GET /api/tasks/my', errorMessage: err.message, errorStack: err.stack }).catch(console.error);
        res.status(500).json({ success: false, error: 'Ошибка сервера при получении назначенных задач.' });
    }
});

// Получить конкретную задачу по ID (добавлен comment и assignee_id)
router.get('/:taskId', authMiddleware, async (req, res) => {
    const { ownerUserId, telegramId } = req.user;
    const { taskId } = req.params;

    try {
        const query = `
            SELECT
                t.id,
                t.terminal_id,
                term.name as terminal_name,
                t.task_type,
                t.status,
                t.details,
                t.comment,
                t.assignee_id
            FROM service_tasks t
            JOIN terminals term ON t.terminal_id = term.id
            WHERE t.id = $1 AND term.user_id = $2
        `;
        const result = await db.query(query, [taskId, ownerUserId]);

        if (result.rowCount === 0) {
            return res.status(404).json({ success: false, error: 'Задача не найдена или у вас нет доступа.' });
        }

        res.json({ success: true, task: result.rows[0] });

    } catch (err) {
        console.error(`[GET /api/tasks/:taskId] UserID: ${ownerUserId} - Error:`, err);
        sendErrorToAdmin({ userId: ownerUserId, errorContext: `GET /api/tasks/${taskId}`, errorMessage: err.message }).catch(console.error);
        res.status(500).json({ success: false, error: 'Ошибка сервера при получении задачи.' });
    }
});

// REFACTORED: Завершить задачу
router.post('/:taskId/complete', authMiddleware, async (req, res) => {
    const { ownerUserId, telegramId, accessLevel } = req.user;
    const { taskId } = req.params;
    const { updatedStock } = req.body; // Для задач пополнения

    const client = await db.pool.connect();
    try {
        await client.query('BEGIN');

        const taskQuery = `
            SELECT t.id, t.task_type, t.status, t.terminal_id, t.assignee_id, term.user_id as owner_id, term.name as terminal_name
            FROM service_tasks t
            JOIN terminals term ON t.terminal_id = term.id
            WHERE t.id = $1
        `;
        const taskResult = await client.query(taskQuery, [taskId]);

        if (taskResult.rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, error: 'Задача не найдена.' });
        }
        const task = taskResult.rows[0];

        // --- ИЗМЕНЕНИЕ: Удаляем ненужный блок для 'cleaning' ---
        if (task.status === 'completed') {
            await client.query('ROLLBACK');
            return res.status(400).json({ success: false, error: 'Задача уже была выполнена.' });
        }

        // --- НОВАЯ ЛОГИКА ЗАВЕРШЕНИЯ ЗАДАЧИ ПОПОЛНЕНИЯ ---
        if (task.task_type === 'restock') {
            if (!updatedStock || !Array.isArray(updatedStock) || updatedStock.length === 0) {
                await client.query('ROLLBACK');
                return res.status(400).json({ success: false, error: 'Для задачи пополнения не предоставлены обновленные данные по остаткам.' });
            }

            // 1. Получаем состояние инвентаря ДО обновления
            const initialStockQuery = `SELECT item_name, current_stock, critical_stock FROM inventories WHERE terminal_id = $1 AND user_id = $2 AND location = 'machine' FOR UPDATE`;
            const initialStockRes = await client.query(initialStockQuery, [task.terminal_id, task.owner_id]);
            const initialStockMap = new Map(initialStockRes.rows.map(i => [i.item_name, { current: parseFloat(i.current_stock), critical: parseFloat(i.critical_stock) }]));

            // 2. Обновляем остатки в БД, логируем изменения и создаем карту обновленных данных
            let wasAnyChange = false;
            const updatedStockMap = new Map();
            
            for (const item of updatedStock) {
                const initialItemState = initialStockMap.get(item.item_name);
                const quantityBefore = initialItemState ? initialItemState.current : 0;
                const quantityAfter = parseFloat(item.current_stock);

                if (quantityAfter > quantityBefore) {
                    wasAnyChange = true;
                }

                // Сохраняем обновленные данные для проверки условий
                updatedStockMap.set(item.item_name, {
                    current: quantityAfter,
                    critical: initialItemState ? initialItemState.critical : 0
                });

                await client.query(
                    `UPDATE inventories SET current_stock = $1, updated_at = NOW() WHERE terminal_id = $2 AND item_name = $3 AND user_id = $4`,
                    [quantityAfter, task.terminal_id, item.item_name, task.owner_id]
                );

                await logInventoryChange({
                    owner_user_id: task.owner_id,
                    changed_by_telegram_id: telegramId,
                    change_source: 'restock_task',
                    terminal_id: task.terminal_id,
                    item_name: item.item_name,
                    quantity_before: quantityBefore,
                    quantity_after: quantityAfter
                }, client);
            }

            // 3. Проверяем условия закрытия задачи в зависимости от ее типа (авто/ручная)
            const isManualTask = task.details?.is_manual === true;
            
            if (isManualTask) {
                // Для ручных задач: достаточно любого пополнения
                if (!wasAnyChange) {
                    await client.query('ROLLBACK');
                    return res.status(400).json({ success: false, error: 'Невозможно завершить ручную задачу. Не было сделано ни одного пополнения.' });
                }
            } else { 
                // Для автоматических задач: проверяем что все изначально критические элементы теперь выше критического уровня
                const notReplenishedItems = [];
                
                for (const [itemName, initialState] of initialStockMap.entries()) {
                    // Проверяем только те элементы, что ИЗНАЧАЛЬНО были на критическом уровне
                    if (initialState.current <= initialState.critical) {
                        const updatedState = updatedStockMap.get(itemName);
                        if (updatedState && updatedState.current <= updatedState.critical) {
                            notReplenishedItems.push(itemName);
                        }
                    }
                }

                if (notReplenishedItems.length > 0) {
                    await client.query('ROLLBACK');
                    const errorMessage = `Невозможно завершить задачу. Остатки не пополнены выше критического уровня для: ${notReplenishedItems.join(', ')}.`;
                    return res.status(400).json({ success: false, error: errorMessage });
                }
            }
            // Сбрасываем счетчик продаж после успешного пополнения
            await client.query('UPDATE terminals SET sales_since_cleaning = 0 WHERE id = $1', [task.terminal_id]);
        }
        
        await client.query('UPDATE service_tasks SET status = \'completed\', completed_at = NOW() WHERE id = $1', [taskId]);

        const completerInfo = await client.query(`
            SELECT name FROM (
                SELECT telegram_id::text, first_name AS name FROM users WHERE telegram_id = $1
                UNION
                SELECT shared_with_telegram_id::text, shared_with_name AS name FROM user_access_rights WHERE shared_with_telegram_id = $1 AND owner_user_id = $2
            ) AS u LIMIT 1;
        `, [telegramId, task.owner_id]);

        const completerName = completerInfo.rows.length > 0 ? completerInfo.rows[0].name : (req.user.firstName || req.user.userName);
        const taskTypeName = 'Пополнение';
        const message = `✅ Задача выполнена: <b>${taskTypeName}</b>\n\n📍 Стойка: <b>${task.terminal_name}</b>\n👤 Исполнитель: <b>${completerName}</b>`;
        
        const ownerAndAdmins = await getAdminsAndOwner(task.owner_id);
        for (const user of ownerAndAdmins) {
            if (user.telegram_id && user.telegram_id != telegramId) {
                sendNotification(user.telegram_id, message).catch(console.error);
            }
        }

        await client.query('COMMIT');
        res.json({ success: true, message: 'Задача успешно выполнена.' });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error(`[POST /api/tasks/:taskId/complete] UserID: ${ownerUserId} - Error:`, error);
        sendErrorToAdmin({ userId: ownerUserId, errorContext: 'POST /api/tasks/:taskId/complete', errorMessage: error.message, errorStack: error.stack, additionalInfo: { params: req.params, body: req.body } }).catch(console.error);
        res.status(500).json({ success: false, error: 'Ошибка сервера при выполнении задачи.' });
    } finally {
        client.release();
    }
});

// REFACTORED: Удалить задачу
router.delete('/:taskId', authMiddleware, async (req, res) => {
    const { ownerUserId, telegramId, accessLevel } = req.user;
    const { taskId } = req.params;

    if (accessLevel !== 'owner' && accessLevel !== 'admin') {
        return res.status(403).json({ success: false, error: 'Недостаточно прав для удаления задачи.' });
    }
    
    const client = await db.pool.connect();
    try {
        await client.query('BEGIN');
        
        const checkOwnerQuery = `
            SELECT t.id, t.task_type, t.assignee_id, term.name as terminal_name
            FROM service_tasks t
            JOIN terminals term ON t.terminal_id = term.id
            WHERE t.id = $1 AND term.user_id = $2
        `;
        const ownerCheck = await client.query(checkOwnerQuery, [taskId, ownerUserId]);

        if (ownerCheck.rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, error: 'Задача не найдена или у вас нет прав на ее удаление.' });
        }
        
        const taskToDelete = ownerCheck.rows[0];
        await client.query('DELETE FROM service_tasks WHERE id = $1', [taskId]);
        
        if (taskToDelete.assignee_id) {
            const taskTypeName = 'Пополнение';
            const message = `❌ <b>Задача отменена: ${taskTypeName}</b>\n\nСтойка: <b>${taskToDelete.terminal_name}</b>\n\nЗадача была отменена администратором.`;
            sendNotification(taskToDelete.assignee_id, message).catch(console.error);
        }

        await client.query('COMMIT');
        res.json({ success: true, message: 'Задача удалена.' });

    } catch(err) {
        await client.query('ROLLBACK');
        console.error(`[DELETE /api/tasks/:taskId] UserID: ${ownerUserId} - Error:`, err);
        sendErrorToAdmin({ userId: ownerUserId, errorContext: `DELETE /api/tasks/${taskId}`, errorMessage: err.message }).catch(console.error);
        res.status(500).json({ success: false, error: 'Ошибка при удалении задачи.' });
    } finally {
        client.release();
    }
});

module.exports = router;