// backend/routes/transactions.js
const path = require('path');
const envPath = process.env.NODE_ENV === 'development' ? '.env.development' : '.env';
require('dotenv').config({ path: path.resolve(__dirname, `../${envPath}`) });
const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const pool = require('../db');
const moment = require('moment-timezone');
const { sendErrorToAdmin } = require('../utils/adminErrorNotifier'); // <--- НОВЫЙ ИМПОРТ
const { getFinancialSummary } = require('../utils/financials');

const TIMEZONE = 'Europe/Moscow';

// --- Aggregating endpoint for Dashboard ---
// --- Aggregating endpoint for Dashboard ---
router.get('/stats', authMiddleware, async (req, res) => {
    const userId = req.user.userId;
    let { from, to } = req.query;
    try {
        let dateFrom, dateTo;

        if (from && to && moment(from, 'YYYY-MM-DD', true).isValid() && moment(to, 'YYYY-MM-DD', true).isValid()) {
            dateFrom = moment.tz(from, TIMEZONE).startOf('day').format('YYYY-MM-DD HH:mm:ss');
            dateTo = moment.tz(to, TIMEZONE).endOf('day').format('YYYY-MM-DD HH:mm:ss');
        } else {
            const todayMoscow = moment().tz(TIMEZONE);
            dateFrom = todayMoscow.clone().startOf('month').format('YYYY-MM-DD HH:mm:ss');
            dateTo = todayMoscow.endOf('month').format('YYYY-MM-DD HH:mm:ss');
        }
        
        // ИСПОЛЬЗУЕМ НОВУЮ УТИЛИТУ
        const summary = await getFinancialSummary(userId, dateFrom, dateTo);

        // Формируем ответ для старого контракта, чтобы фронтенд не сломался
        res.json({
            success: true,
            stats: {
                revenue: summary.revenue,
                salesCount: summary.salesCount,
                expensesSum: summary.expensesSum,
            }
        });
    } catch (err) {
        console.error(`[GET /api/transactions/stats] UserID: ${userId} - Error:`, err);
        sendErrorToAdmin({
            userId: userId,
            errorContext: `GET /api/transactions/stats - UserID: ${userId}`,
            errorMessage: err.message,
            errorStack: err.stack,
            additionalInfo: { query: req.query }
        }).catch(notifyErr => console.error("Failed to send admin notification from GET /api/transactions/stats:", notifyErr));
        res.status(500).json({ success: false, error: 'Ошибка агрегирования статистики' });
    }
});

// Stats-endpoint by coffee shops
router.get('/coffee-stats', authMiddleware, async (req, res) => {
    const userId = req.user.userId;
    let { from, to } = req.query;
    try {
        console.log(`[GET /api/transactions/coffee-stats] UserID: ${userId}, Raw query params: from=${from}, to=${to}`);
        let dateFrom, dateTo;
        if (from && to && moment(from, 'YYYY-MM-DD', true).isValid() && moment(to, 'YYYY-MM-DD', true).isValid()) {
            dateFrom = moment.tz(from, TIMEZONE).startOf('day').format('YYYY-MM-DD HH:mm:ss');
            dateTo = moment.tz(to, TIMEZONE).endOf('day').format('YYYY-MM-DD HH:mm:ss');
        } else {
            console.log(`[GET /api/transactions/coffee-stats] Invalid or missing date params, defaulting to current month in ${TIMEZONE}`);
            const todayMoscow = moment().tz(TIMEZONE);
            dateFrom = todayMoscow.clone().startOf('month').format('YYYY-MM-DD HH:mm:ss');
            dateTo = todayMoscow.endOf('month').format('YYYY-MM-DD HH:mm:ss');
        }
        console.log(`[GET /api/transactions/coffee-stats] SQL Date Range: from='${dateFrom}', to='${dateTo}'`);

        const result = await pool.query(`
            SELECT 
                coffee_shop_id,
                MAX(terminal_comment) AS terminal_comment,
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
        console.error(`[GET /api/transactions/coffee-stats] UserID: ${userId} - Error:`, err);
        sendErrorToAdmin({
            userId: userId,
            errorContext: `GET /api/transactions/coffee-stats - UserID: ${userId}`,
            errorMessage: err.message,
            errorStack: err.stack,
            additionalInfo: { query: req.query }
        }).catch(notifyErr => console.error("Failed to send admin notification from GET /api/transactions/coffee-stats:", notifyErr));
        res.status(500).json({ success: false, error: 'Ошибка агрегации по кофеточкам' });
    }
});

// Get all transactions (legacy or for detailed view)
router.get('/', authMiddleware, async (req, res) => {
    const userId = req.user.userId;
    try {
        const result = await pool.query(
            'SELECT * FROM transactions WHERE user_id = $1 ORDER BY transaction_time DESC',
            [userId]
        );
        res.json({ success: true, transactions: result.rows });
    } catch (err) {
        console.error(`[GET /api/transactions/] UserID: ${userId} - Error:`, err);
        sendErrorToAdmin({
            userId: userId,
            errorContext: `GET /api/transactions/ - UserID: ${userId}`,
            errorMessage: err.message,
            errorStack: err.stack
        }).catch(notifyErr => console.error("Failed to send admin notification from GET /api/transactions/:", notifyErr));
        res.status(500).json({ success: false, error: 'Ошибка сервера при получении транзакций' });
    }
});

// POST transaction (example for manual addition)
router.post('/', authMiddleware, async (req, res) => {
    const userId = req.user.userId;
    try {
        const {
            coffee_shop_id, amount, transaction_time, result: tr_result, 
            reverse_id, terminal_comment, card_number, status,
            bonus, left_sum, left_bonus, machine_item_id
        } = req.body;

        const resultDb = await pool.query(
            `INSERT INTO transactions (
                user_id, coffee_shop_id, amount, transaction_time, result, reverse_id, 
                terminal_comment, card_number, status, bonus, left_sum, left_bonus, machine_item_id, last_updated_at
            ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW()
            ) RETURNING *`,
            [
                userId, coffee_shop_id, amount, transaction_time, tr_result,
                reverse_id, terminal_comment, card_number, status,
                bonus, left_sum, left_bonus, machine_item_id
            ]
        );
        res.status(201).json({ success: true, transaction: resultDb.rows[0] });
    } catch (err) {
        console.error(`[POST /api/transactions/] UserID: ${userId} - Error:`, err);
        sendErrorToAdmin({
            userId: userId,
            errorContext: `POST /api/transactions/ - UserID: ${userId}`,
            errorMessage: err.message,
            errorStack: err.stack,
            additionalInfo: { body: req.body }
        }).catch(notifyErr => console.error("Failed to send admin notification from POST /api/transactions/:", notifyErr));
        res.status(500).json({ success: false, error: 'Ошибка сервера при добавлении транзакции' });
    }
});

module.exports = router;