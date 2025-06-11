// backend/routes/recipes.js
const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const pool = require('../db');
const { sendErrorToAdmin } = require('../utils/adminErrorNotifier');

// Получить все рецепты для конкретного терминала по его внутреннему ID
router.get('/terminal/:terminalId', authMiddleware, async (req, res) => {
    const userId = req.user.userId;
    const { terminalId } = req.params;

    try {
        const ownerCheck = await pool.query('SELECT id FROM terminals WHERE id = $1 AND user_id = $2', [terminalId, userId]);
        if (ownerCheck.rowCount === 0) {
            return res.status(403).json({ success: false, error: 'Доступ запрещен' });
        }
        
        const recipesRes = await pool.query(
            `SELECT
                r.id,
                r.terminal_id,
                r.machine_item_id,
                r.name,
                r.updated_at,
                COALESCE(
                    (SELECT json_agg(json_build_object('item_name', ri.item_name, 'quantity', ri.quantity))
                     FROM recipe_items ri WHERE ri.recipe_id = r.id),
                    '[]'::json
                ) as items
             FROM recipes r
             WHERE r.terminal_id = $1`,
            [terminalId]
        );

        res.json({ success: true, recipes: recipesRes.rows });

    } catch (err) {
        console.error(`[GET /api/recipes/terminal/:id] UserID: ${userId} - Error:`, err);
        sendErrorToAdmin({
            userId, errorContext: `GET /api/recipes/terminal/${terminalId}`,
            errorMessage: err.message, errorStack: err.stack
        }).catch(console.error);
        res.status(500).json({ success: false, error: 'Ошибка сервера при получении рецептов' });
    }
});

// Сохранить/обновить один рецепт
router.post('/', authMiddleware, async (req, res) => {
    const userId = req.user.userId;
    const { terminalId, machine_item_id, name, items } = req.body; 

    if (!terminalId || !machine_item_id || !Array.isArray(items)) {
        return res.status(400).json({ success: false, error: 'Неверный формат данных' });
    }

    const client = await pool.pool.connect();
    try {
        await client.query('BEGIN');
        
        const ownerCheck = await client.query('SELECT id FROM terminals WHERE id = $1 AND user_id = $2', [terminalId, userId]);
        if (ownerCheck.rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(403).json({ success: false, error: 'Доступ запрещен' });
        }

        const recipeRes = await client.query(
            `INSERT INTO recipes (terminal_id, machine_item_id, name, updated_at)
             VALUES ($1, $2, $3, NOW())
             ON CONFLICT (terminal_id, machine_item_id)
             DO UPDATE SET name = EXCLUDED.name, updated_at = NOW()
             RETURNING id`,
            [terminalId, machine_item_id, name || `Напиток #${machine_item_id}`]
        );
        const recipeId = recipeRes.rows[0].id;

        await client.query('DELETE FROM recipe_items WHERE recipe_id = $1', [recipeId]);
        
        const validItems = items.filter(item => item.item_name && !isNaN(parseFloat(item.quantity)) && parseFloat(item.quantity) > 0);
        if (validItems.length > 0) {
            const values = [];
            const placeholders = validItems.map((item, index) => {
                const i = index * 3;
                values.push(recipeId, item.item_name, parseFloat(item.quantity));
                return `($${i + 1}, $${i + 2}, $${i + 3})`;
            }).join(',');
            
            const queryText = `INSERT INTO recipe_items (recipe_id, item_name, quantity) VALUES ${placeholders}`;
            await client.query(queryText, values);
        }

        await client.query('COMMIT');
        res.json({ success: true, message: 'Рецепт успешно сохранен!' });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error(`[POST /api/recipes] UserID: ${userId} - Error:`, err);
        sendErrorToAdmin({
            userId, errorContext: `POST /api/recipes`,
            errorMessage: err.message, errorStack: err.stack, additionalInfo: { body: req.body }
        }).catch(console.error);
        res.status(500).json({ success: false, error: 'Ошибка сервера при сохранении рецепта' });
    } finally {
        client.release();
    }
});


// Копировать рецепты
router.post('/copy', authMiddleware, async (req, res) => {
    const userId = req.user.userId;
    const { sourceTerminalId, destinationTerminalIds } = req.body;

    if (!sourceTerminalId || !Array.isArray(destinationTerminalIds) || destinationTerminalIds.length === 0) {
        return res.status(400).json({ success: false, error: 'Необходимы ID исходного и целевых терминалов.' });
    }
    
    const allIdsToCheck = [sourceTerminalId, ...destinationTerminalIds];

    const client = await pool.pool.connect();
    try {
        await client.query('BEGIN');

        const ownerCheck = await client.query(
            'SELECT id FROM terminals WHERE id = ANY($1::int[]) AND user_id = $2',
            [allIdsToCheck, userId]
        );
        if (ownerCheck.rowCount !== allIdsToCheck.length) {
            await client.query('ROLLBACK');
            return res.status(403).json({ success: false, error: 'Доступ к одному или нескольким терминалам запрещен.' });
        }

        const sourceRecipesRes = await client.query(
            `SELECT r.id, r.machine_item_id, r.name, json_agg(json_build_object('item_name', ri.item_name, 'quantity', ri.quantity)) as items
             FROM recipes r
             LEFT JOIN recipe_items ri ON r.id = ri.recipe_id
             WHERE r.terminal_id = $1
             GROUP BY r.id, r.machine_item_id, r.name`,
            [sourceTerminalId]
        );
        const sourceRecipes = sourceRecipesRes.rows;

        if (sourceRecipes.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, error: 'У исходного терминала нет сохраненных рецептов.' });
        }
        
        for (const destId of destinationTerminalIds) {
            for (const sourceRecipe of sourceRecipes) {
                const destRecipeRes = await client.query(
                    `INSERT INTO recipes (terminal_id, machine_item_id, name, updated_at)
                     VALUES ($1, $2, $3, NOW())
                     ON CONFLICT (terminal_id, machine_item_id)
                     DO UPDATE SET name = EXCLUDED.name, updated_at = NOW()
                     RETURNING id`,
                    [destId, sourceRecipe.machine_item_id, sourceRecipe.name]
                );
                const destRecipeId = destRecipeRes.rows[0].id;
                
                await client.query('DELETE FROM recipe_items WHERE recipe_id = $1', [destRecipeId]);
                
                const items = sourceRecipe.items.filter(item => item.item_name !== null && !isNaN(parseFloat(item.quantity)) && parseFloat(item.quantity) > 0);
                if (items.length > 0) {
                    const values = [];
                    const placeholders = items.map((item, index) => {
                        const i = index * 3;
                        values.push(destRecipeId, item.item_name, item.quantity);
                        return `($${i + 1}, $${i + 2}, $${i + 3})`;
                    }).join(',');

                    const queryText = `INSERT INTO recipe_items (recipe_id, item_name, quantity) VALUES ${placeholders}`;
                    await client.query(queryText, values);
                }
            }
        }

        await client.query('COMMIT');
        res.json({ success: true, message: `Рецепты успешно скопированы в ${destinationTerminalIds.length} терминал(а/ов).` });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error(`[POST /api/recipes/copy] UserID: ${userId} - Error:`, err);
        sendErrorToAdmin({
            userId, errorContext: `POST /api/recipes/copy`,
            errorMessage: err.message, errorStack: err.stack, additionalInfo: { body: req.body }
        }).catch(console.error);
        res.status(500).json({ success: false, error: 'Ошибка сервера при копировании рецептов.' });
    } finally {
        client.release();
    }
});

module.exports = router;