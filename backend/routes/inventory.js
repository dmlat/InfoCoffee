// backend/routes/inventory.js
const express = require('express');
const router = express.Router(); // <--- Вот недостающая строка
const authMiddleware = require('../middleware/auth');
const pool = require('../db');
const { sendErrorToAdmin } = require('../utils/adminErrorNotifier');

// Перемещение остатков
router.post('/move', authMiddleware, async (req, res) => {
    const ownerUserId = req.user.ownerUserId;
    const { from, to, item_name, quantity } = req.body;

    console.log(`[POST /api/inventory/move] UserID: ${ownerUserId} - Request: ${item_name} (${quantity}) from ${JSON.stringify(from)} to ${JSON.stringify(to)}`);

    if (!from || !to || !item_name || isNaN(parseFloat(quantity)) || quantity <= 0) {
        return res.status(400).json({ success: false, error: 'Не все поля для перемещения заполнены корректно.' });
    }
    
    const client = await pool.pool.connect();
    try {
        await client.query('BEGIN');

        const fromTerminalId = from.location === 'warehouse' ? null : from.terminal_id;
        const toTerminalId = to.location === 'warehouse' ? null : to.terminal_id;

        // 1. УМЕНЬШАЕМ остаток в источнике
        const fromUpdateRes = await client.query(
            `UPDATE inventories
             SET current_stock = current_stock - $1, updated_at = NOW()
             WHERE user_id = $2 AND location = $3 AND item_name = $4 AND terminal_id IS NOT DISTINCT FROM $5
             AND current_stock >= $1
             RETURNING current_stock`,
            [quantity, ownerUserId, from.location, item_name, fromTerminalId]
        );
        
        if (fromUpdateRes.rowCount === 0) {
            await client.query('ROLLBACK');
            const sourceName = from.location === 'warehouse' ? 'на складе' : `в локации "${from.location}"`;
            return res.status(400).json({ success: false, error: `Недостаточно остатков "${item_name}" ${sourceName}.` });
        }

        // 2. УВЕЛИЧИВАЕМ остаток в назначении
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

        await client.query('COMMIT');
        
        res.json({ 
            success: true, 
            message: `"${item_name}" успешно перемещен.`,
            updatedStock: {
                from: { location: from.location, terminal_id: fromTerminalId, new_stock: fromUpdateRes.rows[0].current_stock },
                to: { location: to.location, terminal_id: toTerminalId, new_stock: toUpdateRes.rows[0].current_stock }
            }
        });

    } catch(err) {
        await client.query('ROLLBACK');
        console.error(`[POST /api/inventory/move] UserID: ${ownerUserId} - Error:`, err);
        sendErrorToAdmin({
            userId: ownerUserId, errorContext: `POST /api/inventory/move`,
            errorMessage: err.message, errorStack: err.stack, additionalInfo: { body: req.body }
        }).catch(console.error);
        res.status(500).json({ success: false, error: 'Ошибка сервера при перемещении остатков.' });
    } finally {
        client.release();
    }
});

// Обработать продажу и списать остатки по рецепту
router.post('/process-sale', authMiddleware, async (req, res) => {
    const ownerUserId = req.user.ownerUserId;
    const { transaction } = req.body;

    if (!transaction || !transaction.term_id || !transaction.machine_item_id) {
        return res.status(200).json({ success: true, message: 'No recipe to process for this transaction.' });
    }
    
    // ВРЕМЕННО ОТКЛЮЧАЕМ ПРЯМОЕ СПИСАНИЕ.
    // Логика будет перенесена в воркер для надежной обработки продаж и возвратов.
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
        console.error(`[POST /api/inventory/process-sale] UserID: ${ownerUserId} - Error:`, err);
        sendErrorToAdmin({
            userId: ownerUserId, errorContext: `POST /api/inventory/process-sale`,
            errorMessage: err.message, errorStack: err.stack, additionalInfo: { body: req.body }
        }).catch(console.error);
        res.status(200).json({ success: false, error: 'Server error during stock deduction.' });
    } finally {
        client.release();
    }
    */
});


module.exports = router;