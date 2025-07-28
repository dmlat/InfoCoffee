// backend/routes/transactions.js
const path = require('path');
const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const db = require('../db');
const moment = require('moment-timezone');
const { sendErrorToAdmin } = require('../utils/adminErrorNotifier'); // <--- НОВЫЙ ИМПОРТ
const { getFinancialSummary } = require('../utils/financials');

const TIMEZONE = 'Europe/Moscow';

// --- Aggregating endpoint for Dashboard ---
// --- Aggregating endpoint for Dashboard ---
router.get('/stats', authMiddleware, async (req, res) => {
    const { ownerUserId, telegramId } = req.user;
    const { from, to } = req.query;
    console.log(`[GET /api/transactions/stats] ActorTG: ${telegramId}, OwnerID: ${ownerUserId} - Fetching dashboard stats.`);
    try {
        let dateFrom, dateTo;

        if (from && to && moment(from, 'YYYY-MM-DD', true).isValid() && moment(to, 'YYYY-MM-DD', true).isValid()) {
            dateFrom = moment.tz(from, TIMEZONE).startOf('day').toISOString();
            dateTo = moment.tz(to, TIMEZONE).endOf('day').toISOString();
        } else {
            const todayMoscow = moment().tz(TIMEZONE);
            dateFrom = todayMoscow.clone().startOf('month').toISOString();
            dateTo = todayMoscow.endOf('month').toISOString();
        }
        
        // ИСПОЛЬЗУЕМ НОВУЮ УТИЛИТУ
        const summary = await getFinancialSummary(ownerUserId, dateFrom, dateTo);

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
        console.error(`[GET /api/transactions/stats] UserID: ${ownerUserId} - Error:`, err);
        sendErrorToAdmin({
            userId: ownerUserId,
            errorContext: `GET /api/transactions/stats - UserID: ${ownerUserId}`,
            errorMessage: err.message,
            errorStack: err.stack,
            additionalInfo: { query: req.query }
        }).catch(notifyErr => console.error("Failed to send admin notification from GET /api/transactions/stats:", notifyErr));
        res.status(500).json({ success: false, error: 'Ошибка агрегирования статистики' });
    }
});

// Stats-endpoint by coffee shops
router.get('/coffee-stats', authMiddleware, async (req, res) => {
    const { ownerUserId, telegramId } = req.user;
    let { from, to } = req.query;
    console.log(`[GET /api/transactions/coffee-stats] ActorTG: ${telegramId}, OwnerID: ${ownerUserId} - Raw query params: from=${from}, to=${to}`);
    try {
        console.log(`[GET /api/transactions/coffee-stats] UserID: ${ownerUserId}, Raw query params: from=${from}, to=${to}`);
        let dateFrom, dateTo;
        if (from && to && moment(from, 'YYYY-MM-DD', true).isValid() && moment(to, 'YYYY-MM-DD', true).isValid()) {
            dateFrom = moment.tz(from, TIMEZONE).startOf('day').toISOString();
            dateTo = moment.tz(to, TIMEZONE).endOf('day').toISOString();
        } else {
            console.log(`[GET /api/transactions/coffee-stats] Invalid or missing date params, defaulting to current month in ${TIMEZONE}`);
            const todayMoscow = moment().tz(TIMEZONE);
            dateFrom = todayMoscow.clone().startOf('month').toISOString();
            dateTo = todayMoscow.endOf('month').toISOString();
        }
        console.log(`[GET /api/transactions/coffee-stats] SQL Date Range: from='${dateFrom}', to='${dateTo}'`);

        const result = await db.query(`
            SELECT 
                t.vendista_terminal_id as coffee_shop_id,
                t.name as terminal_comment,
                COUNT(tr.id) FILTER (WHERE tr.result = '1' AND tr.reverse_id = 0) as sales_count,
                COALESCE(SUM(tr.amount) FILTER (WHERE tr.result = '1' AND tr.reverse_id = 0), 0) / 100 as revenue
            FROM terminals t
            LEFT JOIN transactions tr ON t.vendista_terminal_id = tr.coffee_shop_id AND t.user_id = tr.user_id
                AND tr.transaction_time >= $2 AND tr.transaction_time <= $3
            WHERE t.user_id = $1 AND t.is_active = true
            GROUP BY t.id, t.name, t.vendista_terminal_id
            ORDER BY revenue DESC
        `, [ownerUserId, dateFrom, dateTo]);
        res.json({ success: true, stats: result.rows });
    } catch (err) {
        console.error(`[GET /api/transactions/coffee-stats] UserID: ${ownerUserId} - Error:`, err);
        sendErrorToAdmin({
            userId: ownerUserId,
            errorContext: `GET /api/transactions/coffee-stats - UserID: ${ownerUserId}`,
            errorMessage: err.message,
            errorStack: err.stack,
            additionalInfo: { query: req.query }
        }).catch(notifyErr => console.error("Failed to send admin notification from GET /api/transactions/coffee-stats:", notifyErr));
        res.status(500).json({ success: false, error: 'Ошибка агрегации по кофеточкам' });
    }
});

