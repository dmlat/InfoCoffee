// backend/db.js
const { Pool } = require('pg');
const path = require('path');

// Определяем, какой .env файл использовать - эта логика теперь централизована в app.js
// const envPath = process.env.NODE_ENV === 'development'
//   ? path.resolve(__dirname, '.env.development')
//   : path.resolve(__dirname, '.env');
// require('dotenv').config({ path: envPath });

console.log('[DB.JS] Starting database initialization...');

const isProduction = process.env.NODE_ENV === 'production';

console.log('[DB.JS] Creating PostgreSQL pool with config:');
console.log(`[DB.JS] Host: ${process.env.PGHOST}`);
console.log(`[DB.JS] Database: ${process.env.PGDATABASE}`);
console.log(`[DB.JS] User: ${process.env.PGUSER}`);
console.log(`[DB.JS] Port: ${process.env.PGPORT}`);
console.log(`[DB.JS] SSL: ${isProduction ? 'enabled' : 'disabled'}`);

const pool = new Pool({
  user: process.env.PGUSER,
  host: process.env.PGHOST,
  database: process.env.PGDATABASE,
  password: process.env.PGPASSWORD,
  port: process.env.PGPORT,
  ssl: isProduction ? { rejectUnauthorized: false } : false,
});

console.log('[DB.JS] PostgreSQL pool created successfully');

console.log('[DB.JS] Exporting database module...');

module.exports = {
  // Этот метод query используется для одиночных запросов, 
  // пул сам управляет созданием и освобождением клиентов.
  query: (text, params) => pool.query(text, params),
  // Экспортируем сам пул для случаев, когда нужна транзакция (ручное управление клиентом)
  pool,
};

console.log('[DB.JS] Database module exported successfully');