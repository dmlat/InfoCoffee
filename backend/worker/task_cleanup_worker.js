// backend/worker/task_cleanup_worker.js
require('../utils/logger');
const cron = require('node-cron');
const { pool } = require('../db');
const moment = require('moment-timezone');
const { sendErrorToAdmin } = require('../utils/adminErrorNotifier');

const TIMEZONE = 'Europe/Moscow';

// Функция для логирования количества скрытых задач
async function logTaskCleanup() {
    const logTime = moment().tz(TIMEZONE).format();
    console.log(`[Task Cleanup ${logTime}] Начинаем проверку скрытых задач...`);
    
    try {
        // Получаем начало текущего дня по московскому времени
        const moscowStartOfDay = moment().tz(TIMEZONE).startOf('day').utc().format();
        
        // Подсчитываем количество выполненных задач, которые будут скрыты
        const hiddenTasksQuery = `
            SELECT COUNT(*) as hidden_count
            FROM service_tasks t
            JOIN terminals term ON t.terminal_id = term.id
            WHERE t.status = 'completed' 
              AND t.completed_at < $1
        `;
        
        const hiddenResult = await pool.query(hiddenTasksQuery, [moscowStartOfDay]);
        const hiddenCount = parseInt(hiddenResult.rows[0].hidden_count);
        
        // Подсчитываем общее количество выполненных задач
        const totalCompletedQuery = `
            SELECT COUNT(*) as total_count
            FROM service_tasks t
            JOIN terminals term ON t.terminal_id = term.id
            WHERE t.status = 'completed'
        `;
        
        const totalResult = await pool.query(totalCompletedQuery);
        const totalCount = parseInt(totalResult.rows[0].total_count);
        
        console.log(`[Task Cleanup ${logTime}] Скрыто задач: ${hiddenCount}, Всего выполненных: ${totalCount}`);
        
        // Логируем в worker_logs если есть скрытые задачи
        if (hiddenCount > 0) {
            await pool.query(`
                INSERT INTO worker_logs (user_id, job_name, last_run_at, status, processed_items, added_items, updated_items, error_message)
                VALUES (NULL, 'task_cleanup', NOW(), 'success', $1, 0, 0, $2)
            `, [hiddenCount, `Скрыто выполненных задач: ${hiddenCount}`]);
        }
        
    } catch (err) {
        console.error(`[Task Cleanup ${logTime}] Ошибка при проверке скрытых задач:`, err);
        
        // Отправляем ошибку всем администраторам
        try {
            await sendErrorToAdmin({ 
                userId: null, 
                errorContext: 'Task Cleanup Worker', 
                errorMessage: err.message, 
                errorStack: err.stack 
            });
        } catch (notifyErr) {
            console.error(`[Task Cleanup ${logTime}] Ошибка отправки уведомления:`, notifyErr);
        }
    }
}

// Запускаем проверку каждый день в 23:59 по московскому времени
cron.schedule('59 23 * * *', logTaskCleanup, {
    timezone: TIMEZONE
});

console.log(`[Task Cleanup Worker] Планировщик запущен. Проверка скрытых задач каждый день в 23:59 ${TIMEZONE}`);

module.exports = { logTaskCleanup }; 