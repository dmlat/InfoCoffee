// frontend/src/api.js
import axios from 'axios';
import { clearUserDataFromLocalStorage, saveUserDataToLocalStorage } from './utils/user';

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
    baseURL: process.env.NODE_ENV === 'production' 
        ? 'https://infocoffee.ru/api' 
        : process.env.REACT_APP_API_BASE_URL || '/api'
});

// Новый перехватчик для эмуляции роли
apiClient.interceptors.request.use(config => {
  if (process.env.NODE_ENV === 'development') {
    const urlParams = new URLSearchParams(window.location.search);
    const emulatedRole = urlParams.get('role');
    if (emulatedRole) {
      config.headers['X-Emulated-Role'] = emulatedRole;
    }
  }
  return config;
}, error => Promise.reject(error));

apiClient.interceptors.request.use(
    (config) => {
        const token = localStorage.getItem('app_token');
        if (token) {
            config.headers['Authorization'] = `Bearer ${token}`;
        }
        return config;
    },
    (error) => Promise.reject(error)
);

function clearUserDataAndRedirect(reason = 'unknown_401') {
    clearUserDataFromLocalStorage(); // <-- Используем новую функцию
    window.dispatchEvent(new CustomEvent('authErrorRedirect', { detail: { reason } }));
}

apiClient.interceptors.response.use(
    (response) => response,
    async (error) => {
        const originalRequest = error.config;

        if (error.response?.status === 401 && originalRequest.url !== '/auth/refresh-app-token' && !originalRequest._retry) {
            if (isRefreshing) {
                return new Promise((resolve, reject) => {
                    failedQueue.push({ resolve, reject });
                }).then(token => {
                    originalRequest.headers['Authorization'] = 'Bearer ' + token;
                    return apiClient(originalRequest);
                }).catch(err => Promise.reject(err));
            }

            originalRequest._retry = true;
            isRefreshing = true;

            const tgInitData = window.Telegram?.WebApp?.initData;
            if (!tgInitData) {
                console.warn('[API Interceptor] 401: No Telegram initData for refresh.');
                clearUserDataAndRedirect('no_telegram_data_for_refresh');
                isRefreshing = false;
                return Promise.reject(error);
            }

            try {
                const refreshClient = axios.create({ 
                    baseURL: process.env.NODE_ENV === 'production' 
                        ? 'https://infocoffee.ru/api' 
                        : process.env.REACT_APP_API_BASE_URL || '/api' 
                });
                const rs = await refreshClient.post('/auth/refresh-app-token', { initData: tgInitData });

                if (rs.data.success && rs.data.token) {
                    const newAppToken = rs.data.token;
                    const newUserData = rs.data.user;

                    localStorage.setItem('app_token', newAppToken);
                    if (newUserData) {
                        // Используем новую функцию для сохранения, она обновляет все данные
                        saveUserDataToLocalStorage({ token: newAppToken, user: newUserData });
                    }
                    
                    // Уведомляем приложение о обновлении токена и данных пользователя
                    window.dispatchEvent(new CustomEvent('tokenRefreshed', { 
                        detail: { user: newUserData, token: newAppToken } 
                    }));

                    apiClient.defaults.headers.common['Authorization'] = 'Bearer ' + newAppToken;
                    originalRequest.headers['Authorization'] = 'Bearer ' + newAppToken;
                    processQueue(null, newAppToken);
                    return apiClient(originalRequest);
                } else {
                    throw new Error(rs.data.error || 'Token refresh failed');
                }
            } catch (refreshError) {
                console.error('[API Interceptor] Token refresh failed:', refreshError.message);
                processQueue(refreshError, null);
                clearUserDataAndRedirect('app_token_refresh_failed_backend');
                return Promise.reject(refreshError);
            } finally {
                isRefreshing = false;
            }
        }
        return Promise.reject(error);
    }
);

export default apiClient;