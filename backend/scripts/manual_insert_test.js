// backend/scripts/manual_insert_test.js
require('../utils/envLoader');
const { pool } = require('../db');

async function test() {
    try {
        console.log('Testing manual insert...');
        await pool.query(`
            INSERT INTO transactions (id, user_id, amount, transaction_time) 
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (id) DO UPDATE SET amount = EXCLUDED.amount
        `, ['2175711248', 1, 20000, '2026-01-01 09:35:47.449']);
        console.log('✅ Insert successful!');
    } catch (e) {
        console.error('❌ Insert failed:', e);
    } finally {
        process.exit();
    }
}

test();

