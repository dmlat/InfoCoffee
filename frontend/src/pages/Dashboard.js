// frontend/src/pages/Dashboard.js
import React, { useState, useEffect, useCallback } from 'react';
import FinancesPage from './FinancesPage';
import ExpensesPage from './ExpensesPage';
import RemainsPage from './RemainsPage'; // Изменено с StockPage
import StandsPage from './StandsPage';   // Новая страница
import AnalyticsPage from './AnalyticsPage'; // Новая страница
import ProfilePage from './ProfilePage';

const TABS_ROW_1 = [
  { id: 'finances', label: 'ФИНАНСЫ', component: FinancesPage },
  { id: 'expenses', label: 'РАСХОДЫ', component: ExpensesPage },
  { id: 'remains', label: 'ОСТАТКИ', component: RemainsPage }, // ID изменен для соответствия
];

const TABS_ROW_2 = [
  { id: 'stands', label: 'СТОЙКИ', component: StandsPage },
  { id: 'analytics', label: 'АНАЛИТИКА', component: AnalyticsPage },
  { id: 'profile', label: 'ПРОФИЛЬ', component: ProfilePage },
];

const ALL_TABS = [...TABS_ROW_1, ...TABS_ROW_2];

export default function Dashboard({ setIsAuth }) {
  const getInitialTab = useCallback(() => {
    const hash = window.location.hash.replace('#', '');
    const foundTab = ALL_TABS.find(t => t.id === hash);
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

  return (
    <div className="dashboard-layout">
      <div className="dashboard-content-wrapper">
        <div className="tabs-navigation-container"> {/* Новый контейнер для двух рядов */}
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
            {TABS_ROW_2.map(tab => (
              <button
                key={tab.id}
                onClick={() => handleTabChange(tab.id)}
                className={activeTabId === tab.id ? 'tab-btn active' : 'tab-btn'}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
        
        {ActivePageComponent && <ActivePageComponent />} 
      </div>
    </div>
  );
}