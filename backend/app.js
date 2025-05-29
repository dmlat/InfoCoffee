// backend/app.js
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') }); // Убедись, что .env в корне проекта VA/
const express = require('express');
const cors = require('cors');
const pool = require('./db'); // db.js
const authRoutes = require('./routes/auth'); // routes/auth.js
const profileRoutes = require('./routes/profile'); // routes/profile.js
const transactionsRoutes = require('./routes/transactions'); // routes/transactions.js
const expensesRoutes = require('./routes/expenses'); // routes/expenses.js

const app = express();

app.use(cors());
app.use(express.json());

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/transactions', transactionsRoutes);
app.use('/api/expenses', expensesRoutes);

// Старый /api/vendista роут больше не нужен, т.к. его функционал переехал в /api/auth
// Если у тебя были другие утилитарные функции в routes/vendista.js, их нужно пересмотреть.

// DB Connection Test Endpoint
app.get('/api/test-db', async (req, res) => {
  try {
    const result = await pool.query('SELECT NOW()');
    res.json({ success: true, time: result.rows[0].now });
  } catch (err) {
    console.error("Error in /api/test-db:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Backend server started on port ${PORT}`);
});