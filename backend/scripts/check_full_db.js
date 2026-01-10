// backend/scripts/check_full_db.js
require('../utils/envLoader');
const { pool } = require('../db');

async function check() {
    try {
        console.log('--- SCHEMAS ---');
        const schemas = await pool.query("SELECT schema_name FROM information_schema.schemata");
        console.log(schemas.rows.map(r => r.schema_name));

        console.log('--- TABLES (transactions) ---');
        const tables = await pool.query(`
            SELECT table_schema, table_name 
            FROM information_schema.tables 
            WHERE table_name = 'transactions'
        `);
        console.log(tables.rows);

        for (const t of tables.rows) {
            console.log(`Checking ${t.table_schema}.${t.table_name}...`);
            const count = await pool.query(`SELECT COUNT(*) as c FROM "${t.table_schema}"."${t.table_name}"`);
            console.log(`Count: ${count.rows[0].c}`);
            
            // Check sample ID
            const sample = await pool.query(`SELECT * FROM "${t.table_schema}"."${t.table_name}" WHERE id = 2175711248`);
            console.log(`Found sample ID 2175711248: ${sample.rows.length > 0 ? 'YES' : 'NO'}`);
        }

    } catch (e) {
        console.error(e);
    } finally {
        process.exit();
    }
}

check();

