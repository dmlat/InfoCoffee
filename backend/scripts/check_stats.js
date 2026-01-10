// backend/scripts/check_stats.js
require('../utils/envLoader');
const { pool } = require('../db');

async function check() {
    try {
        console.log('Checking User 1 stats since Jan 1 2026...');
        const res = await pool.query(`
            SELECT 
                COUNT(*) as count, 
                SUM(amount) as total_sum_raw 
            FROM transactions 
            WHERE user_id = 1 AND transaction_time >= '2026-01-01'
        `);
        
        const row = res.rows[0];
        console.log('--- RESULT ---');
        console.log(`Count: ${row.count}`);
        console.log(`Total Sum (Raw in DB): ${row.total_sum_raw}`);
        console.log(`Total Sum (Rubles / 100): ${row.total_sum_raw / 100}`);
        
    } catch (e) {
        console.error(e);
    } finally {
        process.exit();
    }
}

check();

