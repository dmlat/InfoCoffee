// frontend/src/utils/retryHelper.js
import authLogger from './authLogger';

/**
 * Retry utility для операций аутентификации
 */
export class RetryHelper {
    constructor(maxRetries = 3, baseDelay = 1000) {
        this.maxRetries = maxRetries;
        this.baseDelay = baseDelay;
    }

    /**
     * Определяет, является ли ошибка временной (подлежит retry)
     */
    isRetryableError(error) {
        // Сетевые ошибки
        if (error.code === 'NETWORK_ERROR' || error.message.includes('Network Error')) {
            return true;
        }

        // Таймауты
        if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
            return true;
        }

        // HTTP статусы, которые можно повторить
        const retryableStatuses = [408, 429, 500, 502, 503, 504];
        if (error.response?.status && retryableStatuses.includes(error.response.status)) {
            return true;
        }

        // Специфичные ошибки Telegram WebApp
        if (error.message.includes('WebApp') && error.message.includes('not ready')) {
            return true;
        }

        return false;
    }

    /**
     * Определяет, является ли ошибка критической (требует немедленного уведомления)
     */
    isCriticalError(error, userAccessLevel = null) {
        // 401/403 ошибки для admin/service критичны
        if ((userAccessLevel === 'admin' || userAccessLevel === 'service') && 
            (error.response?.status === 401 || error.response?.status === 403)) {
            return true;
        }

        // Ошибки валидации initData
        if (error.message.includes('Invalid Telegram data') || 
            error.message.includes('Hash mismatch')) {
            return true;
        }

        // Неожиданные состояния
        if (error.message.includes('registration_required') && 
            (userAccessLevel === 'admin' || userAccessLevel === 'service')) {
            return true;
        }

        return false;
    }

    /**
     * Выполняет операцию с retry логикой
     */
    async executeWithRetry(operation, operationName, context = {}) {
        let lastError = null;
        
        for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
            try {
                authLogger.debug(`${operationName}: Attempt ${attempt}/${this.maxRetries}`, context);
                
                const result = await operation();
                
                if (attempt > 1) {
                    authLogger.info(`${operationName}: Succeeded on attempt ${attempt}`, context);
                }
                
                return result;
            } catch (error) {
                lastError = error;
                
                authLogger.warn(`${operationName}: Failed on attempt ${attempt}`, {
                    error: error.message,
                    status: error.response?.status,
                    isRetryable: this.isRetryableError(error),
                    isCritical: this.isCriticalError(error, context.userAccessLevel),
                    ...context
                });

                // Если это последняя попытка или ошибка не подлежит retry
                if (attempt === this.maxRetries || !this.isRetryableError(error)) {
                    break;
                }

                // Экспоненциальная задержка: 1s, 2s, 4s, ...
                const delay = this.baseDelay * Math.pow(2, attempt - 1);
                authLogger.debug(`${operationName}: Waiting ${delay}ms before retry`);
                
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }

        // Если дошли сюда, все попытки провалились
        authLogger.error(`${operationName}: All ${this.maxRetries} attempts failed`, {
            finalError: lastError.message,
            status: lastError.response?.status,
            ...context
        });

        throw lastError;
    }

    /**
     * Специализированный retry для validate-token
     */
    async retryTokenValidation(validateFn, token) {
        return this.executeWithRetry(
            validateFn,
            'Token Validation',
            { tokenLength: token?.length || 0 }
        );
    }

    /**
     * Специализированный retry для refresh-app-token
     */
    async retryTokenRefresh(refreshFn, userAccessLevel, hasInitData) {
        return this.executeWithRetry(
            refreshFn,
            'Token Refresh',
            { userAccessLevel, hasInitData }
        );
    }

    /**
     * Специализированный retry для telegram-handshake
     */
    async retryTelegramHandshake(handshakeFn, initDataLength) {
        return this.executeWithRetry(
            handshakeFn,
            'Telegram Handshake',
            { initDataLength }
        );
    }
}

// Создаем глобальный экземпляр с настройками по умолчанию
export const authRetryHelper = new RetryHelper(3, 1000);

// Вспомогательные функции для определения типов ошибок
export const ErrorTypes = {
    TEMPORARY: 'temporary',
    CRITICAL: 'critical',
    PERMANENT: 'permanent'
};

export function categorizeError(error, userAccessLevel = null) {
    const helper = new RetryHelper();
    
    if (helper.isCriticalError(error, userAccessLevel)) {
        return ErrorTypes.CRITICAL;
    }
    
    if (helper.isRetryableError(error)) {
        return ErrorTypes.TEMPORARY;
    }
    
    return ErrorTypes.PERMANENT;
} 