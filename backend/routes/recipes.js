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
        // Проверяем, что пользователь владеет этим терминалом
        const ownerCheck = await pool.query('SELECT id FROM terminals WHERE id = $1 AND user_id = $2', [terminalId, userId]);
        if (ownerCheck.rowCount === 0) {
            return res.status(403).json({ success: false, error: 'Доступ запрещен' });
        }
        
        // Получаем рецепты и агрегируем их состав в JSON массив
        const recipesRes = await pool.query(
            `SELECT
                r.id,
                r.terminal_id,
                r.machine_item_id,
                r.name,
                r.updated_at,
                COALESCE(
                    (SELECT json_agg(
                        json_build_object(
                            'item_name', ri.item_name,
                            'quantity', ri.quantity
                        )
                    )
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

// Сохранить/обновить пачку рецептов для терминала
router.post('/', authMiddleware, async (req, res) => {
    const userId = req.user.userId;
    // Ожидаем { terminalId, machineItemId, name, items: [{item_name, quantity}] }
    const { terminalId, machine_item_id, name, items } = req.body; 

    if (!terminalId || !machine_item_id || !Array.isArray(items)) {
        return res.status(400).json({ success: false, error: 'Неверный формат данных' });
    }

    const client = await pool.pool.connect();
    try {
        await client.query('BEGIN');
        
        // Проверяем, что пользователь владеет этим терминалом
        const ownerCheck = await client.query('SELECT id FROM terminals WHERE id = $1 AND user_id = $2', [terminalId, userId]);
        if (ownerCheck.rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(403).json({ success: false, error: 'Доступ запрещен' });
        }

        // Вставляем или обновляем основную запись рецепта
        const recipeRes = await client.query(
            `INSERT INTO recipes (terminal_id, machine_item_id, name, updated_at)
             VALUES ($1, $2, $3, NOW())
             ON CONFLICT (terminal_id, machine_item_id)
             DO UPDATE SET name = EXCLUDED.name, updated_at = NOW()
             RETURNING id`,
            [terminalId, machine_item_id, name || `Напиток #${machine_item_id}`]
        );
        const recipeId = recipeRes.rows[0].id;

        // Удаляем старый состав рецепта
        await client.query('DELETE FROM recipe_items WHERE recipe_id = $1', [recipeId]);
        
        // Вставляем новый состав рецепта
        if (items.length > 0) {
            const queryValues = items.map(item => `(${recipeId}, '${item.item_name}', ${parseFloat(item.quantity) || 0})`).join(',');
            const queryText = `INSERT INTO recipe_items (recipe_id, item_name, quantity) VALUES ${queryValues}`;
            await client.query(queryText);
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
    const { sourceTerminalId, destinationTerminalId } = req.body;

    if (!sourceTerminalId || !destinationTerminalId) {
        return res.status(400).json({ success: false, error: 'Необходимы ID исходного и целевого терминала.' });
    }

    const client = await pool.pool.connect();
    try {
        await client.query('BEGIN');

        // 1. Проверить, что оба терминала принадлежат пользователю
        const ownerCheck = await client.query(
            'SELECT id FROM terminals WHERE id = ANY($1::int[]) AND user_id = $2',
            [[sourceTerminalId, destinationTerminalId], userId]
        );
        if (ownerCheck.rowCount !== 2) {
            await client.query('ROLLBACK');
            return res.status(403).json({ success: false, error: 'Доступ к одному или обоим терминалам запрещен.' });
        }

        // 2. Получить рецепты из исходного терминала
        const sourceRecipesRes = await client.query(
            'SELECT id, machine_item_id, name FROM recipes WHERE terminal_id = $1',
            [sourceTerminalId]
        );
        const sourceRecipes = sourceRecipesRes.rows;

        if (sourceRecipes.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, error: 'У исходного терминала нет сохраненных рецептов.' });
        }
        
        let copiedCount = 0;
        // 3. Скопировать каждый рецепт и его состав
        for (const sourceRecipe of sourceRecipes) {
            // 3.1 Создаем или обновляем запись рецепта в целевом терминале
            const destRecipeRes = await client.query(
                `INSERT INTO recipes (terminal_id, machine_item_id, name, updated_at)
                 VALUES ($1, $2, $3, NOW())
                 ON CONFLICT (terminal_id, machine_item_id)
                 DO UPDATE SET name = EXCLUDED.name, updated_at = NOW()
                 RETURNING id`,
                [destinationTerminalId, sourceRecipe.machine_item_id, sourceRecipe.name]
            );
            const destRecipeId = destRecipeRes.rows[0].id;
            
            // 3.2 Удаляем старый состав у целевого рецепта
            await client.query('DELETE FROM recipe_items WHERE recipe_id = $1', [destRecipeId]);

            // 3.3 Копируем состав из исходного рецепта
            await client.query(
                `INSERT INTO recipe_items (recipe_id, item_name, quantity)
                 SELECT $1, item_name, quantity
                 FROM recipe_items
                 WHERE recipe_id = $2`,
                [destRecipeId, sourceRecipe.id]
            );
            copiedCount++;
        }

        await client.query('COMMIT');
        res.json({ success: true, message: `Рецепты успешно скопированы. Скопировано ${copiedCount} позиций.` });

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