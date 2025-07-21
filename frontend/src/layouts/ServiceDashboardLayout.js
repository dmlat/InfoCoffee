import React from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../App';
import './DashboardLayout.css'; // Используем те же стили

// Табы для service пользователей
const SERVICE_TABS = [
  { id: 'tasks', label: 'ЗАДАЧИ', path: '/dashboard/tasks' },
  { id: 'warehouse', label: 'СКЛАД', path: '/dashboard/warehouse' },
];

export default function ServiceDashboardLayout() {
    const { logout } = useAuth();

    // Временные логи для отладки
    // console.log('[ServiceDashboardLayout] Render started');
    // console.log('[ServiceDashboardLayout] isLoading:', isLoading);
    // console.log('[ServiceDashboardLayout] user:', user);
    // console.log('[ServiceDashboardLayout] user.accessLevel:', user?.accessLevel);
    // console.log('[ServiceDashboardLayout] NODE_ENV:', process.env.NODE_ENV);

    // Проверка загрузки как в MainDashboardLayout
    // if (isLoading) {
    //     console.log('[ServiceDashboardLayout] Showing loading state');
    //     return <div className="loading-container">Загрузка...</div>;
    // }
    
    // if (!user) {
    //     console.log('[ServiceDashboardLayout] No user found, this should not happen due to route protection');
    //     return null; 
    // }

    // Проверка что пользователь действительно service (дополнительная защита)
    // if (user.accessLevel !== 'service') {
    //     console.log('[ServiceDashboardLayout] User is not service, accessLevel:', user.accessLevel);
    //     return null;
    // }

    // console.log('[ServiceDashboardLayout] Rendering service dashboard with tabs');

    return (
        <div className="dashboard-layout">
            <div className="dashboard-content-wrapper">
                <div className="tabs-navigation-container">
                    <div className="tabs-row">
                        {SERVICE_TABS.map(tab => (
                            <NavLink
                                key={tab.id}
                                to={tab.path}
                                className={({ isActive }) => `tab-btn ${isActive ? 'active' : ''}`}
                            >
                                {tab.label}
                            </NavLink>
                        ))}
                    </div>
                </div>

                <div className="active-page-container">
                    <Outlet />
                </div>
                
                {/* Кнопка выхода только для режима разработки */}
                {process.env.NODE_ENV === 'development' && (
                    <button onClick={() => {
                        // console.log('[ServiceDashboardLayout] Dev logout clicked');
                        logout();
                    }} className="dev-logout-button">
                        Выйти (Дев)
                    </button>
                )}
            </div>
        </div>
    );
} 