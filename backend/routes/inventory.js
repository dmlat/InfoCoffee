// backend/routes/inventory.js
const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const pool = require('../db');
const { sendErrorToAdmin } = require('../utils/adminErrorNotifier');

// Перемещение остатков
router.post('/move', authMiddleware, async (req, res) => {
    const userId = req.user.userId;
    const { from, to, item_name, quantity } = req.body;
    // from, to - объекты вида { location: 'warehouse', terminal_id: null } или { location: 'stand', terminal_id: 1 }

    if (!from || !to || !item_name || isNaN(parseFloat(quantity)) || quantity <= 0) {
        return res.status(400).json({ success: false, error: 'Не все поля для перемещения заполнены корректно.' });
    }

    const client = await pool.pool.connect();
    try {
        await client.query('BEGIN');

        // 1. Уменьшаем остаток в источнике
        const fromUpdateRes = await client.query(
            `UPDATE inventories
             SET current_stock = current_stock - $1, updated_at = NOW()
             WHERE user_id = $2 AND location = $3 AND item_name = $4 AND (terminal_id = $5 OR (terminal_id IS NULL AND $5 IS NULL))
             AND current_stock >= $1
             RETURNING id`,
            [quantity, userId, from.location, item_name, from.terminal_id]
        );
        
        if (fromUpdateRes.rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ success: false, error: `Недостаточно остатков "${item_name}" в источнике.` });
        }

        // 2. Увеличиваем остаток в назначении (или создаем запись, если ее нет)
        await client.query(
            `INSERT INTO inventories (user_id, location, terminal_id, item_name, current_stock)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (user_id, terminal_id, item_name, location)
             DO UPDATE SET
                current_stock = inventories.current_stock + EXCLUDED.current_stock,
                updated_at = NOW()`,
            [userId, to.location, to.terminal_id, item_name, quantity]
        );

        await client.query('COMMIT');
        res.json({ success: true, message: `"${item_name}" успешно перемещен.` });

    } catch(err) {
        await client.query('ROLLBACK');
        console.error(`[POST /api/inventory/move] UserID: ${userId} - Error:`, err);
        sendErrorToAdmin({
            userId, errorContext: `POST /api/inventory/move`,
            errorMessage: err.message, errorStack: err.stack, additionalInfo: { body: req.body }
        }).catch(console.error);
        res.status(500).json({ success: false, error: 'Ошибка сервера при перемещении остатков.' });
    } finally {
        client.release();
    }
});


module.exports = router;