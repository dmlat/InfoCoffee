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

/**
 * РАБОЧИЙ И НАДЕЖНЫЙ СПОСОБ ЛОГИРОВАНИЯ
 * * Мы подписываемся на событие 'connect', которое пул генерирует
 * каждый раз, когда создает нового клиента для выполнения запроса.
 * После получения клиента, мы "патчим" только его метод query,
 * добавляя логирование. Это безопасно и не мешает внутренним механизмам pg.
 */
pool.on('connect', (client) => {
    const originalClientQuery = client.query;
    client.query = (text, params, callback) => {
        console.log('--- [DB] EXECUTING QUERY ---');
        console.log('Query:', text);
        if (params) {
          console.log('Params:', params);
        }
        console.log('---------------------------');
        return originalClientQuery.call(client, text, params, callback);
    };
});


module.exports = {
  // Этот метод query используется для одиночных запросов, 
  // пул сам управляет созданием и освобождением клиентов.
  query: (text, params) => {
    return pool.query(text, params);
  },
  // Экспортируем сам пул для случаев, когда нужна транзакция (ручное управление клиентом)
  pool,
};