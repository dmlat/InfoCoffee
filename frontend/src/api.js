// frontend/src/api.js
import axios from 'axios';

let isRefreshing = false;
let failedQueue = [];

const processQueue = (error, token = null) => {
  failedQueue.forEach(prom => {
    if (error) {
      prom.reject(error);
    } else {
      prom.resolve(token);
    }
  });
  failedQueue = [];
};

const apiClient = axios.create({
  baseURL: '/api' // Базовый URL для всех API-запросов
});

apiClient.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token');
    if (token) {
      config.headers['Authorization'] = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

apiClient.interceptors.response.use(
  (response) => {
    return response;
  },
  async (error) => {
    const originalRequest = error.config;

    if (error.response && error.response.status === 401 && !originalRequest._retry) {
      if (isRefreshing) {
        return new Promise(function(resolve, reject) {
          failedQueue.push({ resolve, reject });
        }).then(token => {
          originalRequest.headers['Authorization'] = 'Bearer ' + token;
          return apiClient(originalRequest);
        }).catch(err => {
          return Promise.reject(err); // Возвращаем ошибку, если не удалось из очереди
        });
      }

      originalRequest._retry = true;
      isRefreshing = true;

      const tgUser = window.Telegram?.WebApp?.initDataUnsafe?.user;

      if (tgUser && tgUser.id) {
        console.log('[API Interceptor] Обнаружена ошибка 401. Попытка тихого обновления сессии через Telegram ID:', tgUser.id);
        try {
          // ИСПРАВЛЕННЫЙ URL: '/auth/refresh-session-via-telegram'
          const rs = await apiClient.post('/auth/refresh-session-via-telegram', {
            telegram_id: tgUser.id,
            // initData: window.Telegram.WebApp.initData // Можно передать для валидации на бэке
          });

          if (rs.data.success && rs.data.token) {
            console.log('[API Interceptor] Сессия успешно обновлена через Telegram.');
            const newToken = rs.data.token;
            localStorage.setItem('token', newToken);
            if (rs.data.user) {
                localStorage.setItem('vendista_login', rs.data.user.vendista_login || '');
                localStorage.setItem('userId', String(rs.data.user.userId || ''));
                localStorage.setItem('setup_date', rs.data.user.setup_date || '');
                localStorage.setItem('tax_system', rs.data.user.tax_system || '');
                localStorage.setItem('acquiring_rate', String(rs.data.user.acquiring || '0'));
            }
            
            // Обновляем токен в заголовках по умолчанию для последующих запросов в этом экземпляре apiClient
            apiClient.defaults.headers.common['Authorization'] = 'Bearer ' + newToken;
            // Обновляем токен в оригинальном запросе
            originalRequest.headers['Authorization'] = 'Bearer ' + newToken;
            
            processQueue(null, newToken); // Обрабатываем очередь ожидания с новым токеном
            return apiClient(originalRequest); // Повторяем оригинальный запрос
          } else {
            console.warn('[API Interceptor] Тихое обновление сессии не удалось (ответ от бэка):', rs.data.error);
            processQueue(rs.data.error || new Error('Silent refresh failed, backend responded.'), null);
            redirectToLogin('silent_refresh_failed');
            return Promise.reject(rs.data.error || new Error('Silent refresh failed, backend responded.'));
          }
        } catch (refreshError) {
          console.error('[API Interceptor] Ошибка при запросе тихого обновления сессии:', refreshError.response?.data || refreshError.message);
          processQueue(refreshError, null);
          redirectToLogin('silent_refresh_error');
          return Promise.reject(refreshError);
        } finally {
          isRefreshing = false;
        }
      } else {
        console.log('[API Interceptor] Ошибка 401, нет данных Telegram или не в Telegram Web App. Редирект на логин.');
        isRefreshing = false; 
        processQueue(error, null); // Отклоняем запросы в очереди, если они были
        redirectToLogin('no_telegram_data');
        return Promise.reject(error);
      }
    }
    return Promise.reject(error);
  }
);

function redirectToLogin(reason = 'unknown_401') {
    localStorage.removeItem('token');
    localStorage.removeItem('vendista_login');
    localStorage.removeItem('userId');
    localStorage.removeItem('setup_date');
    localStorage.removeItem('tax_system');
    localStorage.removeItem('acquiring_rate');
    // Очистим и ключи для финансов, чтобы не было старых данных при следующем входе
    Object.keys(localStorage).forEach(key => {
        if (key.startsWith('financesPage_')) {
            localStorage.removeItem(key);
        }
    });

    if (window.location.pathname !== '/login') {
        const queryParams = new URLSearchParams(window.location.search);
        queryParams.set('session_expired', 'true');
        queryParams.set('reason', reason); // Добавляем причину для возможной отладки или кастомного сообщения
        window.location.href = `/login?${queryParams.toString()}`;
    }
}

export default apiClient;