// frontend/src/App.js
import React, { useEffect, useState, useCallback } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import RegisterPage from './pages/RegisterPage';
import Dashboard from './pages/Dashboard';
import apiClient from './api';

// Утилита для сохранения данных пользователя в localStorage
function saveUserDataToLocalStorage(userData) {
    if (!userData) return;
    localStorage.setItem('userId', String(userData.userId || ''));
    localStorage.setItem('telegramId', String(userData.telegramId || '')); // Сохраняем telegramId
    localStorage.setItem('userFirstName', userData.firstName || '');
    localStorage.setItem('userUsername', userData.username || '');
    localStorage.setItem('user_setup_date', userData.setup_date || '');
    localStorage.setItem('user_tax_system', userData.tax_system || '');
    localStorage.setItem('user_acquiring_rate', String(userData.acquiring || '0'));
}


function AuthHandler({ setIsAuth, isAuth }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [authStatus, setAuthStatus] = useState('pending'); 

  const attemptTelegramAuth = useCallback(async () => {
    if (window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initData) {
      try {
        window.Telegram.WebApp.ready();
        const initData = window.Telegram.WebApp.initData;
        
        // Сохраняем telegram_id из initDataUnsafe для использования в RegisterPage, если потребуется
        // initDataUnsafe доступен сразу, в отличие от user из initData после валидации
        if (window.Telegram.WebApp.initDataUnsafe && window.Telegram.WebApp.initDataUnsafe.user) {
          localStorage.setItem('telegram_id_unsafe', String(window.Telegram.WebApp.initDataUnsafe.user.id));
          localStorage.setItem('firstName_unsafe', window.Telegram.WebApp.initDataUnsafe.user.first_name || '');
          localStorage.setItem('username_unsafe', window.Telegram.WebApp.initDataUnsafe.user.username || '');
        }

        console.log('[AuthHandler] Sending initData to /api/auth/telegram-handshake');
        const response = await apiClient.post('/auth/telegram-handshake', { initData });
        
        if (response.data.success) {
          if (response.data.action === 'login_success' && response.data.token) {
            console.log('[AuthHandler] Login success from handshake');
            localStorage.setItem('app_token', response.data.token);
            saveUserDataToLocalStorage(response.data.user);
            setIsAuth(true);
            setAuthStatus('authenticated');
            if (location.pathname === '/' || location.pathname.startsWith('/app-entry')) {
                 navigate('/dashboard', { replace: true });
            }
          } else if (response.data.action === 'registration_required' || response.data.action === 'registration_incomplete') {
            console.log(`[AuthHandler] Registration required/incomplete: ${response.data.action}`);
            setIsAuth(false);
            setAuthStatus(response.data.action);
            // Передаем данные пользователя из ответа, если они есть (firstName, username)
            const queryParams = new URLSearchParams();
            queryParams.set('status', response.data.action);
            queryParams.set('tg_id', response.data.telegram_id);
            if(response.data.firstName) queryParams.set('firstName', response.data.firstName);
            if(response.data.username) queryParams.set('username', response.data.username);
            navigate(`/register?${queryParams.toString()}`, { replace: true });

          } else {
            setIsAuth(false);
            setAuthStatus('error');
            console.error('[AuthHandler] Unknown action from telegram-handshake:', response.data.action);
          }
        } else {
          setIsAuth(false);
          setAuthStatus('error');
          console.error('[AuthHandler] Telegram handshake failed:', response.data.error);
        }
      } catch (error) {
        setIsAuth(false);
        setAuthStatus('error');
        console.error('[AuthHandler] Error during Telegram handshake attempt:', error.response?.data?.error || error.message);
      }
    } else {
        console.log('[AuthHandler] Not in Telegram Web App or no initData.');
        const token = localStorage.getItem('app_token');
        if (token) {
            // Можно добавить проверку валидности токена здесь, сделав запрос к защищенному эндпоинту
            console.log('[AuthHandler] Found existing app_token. Assuming authenticated for now.');
            setIsAuth(true);
            setAuthStatus('authenticated');
            if (location.pathname === '/' || location.pathname.startsWith('/app-entry')) {
                navigate('/dashboard', { replace: true });
            }
        } else {
            setIsAuth(false);
            setAuthStatus('no_telegram_or_token');
            console.log("[AuthHandler] No Telegram context and no existing app_token found.");
        }
    }
  }, [navigate, setIsAuth, location.pathname]);

  useEffect(() => {
    attemptTelegramAuth();
  }, [attemptTelegramAuth]);

  useEffect(() => {
    const handleStorageChange = (event) => {
      if (event.key === 'app_token') {
        const currentToken = !!localStorage.getItem('app_token');
        if (isAuth !== currentToken) {
          setIsAuth(currentToken);
          if (!currentToken) {
            setAuthStatus('logged_out');
            navigate('/app-entry?reason=logged_out_external', { replace: true });
          }
        }
      }
    };
    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, [isAuth, setIsAuth, navigate]);

  if (authStatus === 'pending') {
    return <div className="app-loading-container"><span>Загрузка приложения...</span></div>;
  }

  if (authStatus === 'error' || authStatus === 'no_telegram_or_token') {
      return (
          <div className="app-error-container">
              <h3>Ошибка аутентификации</h3>
              <p>Не удалось войти в приложение. Убедитесь, что вы открываете его через Telegram.</p>
              {/* <button onClick={attemptTelegramAuth}>Попробовать снова</button> */}
          </div>
      );
  }
  return null;
}

function App() {
  const [isAuth, setIsAuth] = useState(!!localStorage.getItem('app_token'));

  return (
    <Router>
      <AuthHandler setIsAuth={setIsAuth} isAuth={isAuth} />
      <Routes>
        <Route path="/app-entry" element={<AppEntryPage />} />
        <Route path="/register" element={<RegisterPage setIsAuth={setIsAuth} />} />
        <Route 
          path="/dashboard/*"
          element={isAuth ? <Dashboard setIsAuth={setIsAuth} /> : <Navigate to="/app-entry?reason=unauthenticated" replace />} 
        />
        <Route 
          path="/" 
          element={<Navigate to={isAuth ? "/dashboard" : "/app-entry?reason=default_redirect"} replace />} 
        />
        <Route path="*" element={<Navigate to="/" replace />} /> {/* Fallback to root */}
      </Routes>
    </Router>
  );
}

function AppEntryPage() {
    const location = useLocation();
    const params = new URLSearchParams(location.search);
    const reason = params.get('reason') || params.get('error');

    let message = "Пожалуйста, откройте это приложение через вашего Telegram бота.";
    if (reason === 'unauthenticated' || reason === 'logged_out_external') message = "Сессия недействительна. Пожалуйста, перезапустите приложение в Telegram.";
    
    useEffect(() => {
        if (window.Telegram && window.Telegram.WebApp) {
            window.Telegram.WebApp.ready();
        }
    }, []);

    return (
        <div className="app-entry-container">
            <h2>InfoCoffee Analytics</h2>
            <p>{message}</p>
            {window.Telegram && window.Telegram.WebApp && (
                <button className="action-btn" onClick={() => {
                    if (window.Telegram.WebApp.close) {
                        window.Telegram.WebApp.close();
                    }
                }}>Закрыть</button>
            )}
        </div>
    );
}

export default App;