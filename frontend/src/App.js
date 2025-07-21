// frontend/src/App.js
import React, { useState, useEffect, createContext, useContext } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import api from './api';
import { saveUserDataToLocalStorage, clearUserDataFromLocalStorage, getUser } from './utils/user';

// Pages
import DevEntryPage from './pages/DevEntryPage';
import RegisterPage from './pages/RegisterPage';
import FinancesPage from './pages/FinancesPage';
import ExpensesPage from './pages/ExpensesPage';
import StandsPage from './pages/StandsPage';
import WarehousePage from './pages/WarehousePage';
import TasksPage from './pages/TasksPage';
import ProfilePage from './pages/ProfilePage';
import RightsPage from './pages/RightsPage';

// Layouts
import MainDashboardLayout from './layouts/MainDashboardLayout';
import ServiceDashboardLayout from './layouts/ServiceDashboardLayout';

// Утилиты и стили
import './styles/tables.css';

const AuthContext = createContext(null);

function AuthProvider({ children }) {
  const [authStatus, setAuthStatus] = useState('loading');
  const [user, setUser] = useState(null);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  const initApp = async () => {
    try {
      setIsLoading(true);
      
      if (process.env.NODE_ENV === 'development') {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
      const localUser = getUser();
      
      if (localUser && localUser.token) {
        try {
          api.defaults.headers.common['Authorization'] = `Bearer ${localUser.token}`;
          const response = await Promise.race([
            api.get('/auth/validate-token'),
            new Promise((_, reject) => 
              setTimeout(() => reject(new Error('Token validation timeout')), 5000)
            )
          ]);
          setUser(response.data.user);
          setAuthStatus('authenticated');
        } catch (tokenError) {
          clearUserDataFromLocalStorage();
          delete api.defaults.headers.common['Authorization'];
          
          if (window.Telegram?.WebApp?.initData) {
            try {
              const response = await api.post('/auth/telegram-handshake', { initData: window.Telegram.WebApp.initData });
              const { token, user: userData, message } = response.data;

              if (message === 'registration_required') {
                setAuthStatus('registration_required');
                return;
              }
              api.defaults.headers.common['Authorization'] = `Bearer ${token}`;
              setUser(userData);
              saveUserDataToLocalStorage({ token, user: userData });
              setAuthStatus('authenticated');
            } catch (err) {
              setError('Authentication failed. Please try again.');
              setAuthStatus('error');
            }
          } else {
            setAuthStatus('unauthenticated');
          }
        }
      } else {
        if (window.Telegram?.WebApp?.initData) {
          try {
            const response = await api.post('/auth/telegram-handshake', { initData: window.Telegram.WebApp.initData });
            const { token, user: userData, message } = response.data;

            if (message === 'registration_required') {
              setAuthStatus('registration_required');
              return;
            }
            api.defaults.headers.common['Authorization'] = `Bearer ${token}`;
            setUser(userData);
            saveUserDataToLocalStorage({ token, user: userData });
            setAuthStatus('authenticated');
          } catch (err) {
            setError('Authentication failed. Please try again.');
            setAuthStatus('error');
          }
        } else {
          setAuthStatus('unauthenticated');
        }
      }
    } catch (err) {
      clearUserDataFromLocalStorage();
      setAuthStatus('unauthenticated');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    initApp();
  }, []);

  const reAuthenticate = async () => {
    setAuthStatus('loading');
    await initApp();
  };

  const login = async (initData) => {
    try {
      const response = await api.post('/auth/telegram-handshake', { initData });
      const { token, user: userData, message } = response.data;

      if (message === 'registration_required') {
        setAuthStatus('registration_required');
        return;
      }
      api.defaults.headers.common['Authorization'] = `Bearer ${token}`;
      setUser(userData);
      saveUserDataToLocalStorage({ token, user: userData });
      setAuthStatus('authenticated');
    } catch (err) {
      setError('Authentication failed. Please try again.');
      setAuthStatus('error');
    }
  };

  const logout = () => {
    clearUserDataFromLocalStorage();
    setUser(null);
    setAuthStatus('unauthenticated');
    delete api.defaults.headers.common['Authorization'];
  };

  const completeRegistration = async (registrationData) => {
    try {
      const response = await api.post('/auth/register', registrationData);
      const { token, user: userData } = response.data;
      api.defaults.headers.common['Authorization'] = `Bearer ${token}`;
      setUser(userData);
      saveUserDataToLocalStorage({ token, user: userData });
      setAuthStatus('authenticated');
    } catch (err) {
      setError('Registration failed. Please try again.');
    }
  };

  const updateUserInContext = (updatedUserData) => {
    const currentUserData = JSON.parse(localStorage.getItem('authData'));
    const newUserData = {
      ...currentUserData,
      user: updatedUserData
    };
    saveUserDataToLocalStorage(newUserData);
    setUser(updatedUserData);
  };

  return (
    <AuthContext.Provider value={{ user, login, logout, completeRegistration, authStatus, error, updateUserInContext, reAuthenticate, isLoading, token: getUser()?.token }}>
      {children}
    </AuthContext.Provider>
  );
}

// Новый компонент для выбора правильного макета
const DashboardLayoutSelector = () => {
  const { user } = useAuth();
  if (!user) return <Navigate to="/" replace />; // Защита от случайного доступа

  if (user.accessLevel === 'owner' || user.accessLevel === 'admin') {
    return <MainDashboardLayout />;
  }
  if (user.accessLevel === 'service') {
    return <ServiceDashboardLayout />;
  }
  // Если роль неизвестна, отправляем на главную
  return <Navigate to="/" replace />;
};

// Отдельный компонент для защиты роутов
const ProtectedRoute = ({ children, allowedRoles }) => {
    const { user } = useAuth();
    if (!user || !allowedRoles.includes(user.accessLevel)) {
        // Если роль не разрешена, перенаправляем на страницу задач по умолчанию
        return <Navigate to="/dashboard/tasks" replace />;
    }
    return children;
};


function AppRouter() {
    const { authStatus, user } = useAuth();

    if (authStatus === 'loading') {
        return <div className="loading-container">Загрузка...</div>;
    }

    return (
        <Router>
            <div className="app-container">
                <Routes>
                    <Route path="/" element={authStatus === 'authenticated' ? <Navigate to="/dashboard" replace /> : (process.env.NODE_ENV === 'development' ? <DevEntryPage /> : <div>Для доступа к приложению, откройте его в Telegram.</div>)} />
                    
                    <Route 
                      path="/dashboard" 
                      element={authStatus === 'authenticated' ? <DashboardLayoutSelector /> : <Navigate to="/" replace />}
                    >
                        {/* Маршруты только для Владельца и Админа */}
                        <Route path="finances" element={<ProtectedRoute allowedRoles={['owner', 'admin']}><FinancesPage /></ProtectedRoute>} />
                        <Route path="stands" element={<ProtectedRoute allowedRoles={['owner', 'admin']}><StandsPage /></ProtectedRoute>} />
                        <Route path="stands/:terminalId" element={<ProtectedRoute allowedRoles={['owner', 'admin']}><StandsPage /></ProtectedRoute>} />
                        <Route path="expenses" element={<ProtectedRoute allowedRoles={['owner', 'admin']}><ExpensesPage /></ProtectedRoute>} />
                        <Route path="rights" element={<ProtectedRoute allowedRoles={['owner', 'admin']}><RightsPage /></ProtectedRoute>} />
                        <Route path="profile" element={<ProtectedRoute allowedRoles={['owner', 'admin']}><ProfilePage /></ProtectedRoute>} />

                        {/* Общие маршруты для всех авторизованных ролей */}
                        <Route path="warehouse" element={<WarehousePage />} />
                        <Route path="tasks" element={<TasksPage />} />
                        
                        {/* Редирект по умолчанию внутри /dashboard */}
                        <Route index element={user?.accessLevel === 'service' ? <Navigate to="tasks" replace /> : <Navigate to="finances" replace />} />
                    </Route>
                    
                    {/* Общие маршруты */}
                    <Route path="/register" element={<RegisterPage />} />
                    {process.env.NODE_ENV === 'development' && (
                        <Route path="/dev-entry" element={<DevEntryPage />} />
                    )}
                     <Route path="*" element={<Navigate to="/" />} />
                </Routes>
            </div>
        </Router>
    );
}

function App() {
    return (
        <AuthProvider>
            <AppRouter />
        </AuthProvider>
    );
}

export const useAuth = () => {
  return useContext(AuthContext);
};

export default App;