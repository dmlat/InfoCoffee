// backend/routes/expenses.js
const path = require('path');
const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const pool = require('../db');
const { sendErrorToAdmin } = require('../utils/adminErrorNotifier'); // <--- НОВЫЙ ИМПОРТ

// Получить все расходы пользователя
router.get('/', authMiddleware, async (req, res) => {
    const userId = req.user.userId; // req.user должен устанавливаться в authMiddleware
    try {
        const result = await pool.query(
            'SELECT * FROM expenses WHERE user_id = $1 ORDER BY expense_time DESC, id DESC',
            [userId]
        );
        res.json({ success: true, expenses: result.rows });
    } catch (err) {
        console.error(`[GET /api/expenses] UserID: ${userId} - Error:`, err);
        // Отправляем уведомление администратору
        sendErrorToAdmin({
            userId: userId,
            errorContext: `GET /api/expenses - UserID: ${userId}`,
            errorMessage: err.message,
            errorStack: err.stack
        }).catch(notifyErr => console.error("Failed to send admin notification from GET /api/expenses:", notifyErr));
        res.status(500).json({ success: false, error: 'Ошибка сервера при получении расходов' });
    }
});

// Добавить расход
router.post('/', authMiddleware, async (req, res) => {
    const userId = req.user.userId;
    const { amount, expense_time, comment } = req.body;
    try {
        if (!amount || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
            return res.status(400).json({ success: false, error: 'Сумма должна быть положительным числом.' });
        }
        if (!expense_time) { 
            return res.status(400).json({ success: false, error: 'Дата расхода обязательна.' });
        }

        const numericAmount = parseFloat(amount);

        const resultDb = await pool.query(
            `INSERT INTO expenses (user_id, amount, expense_time, comment)
             VALUES ($1, $2, $3, $4) RETURNING *`,
            [userId, numericAmount, expense_time, comment || '']
        );
        res.status(201).json({ success: true, expense: resultDb.rows[0] });
    } catch (err) {
        console.error(`[POST /api/expenses] UserID: ${userId} - Error:`, err);
        sendErrorToAdmin({
            userId: userId,
            errorContext: `POST /api/expenses - UserID: ${userId}`,
            errorMessage: err.message,
            errorStack: err.stack,
            additionalInfo: { body: req.body }
        }).catch(notifyErr => console.error("Failed to send admin notification from POST /api/expenses:", notifyErr));
        res.status(500).json({ success: false, error: 'Ошибка сервера при добавлении расхода' });
    }
});

// Удалить расход
router.delete('/:expenseId', authMiddleware, async (req, res) => {
    const userId = req.user.userId;
    const { expenseId } = req.params;
    try {
        if (isNaN(parseInt(expenseId))) {
            return res.status(400).json({ success: false, error: 'Некорректный ID расхода.' });
        }

        const deleteResult = await pool.query(
            'DELETE FROM expenses WHERE id = $1 AND user_id = $2 RETURNING id',
            [expenseId, userId]
        );

        if (deleteResult.rowCount === 0) {
            return res.status(404).json({ success: false, error: 'Расход не найден или у вас нет прав на его удаление.' });
        }

        res.json({ success: true, message: 'Расход успешно удален', deletedId: expenseId });
    } catch (err) {
        console.error(`[DELETE /api/expenses/:expenseId] UserID: ${userId}, ExpenseID: ${expenseId} - Error:`, err);
        sendErrorToAdmin({
            userId: userId,
            errorContext: `DELETE /api/expenses/:expenseId - UserID: ${userId}, ExpenseID: ${expenseId}`,
            errorMessage: err.message,
            errorStack: err.stack
        }).catch(notifyErr => console.error("Failed to send admin notification from DELETE /api/expenses:", notifyErr));
        res.status(500).json({ success: false, error: 'Ошибка сервера при удалении расхода' });
    }
});

module.exports = router;