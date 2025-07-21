// backend/routes/inventory.js
const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const { pool } = require('../db');
const { sendErrorToAdmin } = require('../utils/adminErrorNotifier');
const { logInventoryChange } = require('../utils/inventoryLogger');

// Перемещение остатков
router.post('/move', authMiddleware, async (req, res) => {
    const { ownerUserId, telegramId, accessLevel } = req.user;
    const { from, to, item_name, quantity } = req.body;

    console.log(`[POST /api/inventory/move] ActorTG: ${telegramId}, OwnerID: ${ownerUserId}, Level: ${accessLevel} - Request: ${item_name} (${quantity}) from ${JSON.stringify(from)} to ${JSON.stringify(to)}`);

    if (!from || !to || !item_name || isNaN(parseFloat(quantity)) || quantity <= 0) {
        return res.status(400).json({ success: false, error: 'Не все поля для перемещения заполнены корректно.' });
    }
    
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const fromTerminalId = from.location === 'warehouse' ? null : from.terminal_id;
        const toTerminalId = to.location === 'warehouse' ? null : to.terminal_id;
        
        // --- 1. Получаем текущие остатки и блокируем строки ---
        const fromStockRes = await client.query(
            `SELECT current_stock FROM inventories WHERE user_id = $1 AND location = $2 AND item_name = $3 AND terminal_id IS NOT DISTINCT FROM $4 FOR UPDATE`,
            [ownerUserId, from.location, item_name, fromTerminalId]
        );
        const fromStockBefore = fromStockRes.rows.length > 0 ? parseFloat(fromStockRes.rows[0].current_stock) : 0;
        
        if (fromStockBefore < quantity) {
            await client.query('ROLLBACK');
            const sourceName = from.location === 'warehouse' ? 'на складе' : `в локации "${from.location}"`;
            return res.status(400).json({ success: false, error: `Недостаточно остатков "${item_name}" ${sourceName}.` });
        }

        const toStockRes = await client.query(
            `SELECT current_stock FROM inventories WHERE user_id = $1 AND location = $2 AND item_name = $3 AND terminal_id IS NOT DISTINCT FROM $4 FOR UPDATE`,
            [ownerUserId, to.location, item_name, toTerminalId]
        );
        const toStockBefore = toStockRes.rows.length > 0 ? parseFloat(toStockRes.rows[0].current_stock) : 0;

        // --- 2. УМЕНЬШАЕМ остаток в источнике ---
        const fromUpdateRes = await client.query(
            `UPDATE inventories SET current_stock = current_stock - $1, updated_at = NOW()
             WHERE user_id = $2 AND location = $3 AND item_name = $4 AND terminal_id IS NOT DISTINCT FROM $5
             RETURNING current_stock`,
            [quantity, ownerUserId, from.location, item_name, fromTerminalId]
        );
        
        // --- 3. УВЕЛИЧИВАЕМ остаток в назначении ---
        let toUpdateRes;
        if (to.location === 'warehouse') {
            // Отдельная обработка для склада (terminal_id IS NULL)
            toUpdateRes = await client.query(
                `UPDATE inventories SET current_stock = current_stock + $1, updated_at = NOW()
                 WHERE user_id = $2 AND location = 'warehouse' AND item_name = $3 AND terminal_id IS NULL
                 RETURNING current_stock`,
                [quantity, ownerUserId, item_name]
            );

            if (toUpdateRes.rowCount === 0) {
                // Если строки не было, создаем ее
                toUpdateRes = await client.query(
                    `INSERT INTO inventories (user_id, location, terminal_id, item_name, current_stock)
                     VALUES ($1, 'warehouse', NULL, $2, $3)
                     RETURNING current_stock`,
                    [ownerUserId, item_name, quantity]
                );
            }
        } else {
            // Старая логика для стоек, где terminal_id есть и ON CONFLICT работает
            toUpdateRes = await client.query(
                `INSERT INTO inventories (user_id, location, terminal_id, item_name, current_stock)
                 VALUES ($1, $2, $3, $4, $5)
                 ON CONFLICT (user_id, terminal_id, item_name, location)
                 DO UPDATE SET
                    current_stock = inventories.current_stock + EXCLUDED.current_stock,
                    updated_at = NOW()
                 RETURNING current_stock`,
                [ownerUserId, to.location, toTerminalId, item_name, quantity]
            );
        }

        // --- 4. Логируем оба изменения ---
        const fromStockAfter = parseFloat(fromUpdateRes.rows[0].current_stock);
        const toStockAfter = parseFloat(toUpdateRes.rows[0].current_stock);

        await logInventoryChange({
            owner_user_id: ownerUserId, changed_by_telegram_id: telegramId,
            change_source: 'transfer_out', terminal_id: fromTerminalId,
            item_name, quantity_before: fromStockBefore, quantity_after: fromStockAfter
        }, client);

        await logInventoryChange({
            owner_user_id: ownerUserId, changed_by_telegram_id: telegramId,
            change_source: 'transfer_in', terminal_id: toTerminalId,
            item_name, quantity_before: toStockBefore, quantity_after: toStockAfter
        }, client);


        // --- 5. АВТОМАТИЧЕСКОЕ ЗАКРЫТИЕ ЗАДАЧ ---
        // Если перемещение было в кофемашину (из стойки), проверяем, можно ли закрыть задачи на пополнение
        if (to.location === 'machine' && toTerminalId) {
            // Ищем все активные задачи на пополнение для данного терминала
            const pendingTasksRes = await client.query(
               `SELECT id, details FROM service_tasks WHERE terminal_id = $1 AND task_type = 'restock' AND status = 'pending'`,
               [toTerminalId]
            );

                    for (const task of pendingTasksRes.rows) {
            const isManualTask = task.details?.is_manual === true;
            
            if (isManualTask) {
                // Для ручных задач: автоматически завершаем при любом пополнении в кофемашину
                const updateTasksRes = await client.query(
                   `UPDATE service_tasks SET status = 'completed', completed_at = NOW() WHERE id = $1`,
                   [task.id]
                );
                if (updateTasksRes.rowCount > 0) {
                    console.log(`[POST /api/inventory/move] OwnerID: ${ownerUserId} - Auto-closed manual restock task ${task.id} for terminal ${toTerminalId} after replenishment.`);
                }
            } else {
                // Для автоматических задач: проверяем список ингредиентов
                const requiredItems = task.details?.items;

                // Пропускаем, если в задаче нет списка ингредиентов
                if (!requiredItems || !Array.isArray(requiredItems) || requiredItems.length === 0) {
                    continue;
                }
                
                // Получаем текущие и критические остатки для всех нужных ингредиентов
                const stockCheckRes = await client.query(
                    `SELECT item_name, current_stock, critical_stock 
                     FROM inventories 
                     WHERE terminal_id = $1 AND location = 'machine' AND item_name = ANY($2::text[])`,
                    [toTerminalId, requiredItems]
                );

                const itemStockMap = stockCheckRes.rows.reduce((acc, row) => {
                    acc[row.item_name] = { current: parseFloat(row.current_stock), critical: parseFloat(row.critical_stock) };
                    return acc;
                }, {});

                let allItemsOk = true;
                for (const itemName of requiredItems) {
                    const stock = itemStockMap[itemName];
                    // Если хоть один ингредиент не найден, не имеет крит. остатка, или его текущий остаток не выше крит., то задача не завершена
                    if (!stock || isNaN(stock.critical) || stock.current <= stock.critical) {
                        allItemsOk = false;
                        break;
                    }
                }

                if (allItemsOk) {
                    // Если все ингредиенты пополнены, завершаем задачу
                    const updateTasksRes = await client.query(
                       `UPDATE service_tasks SET status = 'completed', completed_at = NOW() WHERE id = $1`,
                       [task.id]
                    );
                    if (updateTasksRes.rowCount > 0) {
                        console.log(`[POST /api/inventory/move] OwnerID: ${ownerUserId} - Auto-closed automatic restock task ${task.id} for terminal ${toTerminalId} as all items are above critical stock.`);
                    }
                }
            }
        }
        }


        await client.query('COMMIT');
        
        res.json({ 
            success: true, 
            message: `"${item_name}" успешно перемещен.`,
            updatedStock: {
                from: { location: from.location, terminal_id: fromTerminalId, new_stock: fromStockAfter },
                to: { location: to.location, terminal_id: toTerminalId, new_stock: toStockAfter }
            }
        });

    } catch(err) {
        await client.query('ROLLBACK');
        console.error(`[POST /api/inventory/move] OwnerID: ${ownerUserId} - Error:`, err);
        sendErrorToAdmin({
            userId: ownerUserId, errorContext: `POST /api/inventory/move - OwnerID: ${ownerUserId}`,
            errorMessage: err.message, errorStack: err.stack, additionalInfo: { body: req.body }
        }).catch(console.error);
        res.status(500).json({ success: false, error: 'Ошибка сервера при перемещении остатков.' });
    } finally {
        client.release();
    }
});

