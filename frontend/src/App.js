import React, { useEffect, useState, useCallback } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import RegisterPage from './pages/RegisterPage'; // Renamed for clarity
import Dashboard from './pages/Dashboard';
import apiClient from './api';

// Centralized Auth Handler Component
function AuthHandler({ setIsAuth, isAuth }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [authStatus, setAuthStatus] = useState('pending'); // pending, authenticated, registration_required, registration_incomplete, error

  const attemptTelegramLogin = useCallback(async () => {
    if (window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initData) {
      try {
        window.Telegram.WebApp.ready(); // Inform Telegram app is ready
        const initData = window.Telegram.WebApp.initData;
        localStorage.setItem('telegram_id', window.Telegram.WebApp.initDataUnsafe.user?.id); // Store for registration if needed

        const response = await apiClient.post('/auth/telegram-login', { initData });
        
        if (response.data.success) {
          if (response.data.action === 'login_success' && response.data.token) {
            localStorage.setItem('app_token', response.data.token);
            if (response.data.user) {
              localStorage.setItem('userId', String(response.data.user.userId));
              localStorage.setItem('user_setup_date', response.data.user.setup_date || '');
              localStorage.setItem('user_tax_system', response.data.user.tax_system || '');
              localStorage.setItem('user_acquiring_rate', String(response.data.user.acquiring || '0'));
            }
            setIsAuth(true);
            setAuthStatus('authenticated');
            if (location.pathname === '/' || location.pathname === '/app-entry') {
                 navigate('/dashboard', { replace: true });
            }
          } else if (response.data.action === 'registration_required' || response.data.action === 'registration_incomplete') {
            setIsAuth(false);
            setAuthStatus(response.data.action);
            navigate(`/register?status=${response.data.action}&tg_id=${response.data.telegram_id || localStorage.getItem('telegram_id')}`, { replace: true });
          } else {
            setIsAuth(false);
            setAuthStatus('error');
            console.error('Unknown action from telegram-login:', response.data.action);
            // navigate('/app-entry?error=unknown_auth_action', { replace: true }); // Or an error display page
          }
        } else {
          setIsAuth(false);
          setAuthStatus('error');
          console.error('Telegram login failed:', response.data.error);
          // navigate('/app-entry?error=telegram_login_failed', { replace: true });
        }
      } catch (error) {
        setIsAuth(false);
        setAuthStatus('error');
        console.error('Error during Telegram login attempt:', error.response?.data?.error || error.message);
        // navigate('/app-entry?error=telegram_login_exception', { replace: true });
      }
    } else {
        // Not in Telegram environment or no initData
        const token = localStorage.getItem('app_token');
        if (token) { // Maybe there's an existing valid token from a previous session
            setIsAuth(true);
            setAuthStatus('authenticated');
             if (location.pathname === '/' || location.pathname === '/app-entry') {
                navigate('/dashboard', { replace: true });
            }
        } else {
            setIsAuth(false);
            setAuthStatus('no_telegram_or_token'); // No Telegram, no token -> needs a way in or show error
            console.log("Not in Telegram Web App or no initData. No existing app_token found.");
            // For now, if not in TG and no token, they can't do much.
            // Consider a page that says "Please open via Telegram" or a non-TG login if that's ever a feature.
            // navigate('/app-entry?error=not_in_telegram', { replace: true });
        }
    }
  }, [navigate, setIsAuth, location.pathname]);

  useEffect(() => {
    attemptTelegramLogin();
  }, [attemptTelegramLogin]);

  // This effect handles re-checking auth status if localStorage changes from other tabs (less likely in TWA)
  useEffect(() => {
    const onStorageChange = () => {
      const currentToken = !!localStorage.getItem('app_token');
      if (isAuth !== currentToken) {
        setIsAuth(currentToken);
        if (!currentToken) {
          setAuthStatus('logged_out'); // Or another appropriate status
          // navigate('/app-entry?reason=logged_out', { replace: true });
        }
      }
    };
    window.addEventListener('storage', onStorageChange);
    return () => window.removeEventListener('storage', onStorageChange);
  }, [isAuth, setIsAuth, navigate]);


  if (authStatus === 'pending') {
    return <div className="app-loading-container"><span>Загрузка приложения...</span></div>; // Or a proper loader
  }
  // If in an error state or no_telegram_or_token, you might want to show a specific UI
  if (authStatus === 'error' || authStatus === 'no_telegram_or_token') {
      return (
          <div className="app-error-container">
              <h3>Ошибка аутентификации</h3>
              <p>Не удалось войти в приложение. Пожалуйста, убедитесь, что вы открываете приложение через Telegram и попробуйте снова.</p>
              <p>Если проблема сохраняется, обратитесь в поддержку.</p>
              {/* Можно добавить кнопку для повторной попытки */}
              {/* <button onClick={attemptTelegramLogin}>Попробовать снова</button> */}
          </div>
      );
  }


  return null; // AuthHandler doesn't render UI itself, it manages navigation
}


function App() {
  const [isAuth, setIsAuth] = useState(!!localStorage.getItem('app_token'));

  return (
    <Router>
      <AuthHandler setIsAuth={setIsAuth} isAuth={isAuth} />
      <Routes>
        {/* Public entry point for Telegram or if direct access shows an error/info */}
        <Route path="/app-entry" element={<AppEntryPage />} />
        <Route path="/register" element={<RegisterPage setIsAuth={setIsAuth} />} />
        <Route 
          path="/dashboard/*" // Allow nested routes in Dashboard
          element={isAuth ? <Dashboard setIsAuth={setIsAuth} /> : <Navigate to="/app-entry?reason=unauthenticated" replace />} 
        />
        <Route 
          path="/" 
          element={<Navigate to={isAuth ? "/dashboard" : "/app-entry?reason=default_redirect"} replace />} 
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Router>
  );
}

// Placeholder for an entry/error page
function AppEntryPage() {
    const location = useLocation();
    const params = new URLSearchParams(location.search);
    const reason = params.get('reason') || params.get('error');

    let message = "Пожалуйста, откройте это приложение через вашего Telegram бота.";
    if (reason === 'unauthenticated') message = "Сессия истекла или недействительна. Пожалуйста, перезапустите приложение в Telegram.";
    if (reason === 'logged_out') message = "Вы вышли из системы. Пожалуйста, перезапустите приложение в Telegram для входа.";
    // Add more messages based on 'reason' if needed

    useEffect(() => {
        // Try to initialize Telegram WebApp interface if available
        if (window.Telegram && window.Telegram.WebApp) {
            window.Telegram.WebApp.ready();
        }
    }, []);

    return (
        <div className="app-entry-container">
            <h2>InfoCoffee Analytics</h2>
            <p>{message}</p>
            {/* Optionally, a button to try to re-initiate login or close webapp */}
            {window.Telegram && window.Telegram.WebApp && (
                <button className="action-btn" onClick={() => window.Telegram.WebApp.close()}>Закрыть</button>
            )}
        </div>
    );
}

export default App;