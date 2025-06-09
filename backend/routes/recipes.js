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
        const recipesRes = await pool.query(
            `SELECT r.* FROM recipes r JOIN terminals t ON r.terminal_id = t.id
             WHERE r.terminal_id = $1 AND t.user_id = $2`,
            [terminalId, userId]
        );
        res.json({ success: true, recipes: recipesRes.rows });
    } catch (err) {
        console.error(`[GET /api/recipes/terminal/:id] UserID: ${userId} - Error:`, err);
        sendErrorToAdmin({
            userId,
            errorContext: `GET /api/recipes/terminal/${terminalId}`,
            errorMessage: err.message,
            errorStack: err.stack
        }).catch(console.error);
        res.status(500).json({ success: false, error: 'Ошибка сервера при получении рецептов' });
    }
});

// Сохранить/обновить пачку рецептов для терминала
router.post('/', authMiddleware, async (req, res) => {
    const userId = req.user.userId;
    const { terminalId, recipes } = req.body; // Ожидаем внутренний ID терминала и массив рецептов

    if (!terminalId || !Array.isArray(recipes)) {
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

        for (const recipe of recipes) {
            const { machine_item_id, name, coffee_grams, water_ml, milk_grams, cocoa_grams, raf_grams } = recipe;
            if (!machine_item_id) continue;

            await client.query(
                `INSERT INTO recipes (terminal_id, machine_item_id, name, coffee_grams, water_ml, milk_grams, cocoa_grams, raf_grams, updated_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
                 ON CONFLICT (terminal_id, machine_item_id)
                 DO UPDATE SET
                    name = EXCLUDED.name,
                    coffee_grams = EXCLUDED.coffee_grams,
                    water_ml = EXCLUDED.water_ml,
                    milk_grams = EXCLUDED.milk_grams,
                    cocoa_grams = EXCLUDED.cocoa_grams,
                    raf_grams = EXCLUDED.raf_grams,
                    updated_at = NOW()`,
                [terminalId, machine_item_id, name, coffee_grams || 0, water_ml || 0, milk_grams || 0, cocoa_grams || 0, raf_grams || 0]
            );
        }

        await client.query('COMMIT');
        res.json({ success: true, message: 'Рецепты успешно сохранены!' });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error(`[POST /api/recipes] UserID: ${userId} - Error:`, err);
        sendErrorToAdmin({
            userId,
            errorContext: `POST /api/recipes`,
            errorMessage: err.message,
            errorStack: err.stack,
            additionalInfo: { body: req.body }
        }).catch(console.error);
        res.status(500).json({ success: false, error: 'Ошибка сервера при сохранении рецептов' });
    } finally {
        client.release();
    }
});

module.exports = router;