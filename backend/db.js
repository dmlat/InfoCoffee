// backend/db.js
const path = require('path');

// Определяем, какой .env файл использовать
const envPath = process.env.NODE_ENV === 'development'
  ? path.resolve(__dirname, '.env.development')
  : path.resolve(__dirname, '.env');
  
require('dotenv').config({ path: envPath });

const { Pool } = require('pg');

const connectionOptions = {
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
};

if (process.env.DATABASE_URL) {
    connectionOptions.connectionString = process.env.DATABASE_URL;
} else {
    connectionOptions.user = process.env.PGUSER;
    connectionOptions.host = process.env.PGHOST;
    connectionOptions.database = process.env.PGDATABASE;
    connectionOptions.password = process.env.PGPASSWORD;
    connectionOptions.port = process.env.PGPORT;
}

const pool = new Pool(connectionOptions);

module.exports = {
  // Этот метод query используется для одиночных запросов, 
  // пул сам управляет созданием и освобождением клиентов.
  query: (text, params) => pool.query(text, params),
  // Экспортируем сам пул для случаев, когда нужна транзакция (ручное управление клиентом)
  pool,
};