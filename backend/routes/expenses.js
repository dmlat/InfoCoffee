const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const pool = require('../db');

// Получить все расходы пользователя
router.get('/', authMiddleware, async (req, res) => {
    try {
        const userId = req.user.userId;
        const result = await pool.query(
            'SELECT * FROM expenses WHERE user_id = $1 ORDER BY expense_time DESC',
            [userId]
        );
        res.json({ success: true, expenses: result.rows });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, error: 'Ошибка сервера' });
    }
});

// Добавить расход
router.post('/', authMiddleware, async (req, res) => {
    try {
        const userId = req.user.userId;
        const { amount, expense_time, comment } = req.body;

        const resultDb = await pool.query(
            `INSERT INTO expenses (user_id, amount, expense_time, comment)
             VALUES ($1, $2, $3, $4) RETURNING *`,
            [userId, amount, expense_time, comment]
        );
        res.json({ success: true, expense: resultDb.rows[0] });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, error: 'Ошибка сервера' });
    }
});

module.exports = router;
