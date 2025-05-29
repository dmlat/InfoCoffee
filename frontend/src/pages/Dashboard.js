// src/pages/Dashboard.js
import React, { useState, useEffect } from 'react';
import Navbar from '../components/Navbar';
import FinancesPage from './FinancesPage';
import ExpensesPage from './ExpensesPage';
import ProfilePage from './ProfilePage';
import StockPage from './StockPage'; // Предполагаем, что этот компонент существует

const TABS = [
  { id: 'finances', label: 'ФИНАНСЫ', component: FinancesPage },
  { id: 'expenses', label: 'РАСХОДЫ', component: ExpensesPage },
  { id: 'stock', label: 'ЗАПАСЫ', component: StockPage },
  { id: 'profile', label: 'ПРОФИЛЬ', component: ProfilePage },
];

export default function Dashboard({ setIsAuth }) { // Добавил setIsAuth, если Navbar его использует для выхода
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
    const handleHashChange = () => {
      setActiveTabId(getInitialTab());
    };
    window.addEventListener('hashchange', handleHashChange);
    return () => {
      window.removeEventListener('hashchange', handleHashChange);
    };
  }, []); // getInitialTab не меняется, поэтому зависимости пустые

  const ActivePageComponent = TABS.find(t => t.id === activeTabId)?.component;

  const handleLogout = () => {
    localStorage.clear();
    // Вместо прямого window.location.href, лучше использовать setIsAuth,
    // чтобы App.js обработал перенаправление на страницу входа/AppEntryPage
    if (setIsAuth) {
        setIsAuth(false); 
    } else {
        // Fallback, если setIsAuth не передан (хотя должен быть из App.js)
        window.location.href = '/app-entry?reason=logout'; 
    }
  };

  return (
    // Этот div теперь .dashboard-layout из index.css
    <div className="dashboard-layout">
      <Navbar onLogout={handleLogout} />
      {/* Этот div теперь .dashboard-content-wrapper из index.css */}
      <div className="dashboard-content-wrapper">
        {/* Этот div теперь .tabs-container из index.css */}
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

        {/* Рендерим активный компонент страницы */}
        {/* Страницы (FinancesPage и др.) будут использовать класс .page-container */}
        {ActivePageComponent && <ActivePageComponent />}
      </div>
    </div>
  );
}