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
  baseURL: '/api' // Base URL from proxy in package.json or direct
});

apiClient.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('app_token'); // Changed key for clarity
    if (token) {
      config.headers['Authorization'] = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

function redirectToLogin(reason = 'unknown_401') {
  console.log(`Redirecting to login. Reason: ${reason}`);
  localStorage.removeItem('app_token');
  localStorage.removeItem('userId');
  localStorage.removeItem('telegram_id'); // Keep telegram_id if useful for re-auth
  localStorage.removeItem('user_setup_date');
  localStorage.removeItem('user_tax_system');
  localStorage.removeItem('user_acquiring_rate');

  Object.keys(localStorage).forEach(key => {
    if (key.startsWith('financesPage_') || key.startsWith('profilePage_')) {
      localStorage.removeItem(key);
    }
  });

  // If inside Telegram Web App, it might not make sense to redirect to a /login page.
  // The app should instead guide the user to re-authenticate via Telegram.
  // For now, this redirect might be for non-Telegram context or initial setup.
  if (window.Telegram && window.Telegram.WebApp) {
    // window.Telegram.WebApp.close(); // Or show a message to restart/re-open
    console.error("Session expired or invalid within Telegram Web App. User may need to reopen the Web App.");
    // Display a message to the user within the app interface instead of redirecting.
    // For MVP, a simple alert or message on the page could work.
    // For a better UX, handle this state within your App component.
  } else if (window.location.pathname !== '/register' && !window.location.pathname.startsWith('/app-entry')) {
    // Redirect to a generic entry/error page if not in Telegram
    const queryParams = new URLSearchParams();
    queryParams.set('session_expired', 'true');
    queryParams.set('reason', reason);
    // window.location.href = `/app-entry?${queryParams.toString()}`; // New generic entry page
  }
}


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
          return Promise.reject(err);
        });
      }

      originalRequest._retry = true;
      isRefreshing = true;

      const tgInitData = window.Telegram?.WebApp?.initData;

      if (tgInitData) {
        console.log('[API Interceptor] 401: Attempting app token refresh via Telegram initData.');
        try {
          const rs = await axios.post('/api/auth/refresh-app-token', { // Using axios directly to avoid loop
            initData: tgInitData,
          });

          if (rs.data.success && rs.data.token) {
            console.log('[API Interceptor] App token successfully refreshed via Telegram.');
            const newAppToken = rs.data.token;
            localStorage.setItem('app_token', newAppToken);
            if (rs.data.user) {
                localStorage.setItem('userId', String(rs.data.user.userId || ''));
                // Update other user details if needed
                localStorage.setItem('user_setup_date', rs.data.user.setup_date || '');
                localStorage.setItem('user_tax_system', rs.data.user.tax_system || '');
                localStorage.setItem('user_acquiring_rate', String(rs.data.user.acquiring || '0'));
            }
            apiClient.defaults.headers.common['Authorization'] = 'Bearer ' + newAppToken;
            originalRequest.headers['Authorization'] = 'Bearer ' + newAppToken;
            processQueue(null, newAppToken);
            return apiClient(originalRequest);
          } else {
            console.warn('[API Interceptor] App token refresh failed (backend response):', rs.data.error);
            processQueue(rs.data.error || new Error('App token refresh failed, backend responded.'), null);
            redirectToLogin('app_token_refresh_failed_backend');
            return Promise.reject(rs.data.error || new Error('App token refresh failed'));
          }
        } catch (refreshError) {
          console.error('[API Interceptor] Error during app token refresh request:', refreshError.response?.data || refreshError.message);
          processQueue(refreshError, null);
          redirectToLogin('app_token_refresh_error_request');
          return Promise.reject(refreshError);
        } finally {
          isRefreshing = false;
        }
      } else {
        console.log('[API Interceptor] 401: No Telegram initData available for refresh. Redirecting.');
        isRefreshing = false;
        processQueue(error, null);
        redirectToLogin('no_telegram_data_for_refresh');
        return Promise.reject(error);
      }
    }
    return Promise.reject(error);
  }
);

export default apiClient;