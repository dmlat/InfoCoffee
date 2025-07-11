// backend/utils/logger.js
const moment = require('moment-timezone');

const TIMEZONE = 'Europe/Moscow';

// Сохраняем оригинальные методы консоли, чтобы не потерять их
const originalConsole = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error,
    debug: console.debug,
};

// Функция для получения отформатированной временной метки
const getTimestamp = () => moment().tz(TIMEZONE).format('YYYY-MM-DD HH:mm:ss.SSS');

// Переопределяем стандартные методы console
console.log = (...args) => {
    originalConsole.log(`[${getTimestamp()}] [LOG]  `, ...args);
};

console.info = (...args) => {
    originalConsole.info(`[${getTimestamp()}] [INFO] `, ...args);
};

console.warn = (...args) => {
    originalConsole.warn(`[${getTimestamp()}] [WARN] `, ...args);
};

console.error = (...args) => {
    originalConsole.error(`[${getTimestamp()}] [ERROR]`, ...args);
};

console.debug = (...args) => {
    // Включаем debug-сообщения только в режиме разработки
    if (process.env.NODE_ENV !== 'production') {
        originalConsole.debug(`[${getTimestamp()}] [DEBUG]`, ...args);
    }
};

// Ничего не экспортируем, так как этот файл изменяет глобальный объект console при его подключении. 