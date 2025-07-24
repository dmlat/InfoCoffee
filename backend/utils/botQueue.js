// backend/utils/botQueue.js
/**
 * Система очередей для отправки Telegram сообщений
 * Предотвращает rate limiting и обеспечивает стабильную работу с 100+ пользователями
 */

const bot = require('./botInstance');
const { sendErrorToAdmin } = require('./adminErrorNotifier');

// === КОНФИГУРАЦИЯ RATE LIMITING ===
const TELEGRAM_LIMITS = {
    MESSAGES_PER_SECOND: 30,        // Telegram limit: 30 messages per second
    MESSAGES_PER_MINUTE: 20,        // Conservative limit per chat per minute
    RETRY_ATTEMPTS: 3,              // Maximum retry attempts
    BACKOFF_BASE_MS: 1000,         // Base backoff delay (1 second)
    COOLDOWN_429_MS: 30000,        // Cooldown after 429 error (30 seconds)
};

// === СОСТОЯНИЕ ОЧЕРЕДЕЙ ===
let globalMessageCount = 0;        // Global messages sent in current second
let globalResetTime = Date.now() + 1000;  // When to reset global counter

const chatCooldowns = new Map();   // Per-chat cooldowns
const messageQueue = [];           // Main message queue
const priorityQueue = [];          // High priority messages (admin notifications)
const failedMessages = [];        // Failed messages for retry

let isProcessing = false;          // Queue processing state
let globalCooldownUntil = 0;      // Global cooldown timestamp

// === УТИЛИТЫ ===
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function canSendGlobally() {
    const now = Date.now();
    
    // Reset global counter every second
    if (now >= globalResetTime) {
        globalMessageCount = 0;
        globalResetTime = now + 1000;
    }
    
    // Check global rate limit
    if (globalMessageCount >= TELEGRAM_LIMITS.MESSAGES_PER_SECOND) {
        return false;
    }
    
    // Check global cooldown (after 429 errors)
    if (now < globalCooldownUntil) {
        return false;
    }
    
    return true;
}

function canSendToChat(chatId) {
    const now = Date.now();
    const cooldownUntil = chatCooldowns.get(chatId.toString());
    
    return !cooldownUntil || now >= cooldownUntil;
}

function setChatCooldown(chatId, ms = TELEGRAM_LIMITS.BACKOFF_BASE_MS) {
    const cooldownUntil = Date.now() + ms;
    chatCooldowns.set(chatId.toString(), cooldownUntil);
}

function setGlobalCooldown(ms = TELEGRAM_LIMITS.COOLDOWN_429_MS) {
    globalCooldownUntil = Date.now() + ms;
    console.log(`[BotQueue] Global cooldown set for ${ms}ms`);
}

// === ОСНОВНЫЕ ФУНКЦИИ ОЧЕРЕДИ ===

/**
 * Добавляет сообщение в очередь
 * @param {string|number} chatId - ID чата
 * @param {string} text - Текст сообщения
 * @param {object} options - Опции сообщения
 * @param {boolean} priority - Высокий приоритет (для админских уведомлений)
 * @param {string} context - Контекст для логирования
 * @returns {Promise<boolean>} - true если добавлено в очередь
 */
function queueMessage(chatId, text, options = {}, priority = false, context = 'general') {
    if (!chatId || !text) {
        console.error('[BotQueue] queueMessage: Missing chatId or text');
        return Promise.resolve(false);
    }

    const message = {
        chatId: chatId.toString(),
        text,
        options,
        context,
        attempts: 0,
        createdAt: Date.now(),
        id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    };

    if (priority) {
        priorityQueue.push(message);
        console.log(`[BotQueue] Added priority message to queue: ${context} (queue: ${priorityQueue.length})`);
    } else {
        messageQueue.push(message);
        console.log(`[BotQueue] Added message to queue: ${context} (queue: ${messageQueue.length})`);
    }

    // Запускаем обработку очереди если она не активна
    if (!isProcessing) {
        processQueue();
    }

    return Promise.resolve(true);
}

/**
 * Отправляет сообщение с инлайн-клавиатурой через очередь
 */
function queueMessageWithKeyboard(chatId, text, keyboard, priority = false, context = 'keyboard') {
    const options = {
        parse_mode: 'HTML',
        reply_markup: keyboard
    };
    return queueMessage(chatId, text, options, priority, context);
}

/**
 * Основная функция обработки очереди
 */
