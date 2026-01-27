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
    try {
        let dateFrom, dateTo;
        
        try {
            if (!from || !to) {
                const now = moment().tz(TIMEZONE);
                dateFrom = now.startOf('month').toISOString();
                dateTo = now.endOf('month').toISOString();
            } else {
                dateFrom = moment.tz(from, TIMEZONE).startOf('day').toISOString();
                dateTo = moment.tz(to, TIMEZONE).endOf('day').toISOString();
            }
        } catch (dateError) {
            console.error('[GET /api/transactions/coffee-stats] Date parsing error:', dateError);
            res.status(400).json({ success: false, error: 'Неверный формат даты' });
            return;
        }

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

// Stats-endpoint by drinks with per-terminal breakdown
router.get('/drink-stats', authMiddleware, async (req, res) => {
    const { ownerUserId } = req.user;
    let { from, to } = req.query;
    try {
        let dateFrom;
        let dateTo;

        try {
            if (!from || !to) {
                const now = moment().tz(TIMEZONE);
                dateFrom = now.startOf('month').toISOString();
                dateTo = now.endOf('month').toISOString();
            } else {
                dateFrom = moment.tz(from, TIMEZONE).startOf('day').toISOString();
                dateTo = moment.tz(to, TIMEZONE).endOf('day').toISOString();
            }
        } catch (dateError) {
            console.error('[GET /api/transactions/drink-stats] Date parsing error:', dateError);
            res.status(400).json({ success: false, error: 'Неверный формат даты' });
            return;
        }

        const result = await db.query(`
            SELECT
                tr.machine_item_id,
                t.id as terminal_id,
                t.name as terminal_name,
                r.name as recipe_name,
                COUNT(tr.id) FILTER (WHERE tr.result = '1' AND tr.reverse_id = 0) as sales_count
            FROM transactions tr
            JOIN terminals t
                ON t.vendista_terminal_id = tr.coffee_shop_id
                AND t.user_id = tr.user_id
            LEFT JOIN recipes r
                ON r.terminal_id = t.id
                AND r.machine_item_id = tr.machine_item_id
            WHERE tr.user_id = $1
              AND tr.transaction_time >= $2 AND tr.transaction_time <= $3
              AND tr.machine_item_id IS NOT NULL
            GROUP BY tr.machine_item_id, t.id, t.name, r.name
        `, [ownerUserId, dateFrom, dateTo]);

        const grouped = new Map();
        result.rows.forEach(row => {
            const machineItemId = row.machine_item_id;
            const safeName = row.recipe_name || `Напиток #${machineItemId}`;
            if (!grouped.has(machineItemId)) {
                grouped.set(machineItemId, {
                    machine_item_id: machineItemId,
                    display_name: safeName,
                    total_count: 0,
                    name_variants: new Set(),
                    terminals: []
                });
            }
            const entry = grouped.get(machineItemId);
            const count = Number(row.sales_count) || 0;
            entry.total_count += count;
            entry.name_variants.add(safeName);
            entry.terminals.push({
                terminal_id: row.terminal_id,
                terminal_name: row.terminal_name,
                recipe_name: safeName,
                sales_count: count
            });
        });

        const data = Array.from(grouped.values()).map(item => {
            const hasMultipleNames = item.name_variants.size > 1;
            return {
                machine_item_id: item.machine_item_id,
                display_name: hasMultipleNames ? 'Смешанные названия' : item.display_name,
                total_count: item.total_count,
                terminals: item.terminals.sort((a, b) => b.sales_count - a.sales_count)
            };
        }).sort((a, b) => b.total_count - a.total_count);

        res.json({ success: true, stats: data });
    } catch (err) {
        console.error(`[GET /api/transactions/drink-stats] UserID: ${ownerUserId} - Error:`, err);
        sendErrorToAdmin({
            userId: ownerUserId,
            errorContext: `GET /api/transactions/drink-stats - UserID: ${ownerUserId}`,
            errorMessage: err.message,
            errorStack: err.stack,
            additionalInfo: { query: req.query }
        }).catch(notifyErr => console.error("Failed to send admin notification from GET /api/transactions/drink-stats:", notifyErr));
        res.status(500).json({ success: false, error: 'Ошибка агрегации по напиткам' });
    }
});

// Get all transactions (legacy or for detailed view)
router.get('/', authMiddleware, async (req, res) => {
    const { ownerUserId, telegramId } = req.user;
    let { dateFrom, dateTo, terminalId } = req.query;

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