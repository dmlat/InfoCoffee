// backend/routes/warehouse.js
const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const pool = require('../db');
const { sendErrorToAdmin } = require('../utils/adminErrorNotifier');

// Получить остатки на центральном складе
router.get('/', authMiddleware, async (req, res) => {
    const userId = req.user.userId;
    try {
        const warehouseRes = await pool.query(
            "SELECT item_name, current_stock FROM inventories WHERE user_id = $1 AND location = 'warehouse' AND terminal_id IS NULL",
            [userId]
        );
        res.json({ success: true, warehouseStock: warehouseRes.rows });
    } catch (err) {
        console.error(`[GET /api/warehouse] UserID: ${userId} - Error:`, err);
        sendErrorToAdmin({
            userId,
            errorContext: 'GET /api/warehouse',
            errorMessage: err.message, errorStack: err.stack
        }).catch(console.error);
        res.status(500).json({ success: false, error: 'Ошибка сервера при получении остатков склада' });
    }
});

// "Приходовать" товар на склад (переработано для надежности)
router.post('/stock-up', authMiddleware, async (req, res) => {
    const userId = req.user.userId;
    const { items } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ success: false, error: 'Неверный формат данных' });
    }

    const client = await pool.pool.connect();
    try {
        await client.query('BEGIN');

        for (const item of items) {
            if (!item.item_name || isNaN(parseFloat(item.quantity)) || item.quantity <= 0) {
                continue; // Пропускаем некорректные записи
            }
            
            // 1. Пытаемся найти существующую запись
            const existingItem = await client.query(
                `SELECT id FROM inventories 
                 WHERE user_id = $1 AND location = 'warehouse' AND item_name = $2 AND terminal_id IS NULL`,
                [userId, item.item_name]
            );

            if (existingItem.rows.length > 0) {
                // 2a. Если запись есть - обновляем
                await client.query(
                    `UPDATE inventories SET current_stock = current_stock + $1, updated_at = NOW()
                     WHERE id = $2`,
                    [item.quantity, existingItem.rows[0].id]
                );
            } else {
                // 2b. Если записи нет - создаем новую
                await client.query(
                    `INSERT INTO inventories (user_id, location, terminal_id, item_name, current_stock)
                     VALUES ($1, 'warehouse', NULL, $2, $3)`,
                    [userId, item.item_name, item.quantity]
                );
            }
        }
        
        await client.query('COMMIT');
        res.json({ success: true, message: 'Склад успешно пополнен!' });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error(`[POST /api/warehouse/stock-up] UserID: ${userId} - Error:`, err);
        sendErrorToAdmin({
            userId, errorContext: `POST /api/warehouse/stock-up`,
            errorMessage: err.message, errorStack: err.stack, additionalInfo: { body: req.body }
        }).catch(console.error);
        res.status(500).json({ success: false, error: 'Ошибка сервера при пополнении склада' });
    } finally {
        client.release();
    }
});

module.exports = router;