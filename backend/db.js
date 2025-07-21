// backend/db.js
const path = require('path');

// Определяем, какой .env файл использовать
// const envPath = process.env.NODE_ENV === 'development'
//   ? path.resolve(__dirname, '.env.development')
//   : path.resolve(__dirname, '.env');
  
// require('dotenv').config({ path: envPath }); // <-- УДАЛЯЕМ ЭТУ СТРОКУ

const { Pool } = require('pg');

const pool = new Pool({
  user: process.env.PGUSER,
  host: process.env.PGHOST,
  database: process.env.PGDATABASE,
  password: process.env.PGPASSWORD,
  port: process.env.PGPORT,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

module.exports = {
  // Этот метод query используется для одиночных запросов, 
  // пул сам управляет созданием и освобождением клиентов.
  query: (text, params) => pool.query(text, params),
  // Экспортируем сам пул для случаев, когда нужна транзакция (ручное управление клиентом)
  pool,
};