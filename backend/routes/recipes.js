// backend/routes/recipes.js
const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const { pool } = require('../db');
const { sendErrorToAdmin } = require('../utils/adminErrorNotifier');

// GET-запрос остается без изменений
router.get('/terminal/:terminalId', authMiddleware, async (req, res) => {
    const { ownerUserId, telegramId } = req.user;
    const { terminalId } = req.params;
    console.log(`[GET /api/recipes] ActorTG: ${telegramId}, OwnerID: ${ownerUserId} - Fetching recipes for TerminalID: ${terminalId}.`);
    try {
        const ownerCheck = await pool.query('SELECT id FROM terminals WHERE id = $1 AND user_id = $2', [terminalId, ownerUserId]);
        if (ownerCheck.rowCount === 0) {
            return res.status(403).json({ success: false, error: 'Доступ запрещен' });
        }
        const recipesRes = await pool.query(
            `SELECT
                r.id, r.terminal_id, r.machine_item_id, r.name, r.updated_at, r.is_hidden,
                COALESCE((SELECT json_agg(json_build_object('item_name', ri.item_name, 'quantity', ri.quantity)) FROM recipe_items ri WHERE ri.recipe_id = r.id), '[]'::json) as items
             FROM recipes r WHERE r.terminal_id = $1`,
            [terminalId]
        );
        res.json({ success: true, recipes: recipesRes.rows });
    } catch (err) {
        sendErrorToAdmin({ userId: ownerUserId, errorContext: `GET /api/recipes/terminal/${terminalId}`, errorMessage: err.message, errorStack: err.stack }).catch(console.error);
        res.status(500).json({ success: false, error: 'Ошибка сервера при получении рецептов' });
    }
});

