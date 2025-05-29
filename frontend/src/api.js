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
  baseURL: process.env.REACT_APP_API_BASE_URL || '/api' // Убедись, что baseURL настроен
});

apiClient.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('app_token');
    if (token) {
      config.headers['Authorization'] = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

function clearUserDataAndRedirect(reason = 'unknown_401') {
  console.log(`Clearing user data and potentially redirecting. Reason: ${reason}`);
  localStorage.removeItem('app_token');
  localStorage.removeItem('userId');
  localStorage.removeItem('telegramId');
  localStorage.removeItem('userFirstName');
  localStorage.removeItem('userUsername');
  localStorage.removeItem('user_setup_date');
  localStorage.removeItem('user_tax_system');
  localStorage.removeItem('user_acquiring_rate');
  localStorage.removeItem('telegram_id_unsafe'); // Очищаем и это
  localStorage.removeItem('firstName_unsafe');
  localStorage.removeItem('username_unsafe');


  Object.keys(localStorage).forEach(key => {
    if (key.startsWith('financesPage_') || key.startsWith('profilePage_')) {
      localStorage.removeItem(key);
    }
  });
  
  // Вместо прямого редиректа, можно просто обновить состояние isAuth в App.js,
  // а App.js уже решит, куда направить пользователя (на /app-entry).
  // Диспатчим событие, чтобы App.js мог отреагировать.
  window.dispatchEvent(new CustomEvent('authErrorRedirect', { detail: { reason } }));

  // Старый код редиректа, если нужен прямой редирект из api.js (менее предпочтительно)
  // if (window.Telegram && window.Telegram.WebApp) {
  //   // console.error("Session expired. Please reopen the Web App via Telegram.");
  // } else if (!window.location.pathname.startsWith('/app-entry')) {
  //   // window.location.href = `/app-entry?reason=${reason}`;
  // }
}


apiClient.interceptors.response.use(
  (response) => {
    return response;
  },
  async (error) => {
    const originalRequest = error.config;

    // Проверяем, что это ошибка 401 и не повторный запрос на refresh-app-token
    if (error.response && error.response.status === 401 && originalRequest.url !== '/auth/refresh-app-token' && !originalRequest._retry) {
      if (isRefreshing) {
        return new Promise(function(resolve, reject) {
          failedQueue.push({ resolve, reject });
        }).then(token => {
          originalRequest.headers['Authorization'] = 'Bearer ' + token;
          return apiClient(originalRequest); // apiClient (originalRequest) - это рекурсивный вызов axios
        }).catch(err => {
          return Promise.reject(err);
        });
      }

      originalRequest._retry = true;
      isRefreshing = true;

      const tgInitData = window.Telegram?.WebApp?.initData;

      if (tgInitData) {
        console.log('[API Interceptor] 401: Attempting app token refresh via Telegram initData.');
        try {
          // Используем axios.create() без интерцепторов для этого запроса, чтобы избежать цикла
          const refreshClient = axios.create({ baseURL: process.env.REACT_APP_API_BASE_URL || '/api' });
          const rs = await refreshClient.post('/auth/refresh-app-token', { 
            initData: tgInitData,
          });

          if (rs.data.success && rs.data.token) {
            console.log('[API Interceptor] App token successfully refreshed.');
            const newAppToken = rs.data.token;
            localStorage.setItem('app_token', newAppToken);
            if (rs.data.user) { // Обновляем данные пользователя
                saveUserDataToLocalStorage(rs.data.user);
            }
            
            // Обновляем заголовок авторизации для apiClient по умолчанию
            apiClient.defaults.headers.common['Authorization'] = 'Bearer ' + newAppToken;
            // Обновляем заголовок для текущего оригинального запроса
            originalRequest.headers['Authorization'] = 'Bearer ' + newAppToken;
            
            processQueue(null, newAppToken);
            return apiClient(originalRequest); // Повторяем оригинальный запрос с новым токеном
          } else {
            console.warn('[API Interceptor] App token refresh failed (backend response):', rs.data.error);
            processQueue(rs.data.error || new Error('App token refresh failed, server responded error.'), null);
            clearUserDataAndRedirect('app_token_refresh_failed_backend');
            return Promise.reject(rs.data.error || new Error('App token refresh failed'));
          }
        } catch (refreshError) {
          console.error('[API Interceptor] Error during app token refresh request:', refreshError.response?.data || refreshError.message);
          processQueue(refreshError, null);
          clearUserDataAndRedirect('app_token_refresh_error_request');
          return Promise.reject(refreshError);
        } finally {
          isRefreshing = false;
        }
      } else {
        console.log('[API Interceptor] 401: No Telegram initData for refresh. Clearing data.');
        isRefreshing = false;
        processQueue(error, null);
        clearUserDataAndRedirect('no_telegram_data_for_refresh');
        return Promise.reject(error);
      }
    }
    return Promise.reject(error);
  }
);

// Вспомогательная функция для сохранения данных пользователя (дублируется из App.js для использования здесь)
// В идеале, это должно быть в общем утилитном файле
function saveUserDataToLocalStorage(userData) {
    if (!userData) return;
    localStorage.setItem('userId', String(userData.userId || ''));
    localStorage.setItem('telegramId', String(userData.telegramId || ''));
    localStorage.setItem('userFirstName', userData.firstName || '');
    localStorage.setItem('userUsername', userData.username || '');
    localStorage.setItem('user_setup_date', userData.setup_date || '');
    localStorage.setItem('user_tax_system', userData.tax_system || '');
    localStorage.setItem('user_acquiring_rate', String(userData.acquiring || '0'));
}


export default apiClient;