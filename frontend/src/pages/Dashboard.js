// src/pages/Dashboard.js
import React, { useState, useEffect } from 'react';
import Navbar from '../components/Navbar';
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

export default function Dashboard() {
  const getInitialTab = () => {
    const hash = window.location.hash.replace('#', '');
    const foundTab = TABS.find(t => t.id === hash);
    return foundTab ? hash : TABS[0].id;
  };

  const [activeTabId, setActiveTabId] = useState(getInitialTab);

  const handleTabChange = (tabId) => {
    setActiveTabId(tabId);
    window.location.hash = tabId;
  };

  useEffect(() => {
    const handleHashChange = () => setActiveTabId(getInitialTab());
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []); 

  const ActivePageComponent = TABS.find(t => t.id === activeTabId)?.component;

  return (
    <div style={{ minHeight: '100vh', background: '#23272f', color: '#c6c6c6' }}>
      <Navbar onLogout={() => { 
        localStorage.clear(); 
        window.location.href = '/login'; 
       }} />
      <div className="dashboard-content-wrapper"> {/* Используем класс из index.css */}
        <div className="tabs-container"> {/* Используем класс из index.css */}
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