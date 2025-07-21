// backend/utils/botMonitor.js
/**
 * Система мониторинга бота и очередей сообщений
 * Отслеживает производительность и здоровье системы уведомлений
 */

const moment = require('moment-timezone');
const { getQueueStats } = require('./botQueue');
const { getNotificationStats } = require('./adminErrorNotifier');

// === КОНФИГУРАЦИЯ МОНИТОРИНГА ===
const MONITOR_CONFIG = {
    LOG_INTERVAL_MS: 5 * 60 * 1000,      // Логирование каждые 5 минут
    HEALTH_CHECK_INTERVAL_MS: 60 * 1000,  // Проверка здоровья каждую минуту
    WARNING_THRESHOLDS: {
        QUEUE_SIZE: 50,                   // Предупреждение при размере очереди > 50
        ERROR_QUEUE_SIZE: 10,             // Предупреждение при количестве ошибок > 10
        PROCESSING_TIME_MS: 30000,        // Предупреждение если обработка > 30 сек
        FAILED_MESSAGES_RATIO: 0.1        // Предупреждение при > 10% неудачных сообщений
    },
    CRITICAL_THRESHOLDS: {
        QUEUE_SIZE: 200,                  // Критический размер очереди
        ERROR_QUEUE_SIZE: 50,             // Критическое количество ошибок
        PROCESSING_TIME_MS: 120000,       // Критическое время обработки > 2 мин
        FAILED_MESSAGES_RATIO: 0.3        // Критический процент неудач > 30%
    }
};

// === СОСТОЯНИЕ МОНИТОРИНГА ===
let monitoringActive = false;
let lastHealthCheck = null;
let healthStatus = 'unknown';
let performanceStats = {
    totalMessagesSent: 0,
    totalMessagesFailed: 0,
    averageProcessingTime: 0,
    peakQueueSize: 0,
    uptime: Date.now()
};

const healthHistory = []; // История проверок здоровья
const MAX_HISTORY_SIZE = 100;

// === УТИЛИТЫ ===
function formatDuration(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    
    if (hours > 0) {
        return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    } else if (minutes > 0) {
        return `${minutes}m ${seconds % 60}s`;
    } else {
        return `${seconds}s`;
    }
}

function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// === ПРОВЕРКА ЗДОРОВЬЯ СИСТЕМЫ ===
function performHealthCheck() {
    const timestamp = Date.now();
    const queueStats = getQueueStats();
    const errorStats = getNotificationStats();
    
    const health = {
        timestamp,
        status: 'healthy',
        warnings: [],
        critical: [],
        metrics: {
            queue: queueStats,
            errors: errorStats,
            performance: { ...performanceStats },
            system: {
                uptime: timestamp - performanceStats.uptime,
                memoryUsage: process.memoryUsage(),
                nodeVersion: process.version
            }
        }
    };

    // Обновляем пиковый размер очереди
    const totalQueueSize = queueStats.regularQueue + queueStats.priorityQueue + queueStats.failedMessages;
    if (totalQueueSize > performanceStats.peakQueueSize) {
        performanceStats.peakQueueSize = totalQueueSize;
    }

    // === ПРОВЕРКИ ПРЕДУПРЕЖДЕНИЙ ===
    if (totalQueueSize >= MONITOR_CONFIG.WARNING_THRESHOLDS.QUEUE_SIZE) {
        health.warnings.push(`Large queue size: ${totalQueueSize} messages`);
    }

    if (errorStats.queueLength >= MONITOR_CONFIG.WARNING_THRESHOLDS.ERROR_QUEUE_SIZE) {
        health.warnings.push(`Many queued errors: ${errorStats.queueLength}`);
    }

    if (errorStats.hourlyMessageCount >= 15) { // 75% от лимита в 20
        health.warnings.push(`High admin notification rate: ${errorStats.hourlyMessageCount}/20 per hour`);
    }

    const failedRatio = performanceStats.totalMessagesSent > 0 
        ? performanceStats.totalMessagesFailed / performanceStats.totalMessagesSent
        : 0;
    
    if (failedRatio >= MONITOR_CONFIG.WARNING_THRESHOLDS.FAILED_MESSAGES_RATIO) {
        health.warnings.push(`High failure rate: ${(failedRatio * 100).toFixed(1)}%`);
    }

    // === КРИТИЧЕСКИЕ ПРОВЕРКИ ===
    if (totalQueueSize >= MONITOR_CONFIG.CRITICAL_THRESHOLDS.QUEUE_SIZE) {
        health.critical.push(`Critical queue size: ${totalQueueSize} messages`);
        health.status = 'critical';
    }

    if (errorStats.queueLength >= MONITOR_CONFIG.CRITICAL_THRESHOLDS.ERROR_QUEUE_SIZE) {
        health.critical.push(`Critical error queue: ${errorStats.queueLength}`);
        health.status = 'critical';
    }

    if (failedRatio >= MONITOR_CONFIG.CRITICAL_THRESHOLDS.FAILED_MESSAGES_RATIO) {
        health.critical.push(`Critical failure rate: ${(failedRatio * 100).toFixed(1)}%`);
        health.status = 'critical';
    }

    // Устанавливаем итоговый статус
    if (health.status !== 'critical') {
        if (health.warnings.length > 0) {
            health.status = 'warning';
        } else {
            health.status = 'healthy';
        }
    }

    // Сохраняем результат
    lastHealthCheck = health;
    healthStatus = health.status;
    
    // Добавляем в историю
    healthHistory.push({
        timestamp,
        status: health.status,
        queueSize: totalQueueSize,
        errorCount: errorStats.queueLength,
        failedRatio: failedRatio
    });
    
    // Ограничиваем размер истории
    if (healthHistory.length > MAX_HISTORY_SIZE) {
        healthHistory.shift();
    }

    return health;
}

