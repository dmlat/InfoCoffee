import React from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import './DashboardLayout.css';
import { useAuth } from '../App';

const TABS = [
  { id: 'finances', label: 'ФИНАНСЫ', path: '/dashboard/finances', roles: ['owner', 'admin'] },
  { id: 'expenses', label: 'РАСХОДЫ', path: '/dashboard/expenses', roles: ['owner', 'admin'] },
  { id: 'stands', label: 'СТОЙКИ', path: '/dashboard/stands', roles: ['owner', 'admin'] },
  { id: 'warehouse', label: 'СКЛАД', path: '/dashboard/warehouse', roles: ['owner', 'admin'] },
  { id: 'tasks', label: 'ЗАДАЧИ', path: '/dashboard/tasks', roles: ['owner', 'admin', 'service'] },
  { id: 'analytics', label: 'АНАЛИТИКА', path: '/dashboard/analytics', roles: ['owner', 'admin'] },
  { id: 'profile', label: 'ПРОФИЛЬ', path: '/dashboard/profile', roles: ['owner', 'admin'] },
  { id: 'rights', label: 'ДОСТУПЫ', path: '/dashboard/rights', roles: ['owner', 'admin'] },
];

const TABS_ROW_1 = TABS.filter(t => ['finances', 'expenses', 'stands', 'warehouse'].includes(t.id));
const TABS_ROW_2 = TABS.filter(t => ['tasks', 'analytics', 'profile', 'rights'].includes(t.id));

const MainDashboardLayout = () => {
  const { user, logout, isLoading } = useAuth();

  if (isLoading) {
    return <div className="loading-container">Загрузка...</div>;
  }
  
  if (!user) {
    // Можно добавить редирект на страницу входа, если пользователя нет
    // но в теории до этого не должно дойти из-за защиты роутов
    return null; 
  }

  return (
    <div className="dashboard-layout">
      <div className="dashboard-content-wrapper">
        <div className="tabs-navigation-container">
          <div className="tabs-row">
            {TABS_ROW_1.map(tab => (
              <NavLink
                key={tab.id}
                to={tab.path}
                className={({ isActive }) => `tab-btn ${isActive ? 'active' : ''}`}
              >
                {tab.label}
              </NavLink>
            ))}
          </div>
          <div className="tabs-row">
            {TABS_ROW_2.map(tab => {
              if (tab.roles && !tab.roles.includes(user.accessLevel)) {
                return null;
              }
              return (
                <NavLink
                  key={tab.id}
                  to={tab.path}
                  className={({ isActive }) => `tab-btn ${isActive ? 'active' : ''}`}
                >
                  {tab.label}
                </NavLink>
              );
            })}
          </div>
        </div>

        <div className="active-page-container">
          <Outlet />
        </div>
        
        {/* Кнопка выхода только для режима разработки */}
        {process.env.NODE_ENV === 'development' && (
          <button onClick={logout} className="dev-logout-button">
            Выйти (Дев)
          </button>
        )}
      </div>
    </div>
  );
};

export default MainDashboardLayout; 