// src/pages/Dashboard.js
import React, { useState, useEffect, useCallback } from 'react';
import FinancesPage from './FinancesPage';
import ExpensesPage from './ExpensesPage';
import ProfilePage from './ProfilePage';
import StockPage from './StockPage'; 

const TABS = [
  { id: 'finances', label: 'ФИНАНСЫ', component: FinancesPage },
  { id: 'expenses', label: 'РАСХОДЫ', component: ExpensesPage },
  { id: 'stock', label: 'ЗАПАСЫ', component: StockPage },
  { id: 'profile', label: 'ПРОФИЛЬ', component: ProfilePage },
];

export default function Dashboard({ setIsAuth }) {
  const getInitialTab = useCallback(() => {
    const hash = window.location.hash.replace('#', '');
    const foundTab = TABS.find(t => t.id === hash);
    return foundTab ? hash : TABS[0].id;
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

  const ActivePageComponent = TABS.find(t => t.id === activeTabId)?.component;

  return (
    <div className="dashboard-layout">
      <div className="dashboard-content-wrapper">
        <div className="tabs-container">
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => handleTabChange(tab.id)}
              className={activeTabId === tab.id ? 'tab-btn active' : 'tab-btn'}
            >
              {tab.label}
            </button>
          ))}
        </div>
        
        {ActivePageComponent && <ActivePageComponent />} 
      </div>
    </div>
  );
}