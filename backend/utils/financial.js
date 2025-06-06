// backend/utils/financials.js
const pool = require('../db');

/**
 * Рассчитывает финансовую сводку для пользователя за указанный период.
 * @param {number} userId - ID пользователя (владельца).
 * @param {string} dateFrom - Начальная дата в формате 'YYYY-MM-DD HH:mm:ss'.
 * @param {string} dateTo - Конечная дата в формате 'YYYY-MM-DD HH:mm:ss'.
 * @returns {Promise<object>} Объект со статистикой.
 */
async function getFinancialSummary(userId, dateFrom, dateTo) {
    const userResult = await pool.query(
        'SELECT acquiring, tax_system FROM users WHERE id = $1',
        [userId]
    );
    const userSettings = userResult.rows[0] || { acquiring: 0, tax_system: null };

    const trRes = await pool.query(
        `SELECT COUNT(*) as sales_count, COALESCE(SUM(amount), 0) as revenue_cents
         FROM transactions
         WHERE user_id = $1 AND result = '1' AND reverse_id = 0
           AND transaction_time >= $2 AND transaction_time <= $3`,
        [userId, dateFrom, dateTo]
    );

    const expRes = await pool.query(
        `SELECT COALESCE(SUM(amount), 0) as expenses_sum 
         FROM expenses
         WHERE user_id = $1 AND expense_time >= $2 AND expense_time <= $3`,
        [userId, dateFrom, dateTo]
    );
    
    const revenue = Number(trRes.rows[0].revenue_cents) / 100;
    const salesCount = Number(trRes.rows[0].sales_count);
    const expensesSum = Number(expRes.rows[0].expenses_sum);
    
    const acquiringRate = parseFloat(userSettings.acquiring || 0) / 100;
    const acquiringCost = revenue * acquiringRate;
    const revenueAfterAcquiring = revenue - acquiringCost;

    let taxBase = 0;
    let taxRate = 0;
    if (userSettings.tax_system === 'income_6') {
        taxRate = 0.06;
        taxBase = revenueAfterAcquiring;
    } else if (userSettings.tax_system === 'income_expense_15') {
        taxRate = 0.15;
        taxBase = Math.max(0, revenueAfterAcquiring - expensesSum);
    }
    
    const taxCost = Math.max(0, taxBase) * taxRate;
    const netProfit = revenueAfterAcquiring - expensesSum - taxCost;

    return {
        salesCount: salesCount,
        revenue: revenue,
        expensesSum: expensesSum,
        acquiringCost: acquiringCost,
        revenueAfterAcquiring: revenueAfterAcquiring,
        taxCost: taxCost,
        netProfit: netProfit
    };
}

module.exports = { getFinancialSummary };