// Обработать продажу и списать остатки по рецепту
router.post('/process-sale', authMiddleware, async (req, res) => {
    const { ownerUserId, telegramId } = req.user;
    const { transaction } = req.body;
    console.log(`[POST /api/inventory/process-sale] ActorTG: ${telegramId}, OwnerID: ${ownerUserId} - Acknowledging sale.`);

    if (!transaction || !transaction.term_id || !transaction.machine_item_id) {
        return res.status(200).json({ success: true, message: 'No recipe to process for this transaction.' });
    }
    
    // ВРЕМЕННО ОТКЛЮЧАЕМ ПРЯМОЕ СПИСАНИЕ.
    // Логика будет перенесена в воркер для надежной обработки продаж и возвратов.
    console.log(`[POST /api/inventory/process-sale] ActorTG: ${telegramId}, OwnerID: ${ownerUserId} - Request acknowledged, will be handled by worker.`);
    return res.status(200).json({ success: true, message: 'Transaction acknowledged. Processing will be handled by the worker.' });

    /*
    const client = await pool.pool.connect();
    try {
        await client.query('BEGIN');
        
        const terminalRes = await client.query(
            'SELECT id FROM terminals WHERE user_id = $1 AND vendista_terminal_id = $2',
            [ownerUserId, transaction.term_id]
        );
        if (terminalRes.rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(200).json({ success: true, message: 'Terminal not found in DB yet.' });
        }
        const internalTerminalId = terminalRes.rows[0].id;

        const recipeRes = await client.query(
            `SELECT id FROM recipes WHERE terminal_id = $1 AND machine_item_id = $2`,
            [internalTerminalId, transaction.machine_item_id]
        );
        if (recipeRes.rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(200).json({ success: true, message: 'Recipe not found for this item.' });
        }
        const recipeId = recipeRes.rows[0].id;

        const itemsRes = await client.query('SELECT item_name, quantity FROM recipe_items WHERE recipe_id = $1', [recipeId]);
        if (itemsRes.rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(200).json({ success: true, message: 'Recipe is empty.' });
        }

        for (const item of itemsRes.rows) {
            if (item.quantity > 0) {
                await client.query(
                    `UPDATE inventories 
                     SET current_stock = current_stock - $1, updated_at = NOW()
                     WHERE terminal_id = $2 AND item_name = $3 AND location = 'machine'`,
                    [item.quantity, internalTerminalId, item.item_name]
                );
            }
        }
        
        await client.query('COMMIT');
        res.status(200).json({ success: true, message: 'Stock updated successfully.' });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error(`[POST /api/inventory/process-sale] OwnerID: ${ownerUserId} - Error:`, err);
        sendErrorToAdmin({
            userId: ownerUserId, errorContext: `POST /api/inventory/process-sale - OwnerID: ${ownerUserId}`,
            errorMessage: err.message, errorStack: err.stack, additionalInfo: { body: req.body }
        }).catch(console.error);
        res.status(200).json({ success: false, error: 'Server error during stock deduction.' });
    } finally {
        client.release();
    }
    */
});

