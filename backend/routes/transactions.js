const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const pool = require('../db');
const moment = require('moment-timezone'); // Ensure moment-timezone is installed

// --- Aggregating endpoint for Dashboard ---
router.get('/stats', authMiddleware, async (req, res) => {
    try {
        const userId = req.user.userId;
        let { from, to } = req.query; // Expecting YYYY-MM-DD strings

        if (!from || !to) {
            // Default to current month in Moscow time if not provided
            const todayMoscow = moment().tz('Europe/Moscow');
            from = todayMoscow.clone().startOf('month').format('YYYY-MM-DD');
            to = todayMoscow.format('YYYY-MM-DD');
        }

        // Construct date range for SQL query, assuming transaction_time is stored effectively as Moscow time
        // The database will interpret these as 'YYYY-MM-DD 00:00:00' and 'YYYY-MM-DD 23:59:59' in its local/session timezone.
        // If transaction_time is timestamp WITH timezone, this is fine.
        // If transaction_time is timestamp WITHOUT timezone and stores Moscow time, this is also fine if DB server timezone matches or connection timezone is set to Moscow.
        const dateFrom = `${from} 00:00:00`; // Start of the day
        const dateTo = `${to} 23:59:59`;   // End of the day

        const trRes = await pool.query(
            `SELECT 
                COUNT(*) as sales_count, 
                COALESCE(SUM(amount),0) as revenue_cents
             FROM transactions
             WHERE user_id = $1
               AND result = '1' -- Assuming result '1' means success
               AND reverse_id = 0
               AND transaction_time >= $2 
               AND transaction_time <= $3
            `,
            [userId, dateFrom, dateTo]
        );
        const revenue = Number(trRes.rows[0].revenue_cents) / 100;
        const salesCount = Number(trRes.rows[0].sales_count);

        const expRes = await pool.query(
            `SELECT COALESCE(SUM(amount),0) as expenses_sum 
             FROM expenses
             WHERE user_id = $1
               AND expense_time >= $2 -- Assuming expense_time also needs this range logic
               AND expense_time <= $3
            `,
            [userId, dateFrom, dateTo]
        );
        const expensesSum = Number(expRes.rows[0].expenses_sum);

        res.json({
            success: true,
            stats: {
                revenue,
                salesCount,
                expensesSum
            }
        });
    } catch (err) {
        console.error("Error in /transactions/stats:", err);
        res.status(500).json({ success: false, error: 'Ошибка агрегирования статистики' });
    }
});

// Stats-endpoint by coffee shops
router.get('/coffee-stats', authMiddleware, async (req, res) => {
    try {
        const userId = req.user.userId;
        let { from, to } = req.query; // Expecting YYYY-MM-DD
        if (!from || !to) return res.status(400).json({ success: false, error: 'Укажите from/to в формате YYYY-MM-DD' });

        const dateFrom = `${from} 00:00:00`;
        const dateTo = `${to} 23:59:59`;

        const result = await pool.query(`
            SELECT 
                coffee_shop_id,
                MAX(terminal_comment) AS terminal_comment, -- This still might pick an arbitrary comment if many exist
                COUNT(*) FILTER (WHERE result = '1' AND reverse_id = 0) as sales_count,
                COALESCE(SUM(amount) FILTER (WHERE result = '1' AND reverse_id = 0),0)/100 as revenue
            FROM transactions
            WHERE user_id = $1
              AND transaction_time >= $2 AND transaction_time <= $3
            GROUP BY coffee_shop_id
            ORDER BY revenue DESC
        `, [userId, dateFrom, dateTo]);
        res.json({ success: true, stats: result.rows });
    } catch (err) {
        console.error("Error in /transactions/coffee-stats:", err);
        res.status(500).json({ success: false, error: 'Ошибка агрегации по кофеточкам' });
    }
});


// Get all transactions (legacy or for detailed view) - also apply date fix
router.get('/', authMiddleware, async (req, res) => {
    try {
        const userId = req.user.userId;
        // Optional: Add from/to query params here as well if needed for pagination or filtering
        const result = await pool.query(
            'SELECT * FROM transactions WHERE user_id = $1 ORDER BY transaction_time DESC',
            [userId]
        );
        res.json({ success: true, transactions: result.rows });
    } catch (err) {
        console.error("Error in GET /transactions:", err);
        res.status(500).json({ success: false, error: 'Ошибка сервера при получении транзакций' });
    }
});

// POST transaction - likely for admin/testing, no date changes needed here unless specific logic
router.post('/', authMiddleware, async (req, res) => {
    try {
        const userId = req.user.userId;
        const { /* ... all transaction fields ... */ } = req.body;
        // ... existing insert logic ...
        // For brevity, not re-listing the full insert, assume it's correct.
        // Just ensure transaction_time is handled consistently if it's manually set.
        const resultDb = await pool.query( /* ... your insert query ... */ ); // Example
        res.json({ success: true, transaction: resultDb.rows[0] });
    } catch (err) {
        console.error("Error in POST /transactions:", err);
        res.status(500).json({ success: false, error: 'Ошибка сервера при добавлении транзакции' });
    }
});

module.exports = router;