require('dotenv').config();
console.log('JWT_SECRET (после dotenv):', process.env.JWT_SECRET);
const express = require('express');
const cors = require('cors');
const pool = require('./db');
const authRoutes = require('./routes/auth');

const app = express();                // <-- сначала создаём app!

app.use(cors());
app.use(express.json());

// Подключаем /api/*
app.use('/api', authRoutes);

const transactionsRoutes = require('./routes/transactions');
app.use('/api/transactions', transactionsRoutes);

const expensesRoutes = require('./routes/expenses');
app.use('/api/expenses', expensesRoutes);

const vendistaRouter = require('./routes/vendista');
app.use('/api/vendista', vendistaRouter);

// Тестовый endpoint для проверки соединения с БД
app.get('/api/test-db', async (req, res) => {
  try {
    const result = await pool.query('SELECT NOW()');
    res.json({ success: true, time: result.rows[0].now });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server started on port ${PORT}`);
});
