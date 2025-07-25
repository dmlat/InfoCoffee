// frontend/src/utils/authLogger.js
import api from '../api';

class AuthLogger {
    constructor() {
        this.logs = [];
        this.isDebugging = process.env.NODE_ENV === 'development';
    }

    log(message, level = 'info', data = null) {
        const timestamp = new Date().toISOString();
        const logEntry = {
            timestamp,
            level,
            message,
            data,
            userAgent: navigator.userAgent,
            url: window.location.href
        };

        this.logs.push(logEntry);
        
        // В development режиме выводим все логи в консоль
        if (this.isDebugging) {
            console.log(`[AuthLogger:${level.toUpperCase()}] ${message}`, data || '');
        }

        // Ограничиваем размер лога (последние 50 записей)
        if (this.logs.length > 50) {
            this.logs = this.logs.slice(-50);
        }
    }

    error(message, error = null, data = null) {
        this.log(message, 'error', { error: error?.message || error, stack: error?.stack, ...data });
    }

    warn(message, data = null) {
        this.log(message, 'warn', data);
    }

    info(message, data = null) {
        this.log(message, 'info', data);
    }

    debug(message, data = null) {
        if (this.isDebugging) {
            this.log(message, 'debug', data);
        }
    }

    // Отправка критических ошибок аутентификации в Telegram
    async sendAuthErrorToTelegram(errorContext, errorMessage, userData = null) {
        try {
            // Собираем диагностическую информацию
            const diagnosticInfo = {
                logs: this.logs.slice(-10), // Последние 10 логов
                localStorage: this.getLocalStorageInfo(),
                telegramWebApp: this.getTelegramWebAppInfo(),
                userAgent: navigator.userAgent,
                url: window.location.href,
                timestamp: new Date().toISOString()
            };

            // Отправляем на бэкенд для пересылки в Telegram
            await api.post('/auth/log-frontend-error', {
                error: errorMessage,
                context: `CRITICAL AUTH ERROR: ${errorContext}`,
                tgInitData: window.Telegram?.WebApp?.initData,
                userData: userData,
                diagnosticInfo: diagnosticInfo
            });

            this.info('Auth error sent to Telegram', { errorContext, errorMessage });
        } catch (sendError) {
            this.error('Failed to send auth error to Telegram', sendError);
            console.error('[AuthLogger] Failed to send error to Telegram:', sendError);
        }
    }

    // Получение информации из localStorage (без токенов)
    getLocalStorageInfo() {
        try {
            const authData = localStorage.getItem('authData');
            if (authData) {
                const parsed = JSON.parse(authData);
                return {
                    hasToken: !!parsed.token,
                    tokenLength: parsed.token?.length || 0,
                    hasUser: !!parsed.user,
                    userAccessLevel: parsed.user?.accessLevel,
                    userTelegramId: parsed.user?.telegram_id,
                    userFirstName: parsed.user?.first_name
                };
            }
            return { hasAuthData: false };
        } catch (error) {
            return { error: 'Failed to parse localStorage' };
        }
    }

    // Получение информации о Telegram WebApp
    getTelegramWebAppInfo() {
        try {
            const webApp = window.Telegram?.WebApp;
            if (webApp) {
                return {
                    version: webApp.version,
                    platform: webApp.platform,
                    hasInitData: !!webApp.initData,
                    initDataLength: webApp.initData?.length || 0,
                    colorScheme: webApp.colorScheme,
                    themeParams: webApp.themeParams,
                    isExpanded: webApp.isExpanded,
                    viewportHeight: webApp.viewportHeight,
                    viewportStableHeight: webApp.viewportStableHeight
                };
            }
            return { available: false };
        } catch (error) {
            return { error: 'Failed to get Telegram WebApp info' };
        }
    }

    // Очистка логов
    clear() {
        this.logs = [];
        this.info('Auth logs cleared');
    }

    // Получение всех логов
    getAllLogs() {
        return this.logs;
    }

    // Получение логов по уровню
    getLogsByLevel(level) {
        return this.logs.filter(log => log.level === level);
    }
}

// Создаем единственный экземпляр
const authLogger = new AuthLogger();

export default authLogger; 