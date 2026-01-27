// backend/scripts/check_encoding.js
require('../utils/envLoader');
const { pool } = require('../db');

async function checkEncoding() {
    console.log('Checking text encoding in DB...');
    try {
        console.log('--- Terminal Names ---');
        // Try 'terminals' table first, as it's the most likely name based on API route
        const termRes = await pool.query('SELECT name FROM terminals LIMIT 3');
        console.log(termRes.rows);

        console.log('--- Product Names ---');
        const itemRes = await pool.query('SELECT name FROM machine_items LIMIT 3');
        console.log(itemRes.rows);
    } catch (error) {
        console.error('Error:', error);
    } finally {
        pool.end();
    }
}

checkEncoding();

