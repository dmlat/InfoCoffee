// backend/app.js
const logger = require('./utils/logger'); // <--- ГЛОБАЛЬНОЕ ПОДКЛЮЧЕНИЕ ЛОГГЕРА
const path = require('path');

// Определяем режим работы. По умолчанию - development.
if (process.env.NODE_ENV === 'production') {
    console.log('[ENV] Production mode detected. Loading .env');
    require('dotenv').config({ path: path.resolve(__dirname, '.env') });
} else {
    process.env.NODE_ENV = 'development'; // Принудительно устанавливаем для надежности
    console.log('[ENV] Defaulting to development mode. Loading .env.development');
    require('dotenv').config({ path: path.resolve(__dirname, '.env.development') });
    console.log('[ENV] DEV_OWNER_TELEGRAM_ID:', process.env.DEV_OWNER_TELEGRAM_ID ? 'Loaded' : 'NOT LOADED');
    console.log('[ENV] DEV_ADMIN_TELEGRAM_ID:', process.env.DEV_ADMIN_TELEGRAM_ID ? 'Loaded' : 'NOT LOADED');
    console.log('[ENV] DEV_SERVICE_TELEGRAM_ID:', process.env.DEV_SERVICE_TELEGRAM_ID ? 'Loaded' : 'NOT LOADED');
}

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
const configRoutes = require('./routes/config'); // Убедимся, что роут импортирован
const terminalsRoutes = require('./routes/terminals');
const recipesRoutes = require('./routes/recipes');
const warehouseRoutes = require('./routes/warehouse'); // <-- Убедимся, что он есть
const inventoryRoutes = require('./routes/inventory'); // <-- НОВЫЙ ИМПОРТ
const tasksRoutes = require('./routes/tasks'); // <-- НОВЫЙ ИМПОРТ
const { startPolling } = require('./bot'); // <-- ИМПОРТ ФУНКЦИИ
const { processInventoryChanges } = require('./worker/inventory_notifier_worker');
const { startMonitoring } = require('./utils/botMonitor'); // <-- НОВЫЙ ИМПОРТ МОНИТОРИНГА
require('./worker/task_cleanup_worker'); // <-- ПОДКЛЮЧЕНИЕ ВОРКЕРА СКРЫТИЯ ЗАДАЧ

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
app.use('/api', configRoutes); // Убедимся, что роут используется

// === НОВЫЙ ЭНДПОИНТ ДЛЯ МОНИТОРИНГА ===
const { getMonitoringData } = require('./utils/botMonitor');
app.get('/api/bot-status', async (req, res) => {
    try {
        const monitoringData = getMonitoringData();
        res.json({ 
            success: true, 
            ...monitoringData,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('[API] Error getting bot status:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Failed to get bot monitoring data',
            timestamp: new Date().toISOString()
        });
    }
});

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

// === GRACEFUL SHUTDOWN HANDLING ===
process.on('SIGTERM', () => {
    console.log('[App] SIGTERM received. Shutting down gracefully...');
    const { stopMonitoring } = require('./utils/botMonitor');
    stopMonitoring();
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('[App] SIGINT received. Shutting down gracefully...');
    const { stopMonitoring } = require('./utils/botMonitor');
    stopMonitoring();
    process.exit(0);
});

const PORT = process.env.PORT || 3001;

const server = app.listen(PORT, async () => {
    console.log(`[App] Backend server started on port ${PORT}`);
    
    try {
        // Запускаем бот с задержкой для стабильности
        console.log('[App] Starting bot services...');
        await startPolling();
        console.log('[App] Bot services started successfully');
        
        // Запускаем мониторинг после успешного запуска бота
        console.log('[App] Starting monitoring system...');
        startMonitoring();
        
        // Schedule the inventory notifier worker to run every hour
        setInterval(processInventoryChanges, 60 * 60 * 1000); // 1 раз в час
        console.log('[App] Background workers scheduled');
        
        console.log('[App] ✅ All systems initialized successfully');
        console.log('[App] 📊 Bot monitoring: http://localhost:' + PORT + '/api/bot-status');
        
    } catch (error) {
        console.error('[App] ❌ Failed to start bot services:', error.message);
        
        // В production критическая ошибка должна приводить к остановке
        if (process.env.NODE_ENV === 'production') {
            console.error('[App] Critical error in production. Exiting...');
            process.exit(1);
        } else {
            console.warn('[App] Bot services failed in development. Server will continue running for debugging.');
        }
    }
});

// Обработка ошибок сервера
server.on('error', (error) => {
    console.error('[App] Server error:', error);
    if (error.code === 'EADDRINUSE') {
        console.error(`[App] Port ${PORT} is already in use`);
        process.exit(1);
    }
});

// Логирование необработанных исключений
process.on('uncaughtException', (error) => {
    console.error('[App] Uncaught Exception:', error);
    const { sendCriticalError } = require('./utils/adminErrorNotifier');
    sendCriticalError(error.message, 'Uncaught Exception').catch(console.error);
    
    // Даем время для отправки уведомления, затем выходим
    setTimeout(() => process.exit(1), 2000);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('[App] Unhandled Promise Rejection at:', promise, 'reason:', reason);
    const { sendCriticalError } = require('./utils/adminErrorNotifier');
    sendCriticalError(reason.toString(), 'Unhandled Promise Rejection').catch(console.error);
});

module.exports = app;