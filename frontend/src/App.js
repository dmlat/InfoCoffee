// frontend/src/App.js
import React, { useState, useEffect, createContext, useContext, useCallback } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import api from './api';
import { saveUserDataToLocalStorage, clearUserDataFromLocalStorage, getUser } from './utils/user';
import authLogger from './utils/authLogger';
import { authRetryHelper, categorizeError, ErrorTypes } from './utils/retryHelper';

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
import AnalyticsPage from './pages/AnalyticsPage';

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

  console.log(`[AuthProvider] Rendering. Auth status: ${authStatus}, User set: ${!!user}`);

  const initApp = useCallback(async () => {
    authLogger.info('🚀 initApp: Starting authentication initialization');
    
    try {
      setIsLoading(true);
      setError(''); 
      
      if (process.env.NODE_ENV === 'development') {
        authLogger.debug('Development mode: Adding artificial delay');
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
      const localUser = getUser();
      authLogger.info('📱 Checking localStorage for existing user', { 
        hasLocalUser: !!localUser, 
        hasToken: !!(localUser?.token),
        tokenLength: localUser?.token?.length || 0,
        userAccessLevel: localUser?.user?.accessLevel,
        userTelegramId: localUser?.user?.telegram_id
      });
      
              if (localUser && localUser.token) {
          authLogger.info('🔑 Found existing token, validating...');
          try {
            api.defaults.headers.common['Authorization'] = `Bearer ${localUser.token}`;
            
            // Используем retry логику для валидации токена
            const response = await authRetryHelper.retryTokenValidation(
              async () => {
                return await Promise.race([
                  api.get('/auth/validate-token'),
                  new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Token validation timeout')), 5000)
                  )
                ]);
              },
              localUser.token
            );
            
            authLogger.info('✅ Token validation successful', { 
              userId: response.data.user?.id, 
              accessLevel: response.data.user?.accessLevel,
              telegramId: response.data.user?.telegram_id 
            });
            
            setUser(response.data.user);
            setAuthStatus('authenticated');
          } catch (tokenError) {
          authLogger.warn('❌ Token validation failed, attempting refresh', { 
            error: tokenError.message,
            status: tokenError.response?.status,
            hasInitData: !!window.Telegram?.WebApp?.initData 
          });
          
          // Не очищаем localStorage здесь, чтобы сохранить initData для следующей попытки
          delete api.defaults.headers.common['Authorization'];
          
                      if (window.Telegram?.WebApp?.initData) {
              authLogger.info('🔄 Attempting token refresh with initData');
              try {
                // Используем retry логику для обновления токена
                const response = await authRetryHelper.retryTokenRefresh(
                  async () => {
                    return await api.post('/auth/refresh-app-token', { initData: window.Telegram.WebApp.initData });
                  },
                  localUser?.user?.accessLevel,
                  !!window.Telegram?.WebApp?.initData
                );
                
                const { token, user: userData } = response.data;

                // Если бэкенд требует регистрации (неожиданный случай), обрабатываем как ошибку
                if (response.data.message === 'registration_required') {
                  const errText = 'Refresh check resulted in "registration_required". This indicates a server-side logic issue for an existing user.';
                  authLogger.error('💥 CRITICAL: Unexpected registration_required during refresh', { 
                    message: response.data.message,
                    localUserAccessLevel: localUser?.user?.accessLevel 
                  });
                  
                  // Отправляем в Telegram только для критических случаев
                  await authLogger.sendAuthErrorToTelegram(
                    'Unexpected registration_required during token refresh', 
                    errText, 
                    localUser?.user
                  );
                  
                  setError(errText);
                  setAuthStatus('error');
                  return;
                }

                authLogger.info('✅ Token refresh successful', { 
                  newUserId: userData?.id, 
                  accessLevel: userData?.accessLevel 
                });
                
                api.defaults.headers.common['Authorization'] = `Bearer ${token}`;
                setUser(userData);
                saveUserDataToLocalStorage({ token, user: userData });
                setAuthStatus('authenticated');
                            } catch (err) {
                const refreshErrorMessage = err.response?.data?.error || err.message;
                const errorType = categorizeError(err, localUser?.user?.accessLevel);
                
                authLogger.error('💥 Token refresh failed after all retries', { 
                  error: refreshErrorMessage,
                  status: err.response?.status,
                  localUserAccessLevel: localUser?.user?.accessLevel,
                  errorType: errorType
                });
                
                // Отправляем в Telegram на основе типа ошибки
                if (errorType === ErrorTypes.CRITICAL || 
                    localUser?.user?.accessLevel === 'admin' || 
                    localUser?.user?.accessLevel === 'service') {
                  await authLogger.sendAuthErrorToTelegram(
                    `Token refresh failed for ${localUser?.user?.accessLevel || 'user'} [${errorType.toUpperCase()}]`, 
                    refreshErrorMessage, 
                    localUser?.user
                  );
                }
                
                // Различаем временные и постоянные ошибки в сообщении пользователю
                const userMessage = errorType === ErrorTypes.TEMPORARY 
                  ? `Временная ошибка сети. Попробуйте позже: ${refreshErrorMessage}`
                  : `Ошибка обновления сессии: ${refreshErrorMessage}`;
                
                setError(userMessage);
                setAuthStatus('error');
                
                // Очищаем localStorage только для постоянных ошибок
                if (errorType !== ErrorTypes.TEMPORARY) {
                  clearUserDataFromLocalStorage();
                }
              }
          } else {
            const errorMsg = 'Не удалось обновить сессию: отсутствуют данные Telegram.';
            authLogger.error('💥 No initData available for token refresh');
            
            // Отправляем в Telegram для admin/service пользователей
            if (localUser?.user?.accessLevel === 'admin' || localUser?.user?.accessLevel === 'service') {
              await authLogger.sendAuthErrorToTelegram(
                `Missing initData for ${localUser.user.accessLevel}`, 
                errorMsg, 
                localUser.user
              );
            }
            
            setError(errorMsg);
            setAuthStatus('error');
            clearUserDataFromLocalStorage(); // Очищаем данные, так как сессия невосстановима
          }
        }
      } else {
        authLogger.info('🆕 No existing token found, attempting initial authentication');
        
                  if (window.Telegram?.WebApp?.initData) {
            authLogger.info('📲 InitData available, calling telegram-handshake', { 
              initDataLength: window.Telegram.WebApp.initData.length 
            });
            try {
              // Используем retry логику для handshake
              const response = await authRetryHelper.retryTelegramHandshake(
                async () => {
                  return await api.post('/auth/telegram-handshake', { initData: window.Telegram.WebApp.initData });
                },
                window.Telegram.WebApp.initData.length
              );
              
              const { token, user: userData, message } = response.data;

              authLogger.info('📨 telegram-handshake response', { 
                hasToken: !!token, 
                message, 
                userAccessLevel: userData?.accessLevel,
                userTelegramId: userData?.telegram_id 
              });

              if (message === 'registration_required') {
                authLogger.info('📝 Registration required for new user');
                setAuthStatus('registration_required');
                return;
              }
              
              authLogger.info('✅ Initial authentication successful');
              api.defaults.headers.common['Authorization'] = `Bearer ${token}`;
              setUser(userData);
              saveUserDataToLocalStorage({ token, user: userData });
              setAuthStatus('authenticated');
            } catch (err) {
              const handshakeErrorMessage = err.response?.data?.error || err.message;
              const errorType = categorizeError(err);
              
              authLogger.error('💥 telegram-handshake failed after all retries', { 
                error: handshakeErrorMessage,
                status: err.response?.status,
                errorType: errorType
              });
              
              // Отправляем в Telegram критические ошибки handshake
              if (errorType === ErrorTypes.CRITICAL) {
                await authLogger.sendAuthErrorToTelegram(
                  `telegram-handshake failed [${errorType.toUpperCase()}]`, 
                  handshakeErrorMessage
                );
              }
              
              const userMessage = errorType === ErrorTypes.TEMPORARY 
                ? `Временная ошибка подключения. Попробуйте позже: ${handshakeErrorMessage}`
                : `Ошибка входа: ${handshakeErrorMessage}`;
              
              setError(userMessage);
              setAuthStatus('error');
            }
        } else {
          authLogger.info('🌐 No initData available, setting unauthenticated status');
          setAuthStatus('unauthenticated');
        }
      }
    } catch (err) {
      const criticalErrorMessage = err.response?.data?.error || err.message;
      authLogger.error('💥 CRITICAL: initApp caught unhandled error', { 
        error: criticalErrorMessage,
        stack: err.stack 
      });
      
      // Отправляем критические ошибки в Telegram
      await authLogger.sendAuthErrorToTelegram(
        'Critical initApp error', 
        criticalErrorMessage
      );
      
      setError(`Критическая ошибка: ${criticalErrorMessage}`);
      setAuthStatus('error');
      clearUserDataFromLocalStorage();
    } finally {
      setIsLoading(false);
      authLogger.info('🏁 initApp: Authentication initialization completed', { 
        // finalStatus: authStatus,
        isLoading: false 
      });
    }
  }, []);

  useEffect(() => {
    initApp();

    const handleAuthError = (event) => {
      const { reason } = event.detail;
      authLogger.error('🚨 Auth error redirect received', { reason });
      
      setUser(null);
      setAuthStatus('error');
      setError(`Сессия была завершена (${reason}). Пожалуйста, перезагрузите приложение.`);
      delete api.defaults.headers.common['Authorization'];
    };

    const handleTokenRefresh = (event) => {
        const { user: newUserData, token: newToken } = event.detail;
        if (newUserData) {
            authLogger.info('✅ Interceptor refreshed token, updating AuthContext.', { userId: newUserData.id });
            setUser(newUserData);
            saveUserDataToLocalStorage({ token: newToken, user: newUserData });
        }
    };
  
    window.addEventListener('authErrorRedirect', handleAuthError);
    window.addEventListener('tokenRefreshed', handleTokenRefresh);
    
    return () => {
      window.removeEventListener('authErrorRedirect', handleAuthError);
      window.removeEventListener('tokenRefreshed', handleTokenRefresh);
    };
  }, [initApp]);

  const reAuthenticate = useCallback(async () => {
    setAuthStatus('loading');
    await initApp();
  }, [initApp]);

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
    console.log('[updateUserInContext] Called with:', updatedUserData);
    
    // Защитная проверка критических полей
    if (!updatedUserData.accessLevel) {
      authLogger.error('🚨 Missing accessLevel in updated user data, preventing update', { 
        hasAccessLevel: !!updatedUserData.accessLevel,
        currentUser: !!user,
        updatedFields: Object.keys(updatedUserData)
      });
      setError('Ошибка обновления профиля: отсутствует уровень доступа');
      return;
    }
    
    const currentUserData = JSON.parse(localStorage.getItem('authData'));
    const newUserData = {
      token: currentUserData.token, // Сохраняем старый токен
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
  console.log(`[DashboardLayoutSelector] Rendering. User ID: ${user?.id}, Access Level: ${user?.accessLevel}`);
  if (!user) {
    console.log('[DashboardLayoutSelector] No user, navigating to /');
    return <Navigate to="/" replace />; // Защита от случайного доступа
  }

  if (user.accessLevel === 'owner' || user.accessLevel === 'admin') {
    return <MainDashboardLayout />;
  }
  if (user.accessLevel === 'service') {
    return <ServiceDashboardLayout />;
  }
  // Если роль неизвестна, отправляем на главную
  console.log(`[DashboardLayoutSelector] Unknown role, navigating to /`);
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
    const { authStatus, user, error, reAuthenticate } = useAuth();

    console.log(`[AppRouter] Rendering. Auth status: ${authStatus}`);

    if (authStatus === 'loading') {
        return <div className="loading-container">Загрузка...</div>;
    }

    // --- НОВОЕ: Отображение экрана ошибки ---
    if (authStatus === 'error') {
        return (
            <div className="loading-container" style={{ 
                flexDirection: 'column', 
                alignItems: 'center', 
                justifyContent: 'center', 
                padding: '20px', 
                textAlign: 'center',
                height: '100vh'
            }}>
                <h2 style={{ color: '#ff4d4d', marginBottom: '10px' }}>Произошла ошибка</h2>
                <p style={{ color: '#ccc', marginBottom: '20px' }}>Не удалось войти в приложение. Пожалуйста, попробуйте перезагрузить.</p>
                {error && (
                  <div style={{ 
                      color: 'grey', 
                      background: '#2a2a2a', 
                      padding: '15px', 
                      borderRadius: '8px', 
                      maxWidth: '90%', 
                      wordBreak: 'break-word',
                      textAlign: 'left',
                      marginBottom: '25px',
                      fontSize: '14px'
                  }}>
                      <strong>Детали:</strong> {error}
                  </div>
                )}
                <button 
                    onClick={() => reAuthenticate()} 
                    style={{ 
                        padding: '12px 25px', 
                        cursor: 'pointer', 
                        border: 'none', 
                        borderRadius: '5px',
                        backgroundColor: '#007bff',
                        color: 'white',
                        fontSize: '16px'
                    }}
                >
                    Перезагрузить
                </button>
            </div>
        );
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
                        <Route path="analytics" element={<ProtectedRoute allowedRoles={['owner', 'admin']}><AnalyticsPage /></ProtectedRoute>} />

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