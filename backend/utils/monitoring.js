// backend/utils/monitoring.js
const { exec } = require('child_process');
const { sendCriticalError } = require('./adminErrorNotifier');

// --- 1. Проверка статуса Nginx ---
function checkNginxStatus() {
    return new Promise((resolve) => {
        // Команда для проверки статуса сервиса Nginx в Ubuntu
        exec('systemctl is-active nginx', (error, stdout, stderr) => {
            if (error) {
                // Если команда завершилась с ошибкой, значит сервис не активен или произошла другая проблема
                resolve({
                    status: '❌ НЕ РАБОТАЕТ',
                    error: stderr || stdout || 'Не удалось получить статус'
                });
                return;
            }

            const status = stdout.trim();
            if (status === 'active') {
                resolve({ status: '✅ Активен' });
            } else {
                resolve({ status: `⚠️ ${status}` });
            }
        });
    });
}

// --- 2. Проверка срока действия SSL-сертификата ---
function checkSslCertificate() {
    return new Promise((resolve) => {
        // Команда для получения даты окончания срока действия сертификата
        const command = "openssl x509 -in /etc/letsencrypt/live/infocoffee.ru/fullchain.pem -noout -enddate";
        
        exec(command, (error, stdout, stderr) => {
            if (error) {
                resolve({
                    status: '❌ Не удалось проверить',
                    daysRemaining: null,
                    error: stderr || 'Проверьте путь к сертификату и права доступа.'
                });
                return;
            }

            try {
                // stdout будет в формате "notAfter=Month Day HH:MM:SS YYYY GMT"
                const expiryDateStr = stdout.split('=')[1].trim();
                const expiryDate = new Date(expiryDateStr);
                const now = new Date();
                
                const diffTime = expiryDate - now;
                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

                if (diffDays <= 0) {
                    resolve({
                        status: `❌ ИСТЁК (${diffDays} дней назад)`,
                        daysRemaining: diffDays
                    });
                } else if (diffDays <= 14) {
                    // Если осталось меньше 2 недель, отправляем предупреждение
                    resolve({
                        status: `⚠️ Истекает скоро (осталось ${diffDays} дней)`,
                        daysRemaining: diffDays
                    });
                } else {
                    resolve({
                        status: `✅ В порядке (истекает через ${diffDays} дней)`,
                        daysRemaining: diffDays
                    });
                }
            } catch (parseError) {
                resolve({
                    status: '❌ Ошибка парсинга даты',
                    daysRemaining: null,
                    error: parseError.message
                });
            }
        });
    });
}


// --- 3. Настройка периодического мониторинга ---
function startMonitoring() {
    // Проверяем каждые 15 минут
    setInterval(async () => {
        // Проверка Nginx
        const nginxStatus = await checkNginxStatus();
        if (nginxStatus.status !== '✅ Активен') {
            sendCriticalError(`Nginx неактивен! Статус: ${nginxStatus.status}. Ошибка: ${nginxStatus.error}`, 'Мониторинг Nginx');
        }

        // Проверка SSL
        const sslStatus = await checkSslCertificate();
        if (sslStatus.daysRemaining !== null && sslStatus.daysRemaining <= 14) {
            // Отправляем критическое уведомление, если сертификат скоро истекает
             sendCriticalError(
                `SSL-сертификат для infocoffee.ru истекает через ${sslStatus.daysRemaining} дней!`,
                'Мониторинг SSL'
            );
        } else if (sslStatus.error) {
            sendCriticalError(`Ошибка при проверке SSL-сертификата: ${sslStatus.error}`, 'Мониторинг SSL');
        }

    }, 15 * 60 * 1000); 

    console.log('✅ Мониторинг состояния сервера запущен (Nginx & SSL).');
}

module.exports = {
    checkNginxStatus,
    checkSslCertificate,
    startMonitoring
};
