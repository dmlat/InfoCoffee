// frontend/src/pages/Dashboard.js
import React, { useState, useEffect, useCallback } from 'react';
import FinancesPage from './FinancesPage';
import ExpensesPage from './ExpensesPage';
import RemainsPage from './RemainsPage';
import StandsPage from './StandsPage';
import AnalyticsPage from './AnalyticsPage';
import ProfilePage from './ProfilePage';
import RightsPage from './RightsPage'; // <-- НОВЫЙ ИМПОРТ
import '../layouts/DashboardLayout.css'; // Новый импорт стилей макета

const TABS_ROW_1 = [
  { id: 'finances', label: 'ФИНАНСЫ', component: FinancesPage },
  { id: 'expenses', label: 'РАСХОДЫ', component: ExpensesPage },
  { id: 'remains', label: 'ОСТАТКИ', component: RemainsPage },
];

const TABS_ROW_2 = [
  { id: 'stands', label: 'СТОЙКИ', component: StandsPage },
  { id: 'analytics', label: 'АНАЛИТИКА', component: AnalyticsPage },
  { id: 'profile', label: 'ПРОФИЛЬ', component: ProfilePage },
  { id: 'rights', label: 'ДОСТУПЫ', component: RightsPage }, // <-- НОВАЯ ВКЛАДКА
];

const ALL_TABS = [...TABS_ROW_1, ...TABS_ROW_2];

export default function Dashboard({ setIsAuth }) {
    const getInitialTab = useCallback(() => {
        const hash = window.location.hash.replace('#', '');
        const foundTab = ALL_TABS.find(t => t.id === hash);
        // Проверяем, есть ли у пользователя права на доступ к этой вкладке
        const accessLevel = localStorage.getItem('userAccessLevel');
        if (hash === 'rights' && accessLevel !== 'owner' && accessLevel !== 'admin') {
            return ALL_TABS[0].id; // редирект на главную, если нет прав
        }
        return foundTab ? hash : ALL_TABS[0].id;
      }, []);
    
      const [activeTabId, setActiveTabId] = useState(getInitialTab);
    
      const handleTabChange = (tabId) => {
        setActiveTabId(tabId);
        window.location.hash = tabId;
      };
    
      useEffect(() => {
        const handleHashChange = () => {
          setActiveTabId(getInitialTab());
        };
        window.addEventListener('hashchange', handleHashChange);
        return () => {
          window.removeEventListener('hashchange', handleHashChange);
        };
      }, [getInitialTab]);
    
      const ActivePageComponent = ALL_TABS.find(t => t.id === activeTabId)?.component;
      const userAccessLevel = localStorage.getItem('userAccessLevel');

    return (
        <div className="dashboard-layout">
            <div className="dashboard-content-wrapper">
                <div className="tabs-navigation-container">
                    <div className="tabs-row">
                        {TABS_ROW_1.map(tab => (
                            <button
                                key={tab.id}
                                onClick={() => handleTabChange(tab.id)}
                                className={activeTabId === tab.id ? 'tab-btn active' : 'tab-btn'}
                            >
                                {tab.label}
                            </button>
                        ))}
                    </div>
                    <div className="tabs-row">
                        {TABS_ROW_2.map(tab => {
                            // Скрываем вкладку "Доступы" если пользователь не владелец и не админ
                            if (tab.id === 'rights' && userAccessLevel !== 'owner' && userAccessLevel !== 'admin') {
                                return null;
                            }
                            return (
                                <button
                                    key={tab.id}
                                    onClick={() => handleTabChange(tab.id)}
                                    className={activeTabId === tab.id ? 'tab-btn active' : 'tab-btn'}
                                >
                                    {tab.label}
                                </button>
                            );
                        })}
                    </div>
                </div>

                {ActivePageComponent && <ActivePageComponent />}
            </div>
        </div>
    );
}