async function processQueue() {
    if (isProcessing) {
        return;
    }

    isProcessing = true;
    console.log(`[BotQueue] Starting queue processing...`);

    try {
        while (priorityQueue.length > 0 || messageQueue.length > 0 || failedMessages.length > 0) {
            // Check global rate limits
            if (!canSendGlobally()) {
                const waitTime = Math.max(100, globalResetTime - Date.now());
                await delay(waitTime);
                continue;
            }

            let message = null;
            let source = '';

            // Priority: failed messages -> priority queue -> regular queue
            if (failedMessages.length > 0) {
                message = failedMessages.shift();
                source = 'retry';
            } else if (priorityQueue.length > 0) {
                message = priorityQueue.shift();
                source = 'priority';
            } else if (messageQueue.length > 0) {
                message = messageQueue.shift();
                source = 'regular';
            }

            if (!message) {
                break;
            }

            // Check per-chat rate limits
            if (!canSendToChat(message.chatId)) {
                // Put message back in appropriate queue
                if (source === 'priority') {
                    priorityQueue.unshift(message);
                } else {
                    messageQueue.unshift(message);
                }
                await delay(100);
                continue;
            }

            // Try to send message
            const success = await sendMessageSafely(message);
            
            if (success) {
                globalMessageCount++;
                console.log(`[BotQueue] Sent ${source} message: ${message.context} (${message.chatId})`);
            } else {
                // Handle failure
                message.attempts++;
                
                if (message.attempts < TELEGRAM_LIMITS.RETRY_ATTEMPTS) {
                    // Add exponential backoff
                    const backoffDelay = TELEGRAM_LIMITS.BACKOFF_BASE_MS * Math.pow(2, message.attempts - 1);
                    setChatCooldown(message.chatId, backoffDelay);
                    
                    failedMessages.push(message);
                    console.log(`[BotQueue] Message failed, will retry: ${message.context} (attempt ${message.attempts})`);
                } else {
                    console.error(`[BotQueue] Message permanently failed after ${message.attempts} attempts: ${message.context}`);
                    
                    // Notify admin about permanent failures
                    sendErrorToAdmin({
                        errorContext: `BotQueue - Permanent Message Failure`,
                        errorMessage: `Failed to send message after ${message.attempts} attempts`,
                        additionalInfo: {
                            chatId: message.chatId,
                            context: message.context,
                            messageLength: message.text.length
                        }
                    }).catch(console.error);
                }
            }

            // Small delay between messages to be nice to Telegram
            await delay(50);
        }
    } catch (error) {
        console.error('[BotQueue] Error in queue processing:', error);
    } finally {
        isProcessing = false;
        console.log(`[BotQueue] Queue processing finished. Remaining: ${messageQueue.length} regular, ${priorityQueue.length} priority, ${failedMessages.length} failed`);
        
        // Schedule next processing if there are still messages
        if (messageQueue.length > 0 || priorityQueue.length > 0 || failedMessages.length > 0) {
            setTimeout(() => processQueue(), 1000);
        }
    }
}

/**
 * Безопасная отправка сообщения с обработкой ошибок
 */
async function sendMessageSafely(message) {
    try {
        await bot.sendMessage(message.chatId, message.text, message.options);
        return true;
    } catch (error) {
        console.error(`[BotQueue] Send error for ${message.context}:`, error.code || 'NO_CODE', error.message);
        
        // Handle specific error types
        if (error.code === 429 || (error.response && error.response.statusCode === 429)) {
            // Rate limit exceeded
            const retryAfter = error.parameters?.retry_after || 30;
            console.log(`[BotQueue] Rate limited. Setting global cooldown: ${retryAfter}s`);
            setGlobalCooldown(retryAfter * 1000);
            return false;
        } else if (error.code === 403) {
            // Bot blocked by user
            console.warn(`[BotQueue] Bot blocked by user ${message.chatId}`);
            return true; // Don't retry these
        } else if (error.code === 400) {
            // Bad request - don't retry
            console.warn(`[BotQueue] Bad request for ${message.chatId}: ${error.message}`);
            return true;
        }
        
        return false; // Other errors - will retry
    }
}

// === LEGACY COMPATIBILITY ===

/**
 * Backward compatibility wrapper for direct bot usage
 * Automatically queues messages instead of sending directly
 */
function sendNotification(chatId, text, priority = false) {
    return queueMessage(chatId, text, { parse_mode: 'HTML' }, priority, 'notification');
}

function sendNotificationWithKeyboard(chatId, text, keyboard, priority = false) {
    return queueMessageWithKeyboard(chatId, text, keyboard, priority, 'notification_keyboard');
}

// === СТАТИСТИКА И МОНИТОРИНГ ===

function getQueueStats() {
    return {
        regularQueue: messageQueue.length,
        priorityQueue: priorityQueue.length,
        failedMessages: failedMessages.length,
        isProcessing,
        globalMessageCount,
        globalCooldownUntil,
        chatCooldowns: chatCooldowns.size
    };
}

function logQueueStats() {
    const stats = getQueueStats();
    console.log(`[BotQueue Stats] Regular: ${stats.regularQueue}, Priority: ${stats.priorityQueue}, Failed: ${stats.failedMessages}, Processing: ${stats.isProcessing}`);
}

// Логирование статистики каждые 5 минут (было 60000)
setInterval(logQueueStats, 5 * 60 * 1000);

// === ЭКСПОРТ ===
module.exports = {
    queueMessage,
    queueMessageWithKeyboard,
    sendNotification,           // Legacy compatibility
    sendNotificationWithKeyboard, // Legacy compatibility
    getQueueStats,
    logQueueStats,
    
    // For testing
    _internal: {
        canSendGlobally,
        canSendToChat,
        setChatCooldown,
        setGlobalCooldown
    }
}; 