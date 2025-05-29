// backend/routes/expenses.js
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth'); // Убедись, что путь к authMiddleware правильный
const pool = require('../db');

// Получить все расходы пользователя
router.get('/', authMiddleware, async (req, res) => {
    try {
        const userId = req.user.userId; // req.user должен устанавливаться в authMiddleware
        const result = await pool.query(
            'SELECT * FROM expenses WHERE user_id = $1 ORDER BY expense_time DESC, id DESC', // Добавил сортировку по id для стабильности
            [userId]
        );
        res.json({ success: true, expenses: result.rows });
    } catch (err) {
        console.error("Ошибка в GET /api/expenses:", err);
        res.status(500).json({ success: false, error: 'Ошибка сервера при получении расходов' });
    }
});

// Добавить расход
router.post('/', authMiddleware, async (req, res) => {
    try {
        const userId = req.user.userId;
        const { amount, expense_time, comment } = req.body;

        if (!amount || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
            return res.status(400).json({ success: false, error: 'Сумма должна быть положительным числом.' });
        }
        if (!expense_time) { // Дата обязательна
            return res.status(400).json({ success: false, error: 'Дата расхода обязательна.' });
        }

        // Преобразование amount в числовой тип, если оно приходит как строка
        const numericAmount = parseFloat(amount);

        const resultDb = await pool.query(
            `INSERT INTO expenses (user_id, amount, expense_time, comment)
             VALUES ($1, $2, $3, $4) RETURNING *`,
            [userId, numericAmount, expense_time, comment || ''] // comment может быть пустым
        );
        res.status(201).json({ success: true, expense: resultDb.rows[0] }); // Статус 201 Created
    } catch (err) {
        console.error("Ошибка в POST /api/expenses:", err);
        res.status(500).json({ success: false, error: 'Ошибка сервера при добавлении расхода' });
    }
});

// Удалить расход --- НОВЫЙ ЭНДПОИНТ ---
router.delete('/:expenseId', authMiddleware, async (req, res) => {
    try {
        const userId = req.user.userId;
        const { expenseId } = req.params;

        if (isNaN(parseInt(expenseId))) {
            return res.status(400).json({ success: false, error: 'Некорректный ID расхода.' });
        }

        const deleteResult = await pool.query(
            'DELETE FROM expenses WHERE id = $1 AND user_id = $2 RETURNING id',
            [expenseId, userId]
        );

        if (deleteResult.rowCount === 0) {
            // Это может означать, что расход с таким ID не найден или не принадлежит пользователю
            return res.status(404).json({ success: false, error: 'Расход не найден или у вас нет прав на его удаление.' });
        }

        res.json({ success: true, message: 'Расход успешно удален', deletedId: expenseId });
    } catch (err) {
        console.error("Ошибка в DELETE /api/expenses/:expenseId:", err);
        res.status(500).json({ success: false, error: 'Ошибка сервера при удалении расхода' });
    }
});

module.exports = router;