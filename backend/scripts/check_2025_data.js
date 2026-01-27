// backend/scripts/check_2025_data.js
require('../utils/envLoader');
const { pool } = require('../db');

async function check() {
    console.log('Checking transactions for 2025...');
    try {
        const res = await pool.query(`
            SELECT 
                TO_CHAR(transaction_time, 'YYYY-MM') as month, 
                COUNT(*) as count, 
                SUM(amount) as sum
            FROM transactions 
            WHERE transaction_time >= '2025-09-01' AND transaction_time < '2026-01-01'
            GROUP BY 1 
            ORDER BY 1
        `);
        console.table(res.rows);
        
        const totalRes = await pool.query('SELECT COUNT(*) FROM transactions');
        console.log('Total transactions in DB:', totalRes.rows[0].count);

    } catch (error) {
        console.error(error);
    } finally {
        pool.end();
    }
}

check();


