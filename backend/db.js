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

// Перехватываем метод connect, чтобы обернуть каждый новый клиент
const originalConnect = pool.connect;
pool.connect = async function(...args) {
    const client = await originalConnect.apply(this, args);
    const originalClientQuery = client.query;
    client.query = (text, params) => {
        console.log('--- [TRANSACTION] EXECUTING QUERY ---');
        console.log('Query:', text);
        if (params) {
          console.log('Params:', params);
        }
        console.log('-----------------------------------');
        return originalClientQuery.apply(client, [text, params]);
    };
    return client;
};

module.exports = {
  query: (text, params) => {
    console.log('--- [POOL] EXECUTING QUERY ---');
    console.log('Query:', text);
    if (params) {
      console.log('Params:', params);
    }
    console.log('----------------------------');
    return pool.query(text, params);
  },
  pool,
};