const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') }); 
const { Pool } = require('pg');

const pool = new Pool(
  process.env.DATABASE_URL
    ? { connectionString: process.env.DATABASE_URL }
    : {
        user: process.env.PGUSER,
        host: process.env.PGHOST,
        database: process.env.PGDATABASE,
        password: process.env.PGPASSWORD,
        port: process.env.PGPORT,
      }
);

// Временная обертка для логирования
const originalQuery = pool.query.bind(pool);
pool.query = (text, params) => {
  console.log('--- EXECUTING QUERY ---');
  console.log('Query:', text);
  if (params) {
    console.log('Params:', params);
  }
  console.log('-----------------------');
  return originalQuery(text, params);
};


module.exports = {
  query: (text, params) => pool.query(text, params),
  pool,
};