// Get all transactions (legacy or for detailed view)
router.get('/', authMiddleware, async (req, res) => {
    const { ownerUserId, telegramId } = req.user;
    let { dateFrom, dateTo, terminalId } = req.query;

    console.log(`[GET /api/transactions] ActorTG: ${telegramId}, OwnerID: ${ownerUserId} - Fetching transactions from ${dateFrom} to ${dateTo}, TerminalID: ${terminalId || 'All'}.`);

    if (!dateFrom || !dateTo) {
        return res.status(400).json({ success: false, error: 'Date range is required.' });
    }

    try {
        let query = `
            SELECT 
                t.id, t.user_id, t.coffee_shop_id, t.amount, t.transaction_time, t.result, t.reverse_id, 
                t.terminal_comment, t.card_number, t.status, t.bonus, t.left_sum, t.left_bonus, t.machine_item_id,
                t.last_updated_at
            FROM transactions t
            WHERE t.user_id = $1
              AND t.transaction_time >= $2 AND t.transaction_time <= $3
        `;
        const queryParams = [ownerUserId, dateFrom, dateTo];

        if (terminalId) {
            query += ` AND t.coffee_shop_id = $${queryParams.length + 1}`;
            queryParams.push(terminalId);
        }

        query += ' ORDER BY t.transaction_time DESC';

        const result = await db.query(query, queryParams);
        res.json({ success: true, transactions: result.rows });
    } catch (err) {
        console.error(`[GET /api/transactions] OwnerID: ${ownerUserId} - Error:`, err);
        sendErrorToAdmin({
            userId: ownerUserId,
            errorContext: `GET /api/transactions - OwnerID: ${ownerUserId}`,
            errorMessage: err.message,
            errorStack: err.stack,
            additionalInfo: { query: req.query }
        }).catch(console.error);
        res.status(500).json({ success: false, error: 'Server error fetching transactions.' });
    }
});

// POST transaction (example for manual addition)
router.post('/', authMiddleware, async (req, res) => {
    const { ownerUserId, telegramId } = req.user;
    console.log(`[POST /api/transactions] ActorTG: ${telegramId}, OwnerID: ${ownerUserId} - Manually adding transaction.`);
    try {
        const {
            coffee_shop_id, amount, transaction_time, result: tr_result, 
            reverse_id, terminal_comment, card_number, status,
            bonus, left_sum, left_bonus, machine_item_id
        } = req.body;

        const resultDb = await db.query(
            `INSERT INTO transactions (
                user_id, coffee_shop_id, amount, transaction_time, result, reverse_id, 
                terminal_comment, card_number, status, bonus, left_sum, left_bonus, machine_item_id, last_updated_at
            ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW()
            ) RETURNING *`,
            [
                ownerUserId, coffee_shop_id, amount, transaction_time, tr_result,
                reverse_id, terminal_comment, card_number, status,
                bonus, left_sum, left_bonus, machine_item_id
            ]
        );
        res.status(201).json({ success: true, transaction: resultDb.rows[0] });
    } catch (err) {
        console.error(`[POST /api/transactions/] UserID: ${ownerUserId} - Error:`, err);
        sendErrorToAdmin({
            userId: ownerUserId,
            errorContext: `POST /api/transactions/ - UserID: ${ownerUserId}`,
            errorMessage: err.message,
            errorStack: err.stack,
            additionalInfo: { body: req.body }
        }).catch(notifyErr => console.error("Failed to send admin notification from POST /api/transactions/:", notifyErr));
        res.status(500).json({ success: false, error: 'Ошибка сервера при добавлении транзакции' });
    }
});

module.exports = router;