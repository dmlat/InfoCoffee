require('dotenv').config();
const express = require('express');
const cors = require('cors');
const pool = require('./db');
const authRoutes = require('./routes/auth');
const profileRoutes = require('./routes/profile'); // Added profile routes

const app = express();

app.use(cors());
app.use(express.json());

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/profile', profileRoutes); // Added profile routes

const transactionsRoutes = require('./routes/transactions');
app.use('/api/transactions', transactionsRoutes);

const expensesRoutes = require('./routes/expenses');
app.use('/api/expenses', expensesRoutes);

// Vendista specific routes might be largely handled by auth now,
// but if you have other utility vendista routes, keep them.
// const vendistaRouter = require('./routes/vendista');
// app.use('/api/vendista', vendistaRouter);


// DB Connection Test Endpoint
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