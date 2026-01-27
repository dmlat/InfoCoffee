// backend/app.js
// ВАЖНО: Загружаем переменные окружения ПЕРВЫМ ДЕЛОМ
console.log('[APP.JS] Starting application...');
try {
    console.log('[APP.JS] Loading environment...');
    require('./utils/envLoader');
    console.log('[APP.JS] Environment loaded successfully');
} catch (error) {
    console.error('[APP.JS] CRITICAL ERROR loading environment:', error);
    console.error('[APP.JS] Stack trace:', error.stack);
    process.exit(1);
}

// Переменные окружения уже загружены в envLoader

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
const analyticsRoutes = require('./routes/analytics'); // <-- НОВЫЙ ИМПОРТ АНАЛИТИКИ
// <--- ИНИЦИАЛИЗАЦИЯ БОТА (с диагностикой)
console.log('[APP.JS] Loading bot...');
let startPolling;
try {
    const botModule = require('./bot');
    startPolling = botModule.startPolling;
    console.log('[APP.JS] Bot loaded successfully');
} catch (error) {
    console.error('[APP.JS] ERROR loading bot:', error);
    console.error('[APP.JS] Bot functionality will be disabled, but server will continue');
    // Создаем заглушку
    startPolling = () => console.warn('[APP.JS] startPolling called but bot is disabled');
}
const { processInventoryChanges } = require('./worker/inventory_notifier_worker');
const { startMonitoring } = require('./utils/botMonitor'); // <-- НОВЫЙ ИМПОРТ МОНИТОРИНГА
require('./worker/task_cleanup_worker'); // <-- ПОДКЛЮЧЕНИЕ ВОРКЕРА СКРЫТИЯ ЗАДАЧ
const presetsRoutes = require('./routes/presets');

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
app.use('/api/analytics', analyticsRoutes); // <-- АНАЛИТИКА
app.use('/api/presets', presetsRoutes);
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
        await startPolling();
        
        // Запускаем мониторинг после успешного запуска бота
        startMonitoring();
        
        // Schedule the inventory notifier worker to run every hour
        setInterval(processInventoryChanges, 60 * 60 * 1000); // 1 раз в час
        
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