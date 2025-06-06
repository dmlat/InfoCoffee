// frontend/src/App.js
import React, { useEffect, useState, useCallback } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import RegisterPage from './pages/RegisterPage';
import Dashboard from './pages/Dashboard';
import apiClient from './api';
import './styles/auth.css';

function saveUserDataToLocalStorage(userData) {
    if (!userData) return;
    localStorage.setItem('userId', String(userData.userId || ''));
    localStorage.setItem('telegramId', String(userData.telegramId || ''));
    localStorage.setItem('userFirstName', userData.firstName || '');
    localStorage.setItem('userUsername', userData.username || '');
    localStorage.setItem('user_setup_date', userData.setup_date || '');
    localStorage.setItem('user_tax_system', userData.tax_system || '');
    localStorage.setItem('user_acquiring_rate', String(userData.acquiring || '0'));
    localStorage.setItem('userAccessLevel', userData.accessLevel || 'none');
}

function AuthHandler({ setAuthStatus }) {
  const navigate = useNavigate();
  const location = useLocation();
  
  const attemptTelegramAuth = useCallback(async () => {
      const token = localStorage.getItem('app_token');
      if (token && window.Telegram?.WebApp?.initData) {
          setAuthStatus(localStorage.getItem('userAccessLevel') === 'service' ? 'service_access' : 'authenticated');
          if (location.pathname === '/' || location.pathname.startsWith('/app-entry')) {
              navigate('/dashboard', { replace: true });
          }
          return;
      }

      if (window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initData) {
        try {
          window.Telegram.WebApp.ready();
          const initData = window.Telegram.WebApp.initData;
          
          if (window.Telegram.WebApp.initDataUnsafe?.user) {
            localStorage.setItem('telegram_id_unsafe', String(window.Telegram.WebApp.initDataUnsafe.user.id));
            localStorage.setItem('firstName_unsafe', window.Telegram.WebApp.initDataUnsafe.user.first_name || '');
            localStorage.setItem('username_unsafe', window.Telegram.WebApp.initDataUnsafe.user.username || '');
          }

          const response = await apiClient.post('/auth/telegram-handshake', { initData });
          
          if (response.data.success) {
              const { action, token, user } = response.data;
              if ((action === 'login_success' || action === 'login_shared_access') && token) {
                  localStorage.setItem('app_token', token);
                  saveUserDataToLocalStorage(user);

                  if (user.accessLevel === 'service') {
                      setAuthStatus('service_access');
                  } else {
                      setAuthStatus('authenticated');
                      if (location.pathname === '/' || location.pathname.startsWith('/app-entry')) {
                          navigate('/dashboard', { replace: true });
                      }
                  }
              } else if (action === 'registration_required' || action === 'registration_incomplete') {
                  setAuthStatus(action);
                  const queryParams = new URLSearchParams({
                      status: action,
                      tg_id: response.data.telegram_id,
                      firstName: response.data.firstName || '',
                      username: response.data.username || ''
                  });
                  navigate(`/register?${queryParams.toString()}`, { replace: true });
              } else {
                  setAuthStatus('error');
                  navigate('/app-entry?reason=handshake_unknown_action', { replace: true });
              }
          } else {
            setAuthStatus('error');
            navigate('/app-entry?reason=handshake_failed_backend', { replace: true });
          }
        } catch (error) {
          setAuthStatus('error');
          navigate('/app-entry?reason=handshake_api_error', { replace: true });
        }
      } else {
          setAuthStatus('no_telegram_or_token');
          if (!location.pathname.startsWith('/app-entry') && !location.pathname.startsWith('/register')) {
              navigate('/app-entry?reason=no_context_no_token', { replace: true });
          }
      }
  }, [navigate, setAuthStatus, location.pathname]);

  useEffect(() => {
    attemptTelegramAuth();
  }, [attemptTelegramAuth]);

  return null; // Этот компонент не рендерит UI, только управляет логикой
}

function App() {
  // isAuth будет обновляться через setAuthStatus, но первоначальное значение берем из токена
  const [isAuth, setIsAuth] = useState(() => !!localStorage.getItem('app_token'));
  const [authStatus, setAuthStatus] = useState('pending');

  const handleSetIsAuth = (status) => {
      setIsAuth(status);
      setAuthStatus(status ? 'authenticated' : 'logged_out');
  };

  useEffect(() => {
    const handleStorageChange = (event) => {
      if (event.key === 'app_token' || event.key === null) {
        const currentTokenExists = !!localStorage.getItem('app_token');
        if (isAuth !== currentTokenExists) {
            handleSetIsAuth(currentTokenExists);
        }
      }
    };
     window.addEventListener('storage', handleStorageChange);
     return () => window.removeEventListener('storage', handleStorageChange);
  }, [isAuth]);

  if (authStatus === 'pending') {
      return (
          <Router>
              <AuthHandler setAuthStatus={setAuthStatus} />
              <div className="app-loading-container"><span>Загрузка приложения...</span></div>
          </Router>
      );
  }
  
  if (authStatus === 'service_access') {
      return <ServiceUserPage />;
  }
  
  return (
    <Router>
      <Routes>
        <Route path="/app-entry" element={<AppEntryPage />} />
        <Route path="/register" element={<RegisterPage setIsAuth={handleSetIsAuth} />} />
        <Route 
          path="/dashboard/*"
          element={
            isAuth ? (
              <Dashboard setIsAuth={handleSetIsAuth} />
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

function ServiceUserPage() {
    return (
        <div className="app-entry-container">
            <h2>Доступ для обслуживания</h2>
            <p>Ваш аккаунт настроен для получения уведомлений об обслуживании кофеен. Вам не доступен полный дашборд. Все уведомления будут приходить в ваш Telegram-бот.</p>
             {window.Telegram && window.Telegram.WebApp && (
                <button 
                    className="action-btn" 
                    onClick={() => window.Telegram.WebApp.close && window.Telegram.WebApp.close()}
                    style={{marginTop: '15px'}}
                >
                    Закрыть
                </button>
            )}
        </div>
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