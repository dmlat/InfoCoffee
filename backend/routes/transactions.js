const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const pool = require('../db');

// Получить все транзакции текущего пользователя (старый)
router.get('/', authMiddleware, async (req, res) => {
    try {
        const userId = req.user.userId;
        const result = await pool.query(
            'SELECT * FROM transactions WHERE user_id = $1 ORDER BY transaction_time DESC',
            [userId]
        );
        res.json({ success: true, transactions: result.rows });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, error: 'Ошибка сервера' });
    }
});

// --- Новый агрегирующий эндпоинт для Dashboard ---
router.get('/stats', authMiddleware, async (req, res) => {
    try {
        const userId = req.user.userId;
        let { from, to } = req.query;

        if (!from || !to) {
            // Если не переданы, по умолчанию месяц
            const today = new Date();
            const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
            from = firstDay.toISOString().slice(0, 10) + 'T00:00:00';
            to = today.toISOString().slice(0, 10) + 'T23:59:59';
        }

        // Транзакции: только успешные, неотмененные, в рублях
        const trRes = await pool.query(
            `SELECT 
                COUNT(*) as sales_count, 
                COALESCE(SUM(amount),0) as revenue_cents
             FROM transactions
             WHERE user_id = $1
               AND result::integer = 1
               AND reverse_id = 0
               AND transaction_time >= $2
               AND transaction_time <= $3
            `,
            [userId, from, to]
        );
        const revenue = Number(trRes.rows[0].revenue_cents) / 100; // рубли
        const salesCount = Number(trRes.rows[0].sales_count);

        // Расходы за период
        const expRes = await pool.query(
            `SELECT COALESCE(SUM(amount),0) as expenses_sum 
             FROM expenses
             WHERE user_id = $1
               AND expense_time >= $2
               AND expense_time <= $3
            `,
            [userId, from, to]
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
        console.error(err);
        res.status(500).json({ success: false, error: 'Ошибка агрегирования' });
    }
});

// Добавить новую транзакцию (пример ручного добавления)
router.post('/', authMiddleware, async (req, res) => {
    try {
        const userId = req.user.userId;
        const {
            coffee_shop_id, amount, transaction_time, result,
            reverse_id, terminal_comment, card_number, status,
            bonus, left_sum, left_bonus
        } = req.body;

        const resultDb = await pool.query(
            `INSERT INTO transactions (
                user_id, coffee_shop_id, amount, transaction_time, result, reverse_id, 
                terminal_comment, card_number, status, bonus, left_sum, left_bonus
            ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12
            ) RETURNING *`,
            [
                userId, coffee_shop_id, amount, transaction_time, result,
                reverse_id, terminal_comment, card_number, status,
                bonus, left_sum, left_bonus
            ]
        );
        res.json({ success: true, transaction: resultDb.rows[0] });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, error: 'Ошибка сервера' });
    }
});

// Новый stats-эндпоинт по кофеточкам
router.get('/coffee-stats', authMiddleware, async (req, res) => {
    try {
        const userId = req.user.userId;
        let { from, to } = req.query;
        if (!from || !to) return res.status(400).json({ error: 'Укажите from/to' });

        const result = await pool.query(`
            SELECT 
                coffee_shop_id,
                COUNT(*) FILTER (WHERE result::integer = 1 AND reverse_id = 0) as sales_count,
                COALESCE(SUM(amount) FILTER (WHERE result::integer = 1 AND reverse_id = 0),0)/100 as revenue
            FROM transactions
            WHERE user_id = $1
              AND transaction_time >= $2 AND transaction_time <= $3
            GROUP BY coffee_shop_id
            ORDER BY revenue DESC
        `, [userId, from, to]);
        res.json({ stats: result.rows });
    } catch (err) {
        res.status(500).json({ error: 'Ошибка агрегации по кофеточкам' });
    }
});

module.exports = router;