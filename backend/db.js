const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') }); 
const { Pool } = require('pg');

// Если у тебя есть переменная DATABASE_URL — используй её, иначе бери отдельные переменные
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

// Единая точка для запросов!
module.exports = {
  query: (text, params) => pool.query(text, params),
  pool,
};
