// frontend/src/utils/dev.js

/**
 * Development utilities for role emulation and testing.
 * В продакшене все функции возвращают заглушки.
 */

/**
 * Асинхронно инициализирует мок-объект Telegram WebApp для локальной разработки.
 * В продакшене не делает ничего.
 */
export async function initDevTelegram() {
    // Выполняем только в режиме разработки
    if (process.env.NODE_ENV !== 'development') {
        return;
    }

    // Если нет window (SSR) или уже в Telegram - ничего не делаем
    if (typeof window === 'undefined') {
        return;
    }

    const urlParams = new URLSearchParams(window.location.search);
    const role = urlParams.get('role'); // 'owner', 'admin', 'service'
    const shouldForceRegister = urlParams.get('register') === 'true';

    // Если нет ни эмуляции роли, ни принудительной регистрации, то ничего не делаем
    if (!role && !shouldForceRegister) {
        return;
    }

    // Если нужно принудительно запустить регистрацию
    if (shouldForceRegister) {
        console.log('[Dev Mode] Forcing registration flow. Storing mock user in localStorage and NOT mocking window.Telegram.');
        localStorage.setItem('telegram_id_unsafe', '280186359');
        localStorage.setItem('firstName_unsafe', 'Владелец (Тест Рег.)');
        localStorage.setItem('username_unsafe', 'dev_owner_reg_test');
        localStorage.removeItem('app_token');
        return;
    }

    // Если мы не в Telegram и есть роль для эмуляции - создаем мок
    if (role) {
        console.log('--- DEV MODE: Initializing Fake Telegram WebApp ---');

        // Получаем тестовые ID с бэкенда
        let devConfig;
        try {
            const api = await import('../api');
            const response = await api.default.get('/dev-config');
            devConfig = response.data;
        } catch (error) {
            console.error('[Dev Mode] Failed to fetch dev config from backend.', error);
            document.body.innerHTML = `<div style="font-family: sans-serif; padding: 2rem; background-color: #fff3f3; color: #ff0000;">
                <h2>Ошибка в режиме разработки</h2>
                <p>Не удалось загрузить конфигурацию для эмуляции роли (<code>/api/dev-config</code>).</p>
                <p>Убедитесь, что бэкенд-сервер запущен и в файле <code>backend/.env.development</code> прописаны переменные <code>DEV_OWNER_TELEGRAM_ID</code>, <code>DEV_ADMIN_TELEGRAM_ID</code>, <code>DEV_SERVICE_TELEGRAM_ID</code>.</p>
            </div>`;
            return;
        }

        let devTelegramId;
        let firstName;
        
        switch(role) {
            case 'service':
                console.log('[Dev Mode] Emulating SERVICE role.');
                devTelegramId = devConfig.serviceTelegramId;
                firstName = 'Сервис-инженер';
                break;
            case 'admin':
                console.log('[Dev Mode] Emulating ADMIN role.');
                devTelegramId = devConfig.adminTelegramId;
                firstName = 'Администратор';
                break;
            default:
                console.log(`[Dev Mode] Emulating ${role.toUpperCase()} role.`);
                devTelegramId = devConfig.ownerTelegramId;
                firstName = 'Владелец';
                break;
        }

        const user = {
            id: devTelegramId,
            first_name: firstName,
            last_name: 'Тест',
            username: `dev_${role}`,
            language_code: 'ru',
            is_premium: true,
            dev_role: role
        };

        const initData = new URLSearchParams({
            auth_date: Math.round(Date.now() / 1000),
            hash: 'dev_hash_lol_pipiska_sosiska',
            user: JSON.stringify(user),
        }).toString();

        window.Telegram = {
            WebApp: {
                initData: initData,
                initDataUnsafe: {
                    user: user,
                    auth_date: Math.round(Date.now() / 1000),
                    hash: 'dev_hash_lol_pipiska_sosiska',
                },
                ready: () => console.log('[Dev TG] WebApp.ready() called'),
                expand: () => console.log('[Dev TG] WebApp.expand() called'),
                close: () => console.log('[Dev TG] WebApp.close() called'),
            },
        };
    }
}

/**
 * Получение dev конфигурации с бэкенда.
 * В продакшене возвращает заглушку.
 */
export const fetchDevConfig = async () => {
    if (process.env.NODE_ENV !== 'development') {
        return Promise.resolve(null);
    }

    try {
        const api = await import('../api');
        const response = await api.default.get('/dev-config');
        return response.data;
    } catch (error) {
        console.error("Failed to fetch dev config. Full error object:", error);
        if (error.response) {
            console.error('Error data:', error.response.data);
            console.error('Error status:', error.response.status);
            console.error('Error headers:', error.response.headers);
        } else if (error.request) {
            console.error('Error request:', error.request);
        } else {
            console.error('Error message:', error.message);
        }
        throw error;
    }
};