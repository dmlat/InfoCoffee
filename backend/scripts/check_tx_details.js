// backend/scripts/check_tx_details.js
require('../utils/envLoader');
const { pool } = require('../db');

async function check() {
    try {
        console.log('Checking transaction 2175711248...');
        const res = await pool.query(`
            SELECT * FROM transactions WHERE id = 2175711248
        `);
        console.log(res.rows[0]);
    } catch (e) {
        console.error(e);
    } finally {
        process.exit();
    }
}

check();