// Получить остатки (универсальный)
router.get('/', authMiddleware, async (req, res) => {
    const { ownerUserId, telegramId } = req.user;
    const { location, terminal_id } = req.query; // 'warehouse' или 'stand'

    console.log(`[GET /api/inventory] ActorTG: ${telegramId}, OwnerID: ${ownerUserId} - Fetching inventory for location: ${location}, terminal_id: ${terminal_id}`);

    if (!location) {
        return res.status(400).json({ success: false, error: "Параметр 'location' обязателен." });
    }

    try {
        let query;
        let params;

        if (location === 'warehouse') {
            query = "SELECT item_name, current_stock FROM inventories WHERE user_id = $1 AND location = 'warehouse'";
            params = [ownerUserId];
        } else if (location === 'stand' && terminal_id) {
            query = "SELECT item_name, current_stock, max_stock, critical_stock FROM inventories WHERE user_id = $1 AND terminal_id = $2 AND location = 'stand'";
            params = [ownerUserId, terminal_id];
        } else {
             return res.status(400).json({ success: false, error: "Для локации 'stand' требуется 'terminal_id'." });
        }
        
        const result = await pool.query(query, params);

        // Для склада мы возвращаем просто 'warehouseStock'
        const responseKey = location === 'warehouse' ? 'warehouseStock' : 'inventory';
        
        res.json({ success: true, [responseKey]: result.rows });

    } catch (err) {
        console.error(`[GET /api/inventory] OwnerID: ${ownerUserId} - Error fetching for location ${location}:`, err);
        sendErrorToAdmin({
            userId: ownerUserId,
            errorContext: `GET /api/inventory?location=${location}`,
            errorMessage: err.message,
            errorStack: err.stack
        }).catch(console.error);
        res.status(500).json({ success: false, error: 'Ошибка сервера при получении остатков.' });
    }
});

