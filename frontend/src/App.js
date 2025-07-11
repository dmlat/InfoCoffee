// frontend/src/App.js
import React, { useEffect, useState, useCallback } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import RegisterPage from './pages/RegisterPage';
import Dashboard from './pages/Dashboard';
import ServiceTaskPage from './pages/ServiceTaskPage'; // <-- НОВЫЙ ИМПОРТ
import apiClient from './api';
import { saveUserDataToLocalStorage, clearUserDataFromLocalStorage } from './utils/user';
import './styles/auth.css';

// --- Новая утилита для отправки логов ---
const logFrontendError = (error, context) => {
    // Используем navigator.sendBeacon, если возможно, чтобы гарантировать отправку
    // даже если страница закрывается. В данном случае, можно и простой fetch.
    const tgData = window.Telegram?.WebApp?.initData || null;
    apiClient.post('/auth/log-frontend-error', {
        error: error instanceof Error ? error.message : String(error),
        context: context,
        tgInitData: tgData
    }).catch(e => {
        // Не логируем ошибку логирования, чтобы не уйти в цикл
        console.error("Failed to log frontend error:", e);
    });
};

// --- Компоненты-заглушки и страницы ---
function ServiceUserPage() {
    useEffect(() => { window.Telegram?.WebApp?.ready(); }, []);
    return (
        <div className="app-entry-container">
            <h2>Доступ для обслуживания</h2>
            <p>Ваш аккаунт настроен для получения уведомлений. Полный доступ к дашборду ограничен.</p>
            {window.Telegram?.WebApp && (
                <button className="action-btn" onClick={() => window.Telegram.WebApp.close()} style={{marginTop: '15px'}}>
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
    if (reason.includes('unauthenticated') || reason.includes('logged_out')) {
        message = "Сессия недействительна. Пожалуйста, перезапустите приложение в Telegram.";
    } else if (reason.includes('handshake') || reason.includes('auth_failed')) {
        message = "Не удалось произвести аутентификацию. Попробуйте позже или перезапустите приложение.";
    }
    useEffect(() => { window.Telegram?.WebApp?.ready(); }, []);
    return (
        <div className="app-entry-container">
            <h2>InfoCoffee Analytics</h2>
            <p>{message}</p>
        </div>
    );
}

// --- Логика Аутентификации ---
function AuthProvider({ children }) {
    const [authStatus, setAuthStatus] = useState('pending');
    const navigate = useNavigate();

    const handleSetAuth = (status) => {
        setAuthStatus(status);
        if(status === 'error') {
            clearUserDataFromLocalStorage(); // Очищаем данные при ошибке
            navigate('/app-entry?reason=auth_failed', { replace: true });
        }
    };

    const initializeAuth = useCallback(async () => {
        const tgWebApp = window.Telegram?.WebApp;

        // Если объекта Telegram Web App нет, значит мы точно не в Telegram
        if (!tgWebApp || !tgWebApp.initData) {
            // Проверяем старый токен на случай, если это было обновление страницы в браузере
            if (localStorage.getItem('app_token')) {
                const accessLevel = localStorage.getItem('userAccessLevel');
                setAuthStatus(accessLevel === 'service' ? 'service_access' : 'authenticated');
            } else {
                setAuthStatus('error');
                logFrontendError('No tgWebApp.initData and no local token', 'Not in Telegram Environment');
            }
            return;
        }

        try {
            tgWebApp.ready();
            const response = await apiClient.post('/auth/telegram-handshake', { initData: tgWebApp.initData });

            if (response.data.success) {
                const { action, token, user } = response.data;
                if ((action === 'login_success' || action === 'login_shared_access') && token) {
                    localStorage.setItem('app_token', token);
                    saveUserDataToLocalStorage(user);
                    setAuthStatus(user.accessLevel === 'service' ? 'service_access' : 'authenticated');
                } else if (action === 'registration_required' || action === 'registration_incomplete') {
                    setAuthStatus('register');
                    const params = new URLSearchParams({ status: action, tg_id: response.data.telegram_id, ...user });
                    navigate(`/register?${params.toString()}`, { replace: true });
                } else {
                    throw new Error('Unknown handshake action');
                }
            } else {
                throw new Error(response.data.error || 'Handshake failed');
            }
        } catch (err) {
            console.error("Auth initialization failed:", err);
            logFrontendError(err, 'Telegram Handshake Failed');
            setAuthStatus('error');
        }
    }, [navigate]);

    // ИСПРАВЛЕНИЕ: Добавляем надежное ожидание готовности Telegram скрипта
    useEffect(() => {
        const attemptAuth = (retries = 10, delay = 150) => {
          // Проверяем наличие `initData`, а не всего объекта, т.к. объект может быть, а данные нет
          if (window.Telegram?.WebApp?.initData) {
            initializeAuth();
          } else if (retries > 0) {
            // Если не готово, пробуем еще раз через короткий промежуток времени
            setTimeout(() => attemptAuth(retries - 1, delay), delay);
          } else {
            // Если после нескольких попыток данных все еще нет, запускаем логику для случая "не в телеграме"
            initializeAuth();
          }
        };
        
        attemptAuth();
    }, [initializeAuth]);


    if (authStatus === 'pending') {
        return <div className="app-loading-container"><span>Загрузка приложения...</span></div>;
    }
    
    return React.cloneElement(children, { authStatus, setIsAuth: handleSetAuth });
}


function AppRoutes({ authStatus, setIsAuth }) {
    // `service_access` means the user is authenticated but has a specific, limited role.
    const isUserAuthenticated = authStatus === 'authenticated';
    const isServiceUser = authStatus === 'service_access';

    return (
        <Routes>
            <Route path="/app-entry" element={<AppEntryPage />} />
            <Route path="/register" element={<RegisterPage setIsAuth={setIsAuth} />} />
            
            {/* Маршрут для выполнения задач доступен всем аутентифицированным пользователям */}
            <Route 
                path="/servicetask" 
                element={(isUserAuthenticated || isServiceUser) ? <ServiceTaskPage /> : <Navigate to="/app-entry?reason=unauthenticated" replace />} 
            />

            <Route 
                path="/dashboard/*"
                element={isUserAuthenticated ? <Dashboard setIsAuth={setIsAuth} /> : <Navigate to="/app-entry?reason=unauthorized" replace />} 
            />
            
            <Route 
                path="/" 
                element={
                    isUserAuthenticated ? <Navigate to="/dashboard" replace /> :
                    isServiceUser ? <ServiceUserPage /> : // <-- Показываем заглушку для сервис-юзеров
                    <Navigate to="/app-entry" replace />
                } 
            />
            <Route path="*" element={<Navigate to="/" replace />} /> 
        </Routes>
    );
}

function App() {
  return (
    <Router>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </Router>
  );
}

export default App;