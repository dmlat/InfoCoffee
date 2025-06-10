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
    // from, to - объекты вида { location: 'warehouse' | 'stand' | 'machine', terminal_id: 123 (НАШ ВНУТРЕННИЙ ID) }

    console.log(`[POST /api/inventory/move] UserID: ${userId} - Request: ${item_name} (${quantity}) from ${JSON.stringify(from)} to ${JSON.stringify(to)}`);

    if (!from || !to || !item_name || isNaN(parseFloat(quantity)) || quantity <= 0) {
        return res.status(400).json({ success: false, error: 'Не все поля для перемещения заполнены корректно.' });
    }
    
    const validLocations = ['warehouse', 'stand', 'machine'];
    if (!validLocations.includes(from.location) || !validLocations.includes(to.location)) {
        return res.status(400).json({ success: false, error: 'Некорректная локация источника или назначения.' });
    }

    if ((from.location !== 'warehouse' && !from.terminal_id) || (to.location !== 'warehouse' && !to.terminal_id)) {
        return res.status(400).json({ success: false, error: 'Для локаций "stand" и "machine" требуется terminal_id.' });
    }
    
    const client = await pool.pool.connect();
    try {
        await client.query('BEGIN');

        // 1. УМЕНЬШАЕМ остаток в источнике
        const fromTerminalId = from.location === 'warehouse' ? null : from.terminal_id;
        const fromUpdateRes = await client.query(
            `UPDATE inventories
             SET current_stock = current_stock - $1, updated_at = NOW()
             WHERE user_id = $2 AND location = $3 AND item_name = $4 AND (terminal_id = $5 OR (terminal_id IS NULL AND $5 IS NULL))
             AND current_stock >= $1
             RETURNING id`,
            [quantity, userId, from.location, item_name, fromTerminalId]
        );
        
        if (fromUpdateRes.rowCount === 0) {
            await client.query('ROLLBACK');
            const sourceName = from.location === 'warehouse' ? 'на складе' : `в локации "${from.location}"`;
            return res.status(400).json({ success: false, error: `Недостаточно остатков "${item_name}" ${sourceName}.` });
        }

        // 2. УВЕЛИЧИВАЕМ остаток в назначении (или создаем запись, если ее нет)
        const toTerminalId = to.location === 'warehouse' ? null : to.terminal_id;
        await client.query(
            `INSERT INTO inventories (user_id, location, terminal_id, item_name, current_stock)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (user_id, terminal_id, item_name, location)
             DO UPDATE SET
                current_stock = inventories.current_stock + EXCLUDED.current_stock,
                updated_at = NOW()`,
            [userId, to.location, toTerminalId, item_name, quantity]
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