// Сохранить/обновить один рецепт
router.post('/', authMiddleware, async (req, res) => {
    const { ownerUserId, telegramId } = req.user;
    const { terminalId, machine_item_id, name, items, save_as_template, is_hidden } = req.body; // Добавлено is_hidden
    console.log(`[POST /api/recipes] ActorTG: ${telegramId}, OwnerID: ${ownerUserId} - Saving recipe for TerminalID: ${terminalId}, MachineItemID: ${machine_item_id}. Hidden: ${is_hidden}`);

    if (!terminalId || !machine_item_id || !Array.isArray(items)) {
        return res.status(400).json({ success: false, error: 'Неверный формат данных' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const ownerCheck = await client.query('SELECT name FROM terminals WHERE id = $1 AND user_id = $2', [terminalId, ownerUserId]);
        if (ownerCheck.rowCount === 0) {
            throw new Error('Доступ к терминалу запрещен');
        }
        const terminalName = ownerCheck.rows[0].name;

        let recipeId;
        const existingRecipe = await client.query('SELECT id FROM recipes WHERE terminal_id = $1 AND machine_item_id = $2', [terminalId, machine_item_id]);

        if (existingRecipe.rows.length > 0) {
            recipeId = existingRecipe.rows[0].id;
            await client.query('UPDATE recipes SET name = $1, updated_at = NOW() WHERE id = $2', [name || `Напиток #${machine_item_id}`, recipeId]);
        } else {
            const newRecipeRes = await client.query(
                'INSERT INTO recipes (terminal_id, machine_item_id, name, is_hidden) VALUES ($1, $2, $3, $4) RETURNING id', 
                [terminalId, machine_item_id, name || `Напиток #${machine_item_id}`, !!is_hidden]
            );
            recipeId = newRecipeRes.rows[0].id;
        }

        await client.query('DELETE FROM recipe_items WHERE recipe_id = $1', [recipeId]);
        const validItems = items.filter(item => item.item_name && parseFloat(item.quantity) > 0);
        if (validItems.length > 0) {
            const values = validItems.flatMap(item => [recipeId, item.item_name, parseFloat(item.quantity)]);
            const placeholders = validItems.map((_, index) => `($${index * 3 + 1}, $${index * 3 + 2}, $${index * 3 + 3})`).join(',');
            await client.query(`INSERT INTO recipe_items (recipe_id, item_name, quantity) VALUES ${placeholders}`, values);
        }

        if (save_as_template && name) {
            const presetName = `${name} (${terminalName})`;
            const itemsJson = JSON.stringify(validItems.map(({ item_name, quantity }) => ({ item_name, quantity })));
            await client.query(
                `INSERT INTO recipe_presets (user_id, name, items)
                 VALUES ($1, $2, $3)
                 ON CONFLICT (user_id, name) DO UPDATE SET
                    items = EXCLUDED.items`,
                [ownerUserId, presetName, itemsJson]
            );
        }

        await client.query('COMMIT');
        res.status(201).json({ success: true, message: 'Рецепт успешно сохранен!' });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error(`[POST /api/recipes] UserID: ${ownerUserId} - Error:`, err);
        sendErrorToAdmin({ userId: ownerUserId, errorContext: `POST /api/recipes`, errorMessage: err.message, errorStack: err.stack, additionalInfo: { body: req.body } }).catch(console.error);
        res.status(500).json({ success: false, error: 'Ошибка сервера при сохранении рецепта' });
    } finally {
        client.release();
    }
});

// Переключить видимость рецепта
router.post('/:recipeId/toggle-hidden', authMiddleware, async (req, res) => {
    const { ownerUserId, telegramId } = req.user;
    const { recipeId } = req.params;
    const { is_hidden } = req.body;

    if (typeof is_hidden !== 'boolean') {
        return res.status(400).json({ success: false, error: 'Поле is_hidden должно быть boolean' });
    }

    console.log(`[POST /api/recipes/:id/toggle-hidden] ActorTG: ${telegramId}, OwnerID: ${ownerUserId} - Toggling hidden for RecipeID: ${recipeId} to ${is_hidden}.`);

    try {
        const ownerCheck = await pool.query(
            `SELECT r.id FROM recipes r
             JOIN terminals t ON r.terminal_id = t.id
             WHERE r.id = $1 AND t.user_id = $2`,
            [recipeId, ownerUserId]
        );

        if (ownerCheck.rowCount === 0) {
            return res.status(403).json({ success: false, error: 'Доступ запрещен или рецепт не найден' });
        }

        await pool.query(
            'UPDATE recipes SET is_hidden = $1, updated_at = NOW() WHERE id = $2',
            [is_hidden, recipeId]
        );

        res.json({ success: true, message: 'Статус видимости рецепта успешно обновлен.' });

    } catch (err) {
        sendErrorToAdmin({ userId: ownerUserId, errorContext: `POST /api/recipes/${recipeId}/toggle-hidden`, errorMessage: err.message, errorStack: err.stack }).catch(console.error);
        res.status(500).json({ success: false, error: 'Ошибка сервера при обновлении рецепта' });
    }
});


// Копировать рецепты
router.post('/copy', authMiddleware, async (req, res) => {
    const { ownerUserId, telegramId } = req.user;
    const { sourceTerminalId, destinationTerminalIds } = req.body;
    console.log(`[POST /api/recipes/copy] ActorTG: ${telegramId}, OwnerID: ${ownerUserId} - Copying recipes from ${sourceTerminalId} to ${destinationTerminalIds.join(', ')}.`);

    if (!sourceTerminalId || !Array.isArray(destinationTerminalIds) || destinationTerminalIds.length === 0) {
        return res.status(400).json({ success: false, error: 'Необходимы ID исходного и целевых терминалов.' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const allIdsToCheck = [sourceTerminalId, ...destinationTerminalIds];
        const ownerCheck = await client.query('SELECT id FROM terminals WHERE id = ANY($1::int[]) AND user_id = $2', [allIdsToCheck, ownerUserId]);
        if (ownerCheck.rowCount !== allIdsToCheck.length) {
            throw new Error('Доступ к одному или нескольким терминалам запрещен');
        }

        const sourceRecipesRes = await client.query(
            `SELECT r.machine_item_id, r.name, COALESCE((SELECT json_agg(json_build_object('item_name', ri.item_name, 'quantity', ri.quantity)) FROM recipe_items ri WHERE ri.recipe_id = r.id), '[]'::json) as items
             FROM recipes r WHERE r.terminal_id = $1`,
            [sourceTerminalId]
        );

        if (sourceRecipesRes.rows.length === 0) {
            await client.query('COMMIT');
            return res.json({ success: true, message: 'У исходного терминала нет рецептов для копирования.' });
        }

        for (const destId of destinationTerminalIds) {
            for (const sourceRecipe of sourceRecipesRes.rows) {
                let destRecipeId;
                const existingRecipe = await client.query('SELECT id FROM recipes WHERE terminal_id = $1 AND machine_item_id = $2', [destId, sourceRecipe.machine_item_id]);

                if (existingRecipe.rows.length > 0) {
                    destRecipeId = existingRecipe.rows[0].id;
                    await client.query('UPDATE recipes SET name = $1, updated_at = NOW() WHERE id = $2', [sourceRecipe.name, destRecipeId]);
                } else {
                     // КОД ВОЗВРАЩЕН К ОРИГИНАЛЬНОМУ ВАРИАНТУ. Теперь БД сама сгенерирует ID.
                    const newRecipeRes = await client.query('INSERT INTO recipes (terminal_id, machine_item_id, name) VALUES ($1, $2, $3) RETURNING id', [destId, sourceRecipe.machine_item_id, sourceRecipe.name]);
                    destRecipeId = newRecipeRes.rows[0].id;
                }

                await client.query('DELETE FROM recipe_items WHERE recipe_id = $1', [destRecipeId]);
                const validItems = sourceRecipe.items.filter(item => item.item_name && parseFloat(item.quantity) > 0);
                if (validItems.length > 0) {
                    const values = validItems.flatMap(item => [destRecipeId, item.item_name, parseFloat(item.quantity)]);
                    const placeholders = validItems.map((_, index) => `($${index * 3 + 1}, $${index * 3 + 2}, $${index * 3 + 3})`).join(',');
                    await client.query(`INSERT INTO recipe_items (recipe_id, item_name, quantity) VALUES ${placeholders}`, values);
                }
            }
        }

        await client.query('COMMIT');
        res.json({ success: true, message: `Рецепты успешно скопированы в ${destinationTerminalIds.length} терминал(а/ов).` });
    } catch (err) {
        await client.query('ROLLBACK');
        const errorMessage = err.message || 'Ошибка сервера при копировании рецептов.';
        console.error(`[POST /api/recipes/copy] UserID: ${ownerUserId} - Error:`, err);
        sendErrorToAdmin({ userId: ownerUserId, errorContext: `POST /api/recipes/copy`, errorMessage: err.message, errorStack: err.stack, additionalInfo: { body: req.body } }).catch(console.error);
        res.status(500).json({ success: false, error: errorMessage });
    } finally {
        client.release();
    }
});

module.exports = router;