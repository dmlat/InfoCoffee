// backend/routes/warehouse.js
const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const pool = require('../db');
const { sendErrorToAdmin } = require('../utils/adminErrorNotifier');

// Получить остатки на центральном складе
router.get('/', authMiddleware, async (req, res) => {
    // ... (код без изменений)
});

// "Приходовать" товар на склад (через модальное окно)
router.post('/stock-up', authMiddleware, async (req, res) => {
    // ... (код без изменений)
});

// НОВЫЙ ЭНДПОИНТ: Изменить количество товара на складе (для кнопок +/-)
router.post('/adjust', authMiddleware, async (req, res) => {
    const userId = req.user.userId;
    const { item_name, quantity } = req.body; // quantity может быть отрицательным

    console.log(`[POST /api/warehouse/adjust] UserID: ${userId}, Item: ${item_name}, Quantity: ${quantity}`);

    if (!item_name || isNaN(parseFloat(quantity))) {
        return res.status(400).json({ success: false, error: 'Некорректные данные для изменения остатка.' });
    }

    const client = await pool.pool.connect();
    try {
        await client.query('BEGIN');

        // Проверяем, есть ли такая позиция на складе
        const existingItem = await client.query(
            `SELECT id, current_stock FROM inventories WHERE user_id = $1 AND location = 'warehouse' AND item_name = $2 AND terminal_id IS NULL`,
            [userId, item_name]
        );

        if (existingItem.rows.length > 0) {
            // Если позиция есть, обновляем, но проверяем, чтобы остаток не ушел в минус
            const updateRes = await client.query(
                `UPDATE inventories
                 SET current_stock = current_stock + $1, updated_at = NOW()
                 WHERE id = $2 AND current_stock + $1 >= 0
                 RETURNING current_stock`,
                [quantity, existingItem.rows[0].id]
            );

            if (updateRes.rowCount === 0) {
                // Это сработает, если остаток уходит в минус
                await client.query('ROLLBACK');
                return res.status(400).json({ success: false, error: 'Недостаточно остатков для списания.' });
            }
             await client.query('COMMIT');
             res.json({ success: true, new_stock: updateRes.rows[0].current_stock });

        } else if (quantity > 0) {
            // Если позиции нет, то можем только добавить (приход)
            const insertRes = await client.query(
                `INSERT INTO inventories (user_id, location, terminal_id, item_name, current_stock)
                 VALUES ($1, 'warehouse', NULL, $2, $3) RETURNING current_stock`,
                [userId, item_name, quantity]
            );
             await client.query('COMMIT');
             res.status(201).json({ success: true, new_stock: insertRes.rows[0].current_stock });
        } else {
            // Если позиции нет и пытаемся списать - ошибка
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, error: 'Товар не найден на складе для списания.' });
        }
    } catch (err) {
        await client.query('ROLLBACK');
        console.error(`[POST /api/warehouse/adjust] UserID: ${userId} - Error:`, err);
        sendErrorToAdmin({
            userId, errorContext: `POST /api/warehouse/adjust`,
            errorMessage: err.message, errorStack: err.stack, additionalInfo: { body: req.body }
        }).catch(console.error);
        res.status(500).json({ success: false, error: 'Ошибка сервера при изменении остатков.' });
    } finally {
        client.release();
    }
});


module.exports = router;