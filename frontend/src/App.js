// frontend/src/App.js
import React, { useEffect, useState, useCallback } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import RegisterPage from './pages/RegisterPage';
import Dashboard from './pages/Dashboard';
import apiClient from './api';
import './styles/auth.css'; // Стили для страниц аутентификации/регистрации

// Утилита для сохранения данных пользователя в localStorage
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

function AuthHandler({ setIsAuth, isAuth }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [authStatus, setAuthStatus] = useState('pending');

  const attemptTelegramAuth = useCallback(async () => {
    if (window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initData) {
      try {
        window.Telegram.WebApp.ready();
        const initData = window.Telegram.WebApp.initData;
        
        if (window.Telegram.WebApp.initDataUnsafe && window.Telegram.WebApp.initDataUnsafe.user) {
          localStorage.setItem('telegram_id_unsafe', String(window.Telegram.WebApp.initDataUnsafe.user.id));
          localStorage.setItem('firstName_unsafe', window.Telegram.WebApp.initDataUnsafe.user.first_name || '');
          localStorage.setItem('username_unsafe', window.Telegram.WebApp.initDataUnsafe.user.username || '');
        }

        const response = await apiClient.post('/auth/telegram-handshake', { initData });
        
        if (response.data.success) {
          if (response.data.action === 'login_success' && response.data.token) {
            localStorage.setItem('app_token', response.data.token);
            saveUserDataToLocalStorage(response.data.user);
            setIsAuth(true);
            setAuthStatus('authenticated');
            if (location.pathname === '/' || location.pathname.startsWith('/app-entry')) {
                 navigate('/dashboard', { replace: true });
            }
          } else if (response.data.action === 'registration_required' || response.data.action === 'registration_incomplete') {
            setIsAuth(false);
            setAuthStatus(response.data.action);
            const queryParams = new URLSearchParams();
            queryParams.set('status', response.data.action);
            queryParams.set('tg_id', response.data.telegram_id);
            if(response.data.firstName) queryParams.set('firstName', response.data.firstName);
            if(response.data.username) queryParams.set('username', response.data.username);
            navigate(`/register?${queryParams.toString()}`, { replace: true });
          } else {
            setIsAuth(false);
            setAuthStatus('error');
            navigate('/app-entry?reason=handshake_unknown_action', { replace: true });
          }
        } else {
          setIsAuth(false);
          setAuthStatus('error');
          navigate('/app-entry?reason=handshake_failed_backend', { replace: true });
        }
      } catch (error) {
        setIsAuth(false);
        setAuthStatus('error');
        navigate('/app-entry?reason=handshake_api_error', { replace: true });
      }
    } else {
        const token = localStorage.getItem('app_token');
        if (token) {
            setIsAuth(true);
            setAuthStatus('authenticated');
            if (location.pathname === '/' || location.pathname.startsWith('/app-entry')) {
                navigate('/dashboard', { replace: true });
            }
        } else {
            setIsAuth(false);
            setAuthStatus('no_telegram_or_token');
            if (!location.pathname.startsWith('/app-entry')) {
                 navigate('/app-entry?reason=no_context_no_token', { replace: true });
            }
        }
    }
  }, [navigate, setIsAuth, location.pathname]);

  useEffect(() => {
    attemptTelegramAuth();
  }, [attemptTelegramAuth]);

  useEffect(() => {
    const handleStorageChange = (event) => {
      if (event.key === 'app_token' || event.key === null) {
        const currentTokenExists = !!localStorage.getItem('app_token');
        if (isAuth !== currentTokenExists) {
          setIsAuth(currentTokenExists);
          if (!currentTokenExists) {
            setAuthStatus('logged_out');
            if (!location.pathname.startsWith('/app-entry') && !location.pathname.startsWith('/register')) {
              navigate('/app-entry?reason=logged_out_storage', { replace: true });
            }
          }
        }
      }
    };

    const handleAuthErrorRedirect = (event) => {
      setIsAuth(false);
      setAuthStatus('error_redirect'); 
      if (!location.pathname.startsWith('/app-entry') && !location.pathname.startsWith('/register')) {
        navigate(`/app-entry?reason=${event.detail?.reason || 'auth_error_api'}`, { replace: true });
      }
    };

    window.addEventListener('storage', handleStorageChange);
    window.addEventListener('authErrorRedirect', handleAuthErrorRedirect);
    return () => {
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener('authErrorRedirect', handleAuthErrorRedirect);
    };
  }, [isAuth, setIsAuth, navigate, location.pathname]);

  if (authStatus === 'pending') {
    return <div className="app-loading-container"><span>Загрузка приложения...</span></div>;
  }

  if (location.pathname.startsWith('/register') && (authStatus === 'registration_required' || authStatus === 'registration_incomplete')) {
      return null;
  }

  if (['error', 'no_telegram_or_token', 'logged_out', 'error_redirect'].includes(authStatus) && 
      !location.pathname.startsWith('/app-entry') &&
      !location.pathname.startsWith('/register')) {
      return (
          <div className="app-error-container">
              <h3>Ошибка аутентификации</h3>
              <p>Произошла ошибка при попытке входа. Попробуйте перезапустить приложение из Telegram.</p>
          </div>
      );
  }
  
  return null;
}

function App() {
  const [isAuth, setIsAuth] = useState(() => !!localStorage.getItem('app_token'));

  useEffect(() => {
    const handleAppTokenChange = () => {
        setIsAuth(!!localStorage.getItem('app_token'));
    };
    window.addEventListener('storage', handleAppTokenChange);
    return () => {
        window.removeEventListener('storage', handleAppTokenChange);
    };
  }, []);

  return (
    <Router>
      <AuthHandler setIsAuth={setIsAuth} isAuth={isAuth} />
      <Routes>
        <Route path="/app-entry" element={<AppEntryPage />} />
        <Route path="/register" element={<RegisterPage setIsAuth={setIsAuth} />} />
        <Route 
          path="/dashboard/*"
          element={
            isAuth ? (
              <Dashboard setIsAuth={setIsAuth} />
            ) : (
              <Navigate to="/app-entry?reason=unauthenticated" replace />
            )
          } 
        />
        <Route 
          path="/" 
          element={
            <Navigate to={isAuth ? "/dashboard" : "/app-entry?reason=default_redirect"} replace />
          } 
        />
        <Route path="*" element={<Navigate to="/" replace />} /> 
      </Routes>
    </Router>
  );
}

function AppEntryPage() {
    const location = useLocation();
    const params = new URLSearchParams(location.search);
    const reason = params.get('reason') || 'default';

    let message = "Пожалуйста, откройте это приложение через вашего Telegram бота.";
    if (reason === 'unauthenticated' || reason === 'logged_out_storage' || reason === 'auth_error_api' || reason === 'error_redirect') {
        message = "Сессия недействительна или произошла ошибка. Пожалуйста, перезапустите приложение в Telegram.";
    } else if (reason === 'handshake_failed_backend' || reason === 'handshake_api_error' || reason === 'handshake_unknown_action') {
        message = "Не удалось связаться с сервером для аутентификации. Попробуйте позже или перезапустите приложение.";
    } else if (reason === 'no_context_no_token') {
        message = "Для доступа к приложению необходима аутентификация через Telegram.";
    }
    
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
                <button 
                    className="action-btn" 
                    onClick={() => {
                        if (window.Telegram.WebApp.close) {
                            window.Telegram.WebApp.close();
                        }
                    }}
                    style={{marginTop: '15px'}}
                >
                    Закрыть
                </button>
            )}
        </div>
    );
}

export default App;