// === ЛОГИРОВАНИЕ СТАТИСТИКИ ===
function logPerformanceStats() {
    if (!lastHealthCheck) {
        console.log('[BotMonitor] No health data available yet');
        return;
    }

    const health = lastHealthCheck;
    const uptime = formatDuration(health.metrics.system.uptime);
    const memory = formatBytes(health.metrics.system.memoryUsage.rss);
    
    console.log(`[BotMonitor] === SYSTEM STATUS: ${health.status.toUpperCase()} ===`);
    console.log(`[BotMonitor] Uptime: ${uptime} | Memory: ${memory}`);
    
    // Статистика очередей
    const q = health.metrics.queue;
    console.log(`[BotMonitor] Queues: Regular(${q.regularQueue}) Priority(${q.priorityQueue}) Failed(${q.failedMessages}) Processing(${q.isProcessing})`);
    console.log(`[BotMonitor] Peak Queue Size: ${performanceStats.peakQueueSize} | Global Messages: ${q.globalMessageCount}/sec`);
    
    // Статистика ошибок
    const e = health.metrics.errors;
    console.log(`[BotMonitor] Admin Notifications: ${e.hourlyMessageCount}/20 per hour | Error Queue: ${e.queueLength}`);
    
    // Статистика производительности
    const successRate = performanceStats.totalMessagesSent > 0 
        ? (((performanceStats.totalMessagesSent - performanceStats.totalMessagesFailed) / performanceStats.totalMessagesSent) * 100).toFixed(1)
        : 'N/A';
    console.log(`[BotMonitor] Messages: ${performanceStats.totalMessagesSent} sent, ${performanceStats.totalMessagesFailed} failed (${successRate}% success)`);
    
    // Предупреждения и критические ошибки
    if (health.warnings.length > 0) {
        console.warn(`[BotMonitor] WARNINGS: ${health.warnings.join('; ')}`);
    }
    
    if (health.critical.length > 0) {
        console.error(`[BotMonitor] CRITICAL: ${health.critical.join('; ')}`);
    }
    
    console.log('[BotMonitor] =====================================');
}

// === ОБНОВЛЕНИЕ СТАТИСТИКИ ПРОИЗВОДИТЕЛЬНОСТИ ===
function recordMessageSent() {
    performanceStats.totalMessagesSent++;
}

function recordMessageFailed() {
    performanceStats.totalMessagesFailed++;
}

function recordProcessingTime(ms) {
    // Простое скользящее среднее
    const weight = 0.1;
    performanceStats.averageProcessingTime = 
        (performanceStats.averageProcessingTime * (1 - weight)) + (ms * weight);
}

// === ПОЛУЧЕНИЕ ДАННЫХ МОНИТОРИНГА ===
function getMonitoringData() {
    const health = lastHealthCheck || performHealthCheck();
    
    return {
        status: healthStatus,
        lastCheck: health.timestamp,
        uptime: Date.now() - performanceStats.uptime,
        performance: { ...performanceStats },
        currentMetrics: health.metrics,
        warnings: health.warnings || [],
        critical: health.critical || [],
        history: healthHistory.slice(-20) // Последние 20 записей
    };
}

// === ЗАПУСК МОНИТОРИНГА ===
function startMonitoring() {
    if (monitoringActive) {
        console.log('[BotMonitor] Monitoring already active');
        return;
    }

    console.log('[BotMonitor] Starting bot monitoring system...');
    monitoringActive = true;
    
    // Первоначальная проверка здоровья
    performHealthCheck();
    
    // Регулярные проверки здоровья
    setInterval(() => {
        try {
            performHealthCheck();
        } catch (error) {
            console.error('[BotMonitor] Health check failed:', error);
        }
    }, MONITOR_CONFIG.HEALTH_CHECK_INTERVAL_MS);
    
    // Регулярное логирование статистики
    setInterval(() => {
        try {
            logPerformanceStats();
        } catch (error) {
            console.error('[BotMonitor] Stats logging failed:', error);
        }
    }, MONITOR_CONFIG.LOG_INTERVAL_MS);
    
    // Начальное логирование
    setTimeout(logPerformanceStats, 5000);
    
    console.log(`[BotMonitor] Monitoring started. Health checks every ${MONITOR_CONFIG.HEALTH_CHECK_INTERVAL_MS/1000}s, stats every ${MONITOR_CONFIG.LOG_INTERVAL_MS/60000}min`);
}

function stopMonitoring() {
    monitoringActive = false;
    console.log('[BotMonitor] Monitoring stopped');
}

// === API ФУНКЦИИ ===
function getHealthStatus() {
    return healthStatus;
}

function isHealthy() {
    return healthStatus === 'healthy';
}

function hasWarnings() {
    return healthStatus === 'warning';
}

function isCritical() {
    return healthStatus === 'critical';
}

// === ЭКСПОРТ ===
module.exports = {
    startMonitoring,
    stopMonitoring,
    getMonitoringData,
    getHealthStatus,
    isHealthy,
    hasWarnings,
    isCritical,
    
    // Функции для обновления статистики
    recordMessageSent,
    recordMessageFailed,
    recordProcessingTime,
    
    // Для тестирования
    _internal: {
        performHealthCheck,
        logPerformanceStats,
        performanceStats,
        MONITOR_CONFIG
    }
}; 