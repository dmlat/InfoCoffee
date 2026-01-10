// backend/scripts/check_stats.js
require('../utils/envLoader');
const { pool } = require('../db');

async function check() {
    try {
        console.log('Checking User 1 stats since Jan 1 2026...');
        const res = await pool.query(`
            SELECT user_id, COUNT(*) as count, SUM(amount) as sum
            FROM transactions 
            GROUP BY user_id
        `);
        
        console.log('--- RESULT BY USER ---');
        res.rows.forEach(row => {
            console.log(`User ID: ${row.user_id}, Count: ${row.count}, Sum: ${row.sum}`);
        });
        
    } catch (e) {
        console.error(e);
    } finally {
        process.exit();
    }
}

check();

