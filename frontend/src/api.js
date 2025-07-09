// frontend/src/api.js
import axios from 'axios';
import { saveUserDataToLocalStorage, clearUserDataFromLocalStorage } from './utils/user'; // <-- ИМПОРТ

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
                console.log('[API Interceptor] 401: No Telegram initData for refresh.');
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
                    localStorage.setItem('app_token', newAppToken);
                    if (rs.data.user) {
                        saveUserDataToLocalStorage(rs.data.user); // <-- Используем новую функцию
                    }
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