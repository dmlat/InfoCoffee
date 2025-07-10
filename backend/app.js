// backend/app.js
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') }); 
const express = require('express');
const cors = require('cors');
// Загрузка переменных окружения и инстанцирование pool теперь происходит в db.js
// Это гарантирует, что любой модуль, импортирующий db.js, будет работать с правильной конфигурацией
const pool = require('./db'); 
const authRoutes = require('./routes/auth');
const profileRoutes = require('./routes/profile');
const transactionsRoutes = require('./routes/transactions');
const expensesRoutes = require('./routes/expenses');
const accessRoutes = require('./routes/access');
const terminalsRoutes = require('./routes/terminals');
const recipesRoutes = require('./routes/recipes');
const warehouseRoutes = require('./routes/warehouse'); // <-- Убедимся, что он есть
const inventoryRoutes = require('./routes/inventory'); // <-- НОВЫЙ ИМПОРТ
const tasksRoutes = require('./routes/tasks'); // <-- НОВЫЙ ИМПОРТ

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
app.use('/api/recipes', recipesRoutes);
app.use('/api/warehouse', warehouseRoutes);
app.use('/api/inventory', inventoryRoutes); // <-- НОВОЕ ПОДКЛЮЧЕНИЕ
app.use('/api/tasks', tasksRoutes); // <-- НОВАЯ СТРОКА

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