// backend/app.js
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') }); 
const express = require('express');
const cors = require('cors');
const pool = require('./db'); // db.js
const authRoutes = require('./routes/auth');
const profileRoutes = require('./routes/profile');
const transactionsRoutes = require('./routes/transactions');
const expensesRoutes = require('./routes/expenses');
const accessRoutes = require('./routes/access');
const terminalsRoutes = require('./routes/terminals');
const recipesRoutes = require('./routes/recipes'); // <-- НОВЫЙ ИМПОРТ

const app = express();

app.use(cors());
app.use(express.json());

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/transactions', transactionsRoutes);
app.use('/api/expenses', expensesRoutes);
app.use('/api/access', accessRoutes);
app.use('/api/terminals', terminalsRoutes);
app.use('/api/recipes', recipesRoutes); // <-- НОВОЕ ПОДКЛЮЧЕНИЕ

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