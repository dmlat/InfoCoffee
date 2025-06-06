// frontend/src/App.js
import React, { useEffect, useState, useCallback } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import RegisterPage from './pages/RegisterPage';
import Dashboard from './pages/Dashboard';
import apiClient from './api';
import { saveUserDataToLocalStorage } from './utils/user';
import './styles/auth.css';

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
            navigate('/app-entry?reason=auth_failed', { replace: true });
        }
    };

    const initializeAuth = useCallback(async () => {
        const tgInitData = window.Telegram?.WebApp?.initData;
        const localToken = localStorage.getItem('app_token');

        if (!tgInitData) {
            if (localToken) {
                 // Если нет initData, но есть токен, доверяем ему, но проверяем уровень доступа
                 const accessLevel = localStorage.getItem('userAccessLevel');
                 setAuthStatus(accessLevel === 'service' ? 'service_access' : 'authenticated');
            } else {
                setAuthStatus('error'); // Нет ни токена, ни данных для входа
            }
            return;
        }

        try {
            window.Telegram.WebApp.ready();
            const response = await apiClient.post('/auth/telegram-handshake', { initData: tgInitData });

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
            setAuthStatus('error');
        }
    }, [navigate, setAuthStatus]);

    useEffect(() => {
        initializeAuth();
    }, [initializeAuth]);

    // Рендерим дочерние компоненты только после завершения проверки
    if (authStatus === 'pending') {
        return <div className="app-loading-container"><span>Загрузка приложения...</span></div>;
    }
    
    return React.cloneElement(children, { authStatus, setIsAuth: handleSetAuth });
}


function AppRoutes({ authStatus, setIsAuth }) {
    if (authStatus === 'service_access') {
        return (
            <Routes>
                <Route path="*" element={<ServiceUserPage />} />
            </Routes>
        );
    }

    const isUserAuthenticated = authStatus === 'authenticated';

    return (
        <Routes>
            <Route path="/app-entry" element={<AppEntryPage />} />
            <Route path="/register" element={<RegisterPage setIsAuth={setIsAuth} />} />
            <Route 
                path="/dashboard/*"
                element={isUserAuthenticated ? <Dashboard setIsAuth={setIsAuth} /> : <Navigate to="/app-entry?reason=unauthenticated" replace />} 
            />
            <Route 
                path="/" 
                element={<Navigate to={isUserAuthenticated ? "/dashboard" : "/app-entry"} replace />} 
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