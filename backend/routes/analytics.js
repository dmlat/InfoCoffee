const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const authMiddleware = require('../middleware/auth');
const moment = require('moment-timezone');

// Helper to validate and parse date range
const parseDateRange = (period, from, to) => {
    let dateFrom, dateTo;
    
    // Priority to custom dates if provided
    if (from && to && (!period || period === 'custom')) {
        return {
            dateFrom: moment(from),
            dateTo: moment(to)
        };
    }

    switch (period) {
        case 'week':
            dateFrom = moment().startOf('isoWeek');
            dateTo = moment().endOf('isoWeek');
            break;
        case 'month':
            dateFrom = moment().startOf('month');
            dateTo = moment().endOf('month');
            break;
        case 'year':
            dateFrom = moment().startOf('year');
            dateTo = moment().endOf('year');
            break;
        default:
            // Default to current month
            dateFrom = moment().startOf('month');
            dateTo = moment().endOf('month');
    }
    return { dateFrom, dateTo };
};

// GET /api/analytics/financials
router.get('/financials', authMiddleware, async (req, res) => {
    try {
        const { ownerUserId } = req.user;
        const { period, from, to, terminal_ids, group_by } = req.query;
        const { dateFrom, dateTo } = parseDateRange(period, from, to);

        // Filter by terminals if provided, otherwise all user's terminals
        let terminalFilter = '';
        const queryParams = [ownerUserId, dateFrom.format(), dateTo.format()];
        
        if (terminal_ids) {
            const ids = terminal_ids.split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id));
            if (ids.length > 0) {
                terminalFilter = `AND t.coffee_shop_id IN (SELECT vendista_terminal_id FROM terminals WHERE id = ANY($4::int[]) AND user_id = $1)`;
                queryParams.push(ids);
            }
        }

        let dateFormat = 'YYYY-MM-DD';
        if (group_by === 'week') dateFormat = 'YYYY-"W"IW'; // ISO Week like 2026-W01
        if (group_by === 'month') dateFormat = 'YYYY-MM';

        const splitByTerminal = req.query.split_by_terminal === 'true';

        let selectClause = `
            TO_CHAR(transaction_time AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Moscow', '${dateFormat}') as date,
            SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END) as revenue,
            SUM(CASE WHEN amount < 0 THEN ABS(amount) ELSE 0 END) as refunds,
            SUM(amount) as net_profit, 
            COUNT(CASE WHEN amount > 0 THEN 1 END) as sales_count
        `;
        let groupByClause = '1';

        if (splitByTerminal) {
            selectClause += `, t.coffee_shop_id`;
            groupByClause = '1, t.coffee_shop_id';
        }

        // Group by day for the chart
        const query = `
            SELECT ${selectClause}
            FROM transactions t
            WHERE t.user_id = $1 
              AND transaction_time AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Moscow' >= $2::date
              AND transaction_time AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Moscow' <= $3::date + interval '1 day' - interval '1 second'
              AND t.result = '1' AND t.reverse_id = 0
              ${terminalFilter}
            GROUP BY ${groupByClause}
            ORDER BY 1 ASC
        `;

        const result = await pool.query(query, queryParams);

        // Get totals
        const totalsQuery = `
            SELECT 
                SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END) as total_revenue,
                SUM(CASE WHEN amount < 0 THEN ABS(amount) ELSE 0 END) as total_refunds,
                COUNT(CASE WHEN amount > 0 THEN 1 END) as total_sales_count
            FROM transactions t
            WHERE t.user_id = $1 
              AND transaction_time AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Moscow' >= $2::date
              AND transaction_time AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Moscow' <= $3::date + interval '1 day' - interval '1 second'
              AND t.result = '1' AND t.reverse_id = 0
              ${terminalFilter}
        `;
        const totalsResult = await pool.query(totalsQuery, queryParams);

        res.json({
            success: true,
            chartData: result.rows,
            totals: totalsResult.rows[0]
        });

    } catch (error) {
        console.error('Error fetching financial analytics:', error);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// GET /api/analytics/sales (By Product)
router.get('/sales', authMiddleware, async (req, res) => {
    try {
        const { ownerUserId } = req.user;
        const { period, from, to, terminal_ids } = req.query;
        const { dateFrom, dateTo } = parseDateRange(period, from, to);

        let terminalFilter = '';
        const queryParams = [ownerUserId, dateFrom.format(), dateTo.format()];
        
        if (terminal_ids) {
            const ids = terminal_ids.split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id));
            if (ids.length > 0) {
                terminalFilter = `AND t.coffee_shop_id IN (SELECT vendista_terminal_id FROM terminals WHERE id = ANY($4::int[]) AND user_id = $1)`;
                queryParams.push(ids);
            }
        }

        // Join with recipes to get names. 
        // Note: machine_item_id in transactions corresponds to machine_item_id in recipes.
        // We need to pick a name. Since recipes are per-terminal, and we might be aggregating across terminals,
        // we'll pick the most common name for this machine_item_id across the user's terminals.
        
        const query = `
            SELECT 
                CASE WHEN t.amount = 0 THEN -1 ELSE t.machine_item_id END as machine_item_id,
                CASE 
                    WHEN t.amount = 0 THEN 'Бесплатные напитки'
                    ELSE COALESCE(
                        (SELECT name FROM recipes r 
                         WHERE r.machine_item_id = t.machine_item_id 
                           AND r.terminal_id IN (SELECT id FROM terminals WHERE user_id = $1) 
                         LIMIT 1), 
                        'Unknown Product ' || COALESCE(t.machine_item_id::text, 'N/A')
                    )
                END as product_name,
                COUNT(*) as count,
                SUM(amount) as revenue
            FROM transactions t
            WHERE t.user_id = $1 
              AND transaction_time AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Moscow' >= $2::date
              AND transaction_time AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Moscow' <= $3::date + interval '1 day' - interval '1 second'
              -- Include all valid transactions (paid and free)
              AND t.result = '1' AND t.reverse_id = 0
              ${terminalFilter}
            GROUP BY 1, 2
            ORDER BY count DESC
        `;

        const result = await pool.query(query, queryParams);

        res.json({
            success: true,
            salesData: result.rows
        });

    } catch (error) {
        console.error('Error fetching sales analytics:', error);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

module.exports = router;


