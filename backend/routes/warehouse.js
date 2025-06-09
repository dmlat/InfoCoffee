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

    // --- НАЧАЛО: Добавлено логирование для диагностики ---
    console.log(`[POST /api/warehouse/stock-up] UserID: ${userId} - Received request body:`, JSON.stringify(req.body, null, 2));
    // --- КОНЕЦ: Добавлено логирование ---

    if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ success: false, error: 'Неверный формат данных' });
    }

    const client = await pool.pool.connect();
    try {
        await client.query('BEGIN');

        const itemsToStockUp = items.map(item => {
            let finalQuantity = parseFloat(String(item.quantity).replace(',', '.'));
            if (!item.item_name || isNaN(finalQuantity) || finalQuantity <= 0) return null;

            // Конвертируем кг и л в граммы и мл для бэкенда
            const unit = (['Кофе', 'Сливки', 'Какао', 'Раф'].includes(item.item_name)) ? 'кг' : (item.item_name === 'Вода' ? 'л' : 'шт');
            
            if (unit === 'кг' || unit === 'л') {
                finalQuantity *= 1000;
            }
            return { itemName: item.item_name, quantity: finalQuantity };
        }).filter(Boolean);

        // --- НАЧАЛО: Добавлено логирование для диагностики ---
        console.log(`[POST /api/warehouse/stock-up] UserID: ${userId} - Parsed and validated items to stock up:`, JSON.stringify(itemsToStockUp, null, 2));
        // --- КОНЕЦ: Добавлено логирование ---

        if (itemsToStockUp.length === 0) {
            await client.query('ROLLBACK'); // Откатываем транзакцию, так как нет данных для работы
            return res.status(400).json({ success: false, error: 'Добавьте хотя бы один товар с количеством больше нуля.' });
        }

        for (const item of itemsToStockUp) {
            await client.query(
                `INSERT INTO inventories (user_id, location, terminal_id, item_name, current_stock)
                 VALUES ($1, 'warehouse', NULL, $2, $3)
                 ON CONFLICT (user_id, terminal_id, item_name, location)
                 DO UPDATE SET
                    current_stock = inventories.current_stock + EXCLUDED.current_stock,
                    updated_at = NOW()`,
                [userId, item.itemName, item.quantity]
            );
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