// backend/db.js
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') }); 
const { Pool } = require('pg');

const pool = new Pool(
  process.env.DATABASE_URL
    ? { connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } }
    : {
        user: process.env.PGUSER,
        host: process.env.PGHOST,
        database: process.env.PGDATABASE,
        password: process.env.PGPASSWORD,
        port: process.env.PGPORT,
      }
);

module.exports = {
  // Этот метод query используется для одиночных запросов, 
  // пул сам управляет созданием и освобождением клиентов.
  query: (text, params) => {
    return pool.query(text, params);
  },
  // Экспортируем сам пул для случаев, когда нужна транзакция (ручное управление клиентом)
  pool,
};