// frontend/src/App.js
import React, { useEffect, useState, useCallback } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import RegisterPage from './pages/RegisterPage';
import Dashboard from './pages/Dashboard';
import apiClient from './api'; // Предполагается, что apiClient настроен для работы с токенами

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
  const [authStatus, setAuthStatus] = useState('pending'); // 'pending', 'authenticated', 'registration_required', 'registration_incomplete', 'error', 'no_telegram_or_token', 'logged_out', 'error_redirect'

  const attemptTelegramAuth = useCallback(async () => {
    if (window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initData) {
      try {
        window.Telegram.WebApp.ready(); // Сообщаем Telegram, что приложение готово
        const initData = window.Telegram.WebApp.initData;
        
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
            console.log(`[AuthHandler] Registration action: ${response.data.action}`);
            setIsAuth(false);
            setAuthStatus(response.data.action);
            const queryParams = new URLSearchParams();
            queryParams.set('status', response.data.action);
            queryParams.set('tg_id', response.data.telegram_id);
            if(response.data.firstName) queryParams.set('firstName', response.data.firstName);
            if(response.data.username) queryParams.set('username', response.data.username);
            navigate(`/register?${queryParams.toString()}`, { replace: true });
          } else {
            console.error('[AuthHandler] Unknown successful action from telegram-handshake:', response.data.action);
            setIsAuth(false);
            setAuthStatus('error'); // Неизвестное действие, считаем ошибкой
            navigate('/app-entry?reason=handshake_unknown_action', { replace: true });
          }
        } else {
          console.error('[AuthHandler] Telegram handshake failed (success:false):', response.data.error);
          setIsAuth(false);
          setAuthStatus('error');
          navigate('/app-entry?reason=handshake_failed_backend', { replace: true });
        }
      } catch (error) {
        console.error('[AuthHandler] Error during Telegram handshake API call:', error.response?.data?.error || error.message);
        setIsAuth(false);
        setAuthStatus('error');
        navigate('/app-entry?reason=handshake_api_error', { replace: true });
      }
    } else {
        console.log('[AuthHandler] Not in Telegram Web App or no initData.');
        const token = localStorage.getItem('app_token');
        if (token) {
            // В идеале, здесь бы сделать тихий запрос к /api/auth/verify-token или подобному,
            // чтобы убедиться, что токен все еще валиден, перед тем как считать пользователя аутентифицированным.
            // Пока что, если токен есть, считаем, что все хорошо для упрощения.
            console.log('[AuthHandler] Found existing app_token. Assuming authenticated.');
            setIsAuth(true);
            setAuthStatus('authenticated');
            if (location.pathname === '/' || location.pathname.startsWith('/app-entry')) {
                navigate('/dashboard', { replace: true });
            }
        } else {
            setIsAuth(false);
            setAuthStatus('no_telegram_or_token');
            console.log("[AuthHandler] No Telegram context and no existing app_token found. Redirecting to app-entry.");
            // Если мы не в Telegram и нет токена, показываем AppEntryPage или страницу логина, если такая есть
            if (!location.pathname.startsWith('/app-entry')) { // Предотвращаем цикл редиректов на /app-entry
                 navigate('/app-entry?reason=no_context_no_token', { replace: true });
            }
        }
    }
  }, [navigate, setIsAuth, location.pathname]); // location.pathname добавлен для перезапуска при смене пути, если нужно

  useEffect(() => {
    attemptTelegramAuth();
  }, [attemptTelegramAuth]); // Запускаем при монтировании

  useEffect(() => {
    // Слушаем изменения app_token в localStorage (может быть изменено другой вкладкой или clearUserDataAndRedirect)
    const handleStorageChange = (event) => {
      if (event.key === 'app_token' || event.key === null) { // event.key === null для localStorage.clear()
        const currentTokenExists = !!localStorage.getItem('app_token');
        if (isAuth !== currentTokenExists) {
          setIsAuth(currentTokenExists);
          if (!currentTokenExists) {
            console.log('[AuthHandler] app_token removed from storage. Logging out.');
            setAuthStatus('logged_out'); // Обновляем статус
            if (!location.pathname.startsWith('/app-entry') && !location.pathname.startsWith('/register')) {
              navigate('/app-entry?reason=logged_out_storage', { replace: true });
            }
          }
        }
      }
    };

    // Слушаем кастомное событие от api.js для немедленной реакции на ошибки аутентификации
    const handleAuthErrorRedirect = (event) => {
      console.log('[AuthHandler] Received authErrorRedirect event:', event.detail);
      setIsAuth(false);
      setAuthStatus('error_redirect'); 
      // Проверяем, что мы еще не на /app-entry или /register, чтобы избежать редиректа на ту же страницу
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
  }, [isAuth, setIsAuth, navigate, location.pathname]); // location.pathname добавлен для корректной навигации

  // Отображение состояний
  if (authStatus === 'pending') {
    return <div className="app-loading-container"><span>Загрузка приложения...</span></div>;
  }

  // Если это одна из страниц, где AuthHandler не должен блокировать рендер (например, Register), то не рендерим ошибки здесь
  if (location.pathname.startsWith('/register') && (authStatus === 'registration_required' || authStatus === 'registration_incomplete')) {
      return null; // Позволяем RegisterPage отрендериться
  }

  // Ошибки или состояния, требующие перехода на AppEntryPage
  if (['error', 'no_telegram_or_token', 'logged_out', 'error_redirect'].includes(authStatus) && 
      !location.pathname.startsWith('/app-entry') && // Предотвращаем рендер ошибки, если уже на app-entry
      !location.pathname.startsWith('/register')) { // Или на странице регистрации
      // Редирект уже должен был произойти, но на всякий случай показываем заглушку
      return (
          <div className="app-error-container">
              <h3>Ошибка аутентификации</h3>
              <p>Произошла ошибка при попытке входа. Попробуйте перезапустить приложение из Telegram.</p>
          </div>
      );
  }
  
  return null; // В остальных случаях (например, 'authenticated' или на пути к /register) AuthHandler не рендерит UI
}