// NEW: Получить остатки для конкретного терминала
router.get('/terminal/:terminalId', authMiddleware, async (req, res) => {
    const { ownerUserId, telegramId } = req.user;
    const { terminalId } = req.params;

    console.log(`[GET /api/inventory/terminal/:terminalId] ActorTG: ${telegramId}, OwnerID: ${ownerUserId} - Fetching inventory for TerminalID: ${terminalId}.`);
    
    try {
        // Проверка, что терминал принадлежит пользователю
        const ownerCheck = await pool.query(
            'SELECT id FROM terminals WHERE id = $1 AND user_id = $2',
            [terminalId, ownerUserId]
        );
        if (ownerCheck.rowCount === 0) {
            return res.status(403).json({ success: false, error: 'Доступ к терминалу запрещен.' });
        }

        const inventoryRes = await pool.query(
            `SELECT item_name, current_stock, max_stock, critical_stock 
             FROM inventories
             WHERE user_id = $1 AND terminal_id = $2 AND location = 'machine'
             ORDER BY item_name`,
            [ownerUserId, terminalId]
        );

        res.json({ success: true, inventory: inventoryRes.rows });
        
    } catch (err) {
        console.error(`[GET /api/inventory/terminal/:terminalId] OwnerID: ${ownerUserId} - Error:`, err);
        sendErrorToAdmin({
            userId: ownerUserId,
            errorContext: `GET /api/inventory/terminal/${terminalId}`,
            errorMessage: err.message,
            errorStack: err.stack
        }).catch(console.error);
        res.status(500).json({ success: false, error: 'Ошибка сервера при получении остатков.' });
    }
});


module.exports = router;