function App() {
  // Начальное состояние isAuth берется из localStorage
  const [isAuth, setIsAuth] = useState(() => !!localStorage.getItem('app_token'));

  // Этот useEffect для синхронизации isAuth с localStorage при ручном изменении токена (например, в dev tools)
  // и для реакции на событие 'authChangeFromChild' (если нужно будет)
  useEffect(() => {
    const handleAppTokenChange = () => {
        setIsAuth(!!localStorage.getItem('app_token'));
    };
    window.addEventListener('storage', handleAppTokenChange); // Слушаем общие изменения storage
    // Можно добавить и другие кастомные события, если они устанавливают app_token
    return () => {
        window.removeEventListener('storage', handleAppTokenChange);
    };
  }, []);


  // Компонент App не должен иметь класс .App, если #root уже стилизован соответствующим образом
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
              <Dashboard setIsAuth={setIsAuth} /> // Передаем setIsAuth для кнопки Выход
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
        {/* Можно добавить сюда NotFoundPage */}
        <Route path="*" element={<Navigate to="/" replace />} /> 
      </Routes>
    </Router>
  );
}

function AppEntryPage() {
    const location = useLocation();
    const params = new URLSearchParams(location.search);
    const reason = params.get('reason') || 'default'; // Добавил default, если причина не указана

    let message = "Пожалуйста, откройте это приложение через вашего Telegram бота.";
    if (reason === 'unauthenticated' || reason === 'logged_out_storage' || reason === 'auth_error_api' || reason === 'error_redirect') {
        message = "Сессия недействительна или произошла ошибка. Пожалуйста, перезапустите приложение в Telegram.";
    } else if (reason === 'handshake_failed_backend' || reason === 'handshake_api_error' || reason === 'handshake_unknown_action') {
        message = "Не удалось связаться с сервером для аутентификации. Попробуйте позже или перезапустите приложение.";
    } else if (reason === 'no_context_no_token') {
        message = "Для доступа к приложению необходима аутентификация через Telegram.";
    }
    
    useEffect(() => {
        // Убедимся, что Telegram WebApp API готово, если мы в контексте Telegram
        if (window.Telegram && window.Telegram.WebApp) {
            window.Telegram.WebApp.ready();
            // Можно добавить здесь window.Telegram.WebApp.expand(); если нужно развернуть окно
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
                    style={{marginTop: '15px'}} // Небольшой отступ для кнопки
                >
                    Закрыть
                </button>
            )}
        </div>
    );
}

export default App;