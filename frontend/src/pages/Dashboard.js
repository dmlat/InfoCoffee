// src/pages/Dashboard.js
import React, { useState, useEffect } from 'react';
import Navbar from '../components/Navbar'; // Предполагается, что Navbar существует
import FinancesPage from './FinancesPage';
import ExpensesPage from './ExpensesPage';
import ProfilePage from './ProfilePage';
import StockPage from './StockPage';
// import { PERIODS } from '../constants'; // Если вынесли PERIODS в constants.js

const TABS = [
  { id: 'finances', label: 'ФИНАНСЫ', component: FinancesPage },
  { id: 'expenses', label: 'РАСХОДЫ', component: ExpensesPage },
  { id: 'stock', label: 'ЗАПАСЫ', component: StockPage },
  { id: 'profile', label: 'ПРОФИЛЬ', component: ProfilePage },
];

export default function Dashboard() {
  // Начальная вкладка из URL hash или 'finances' по умолчанию
  const getInitialTab = () => {
    const hash = window.location.hash.replace('#', '');
    // Проверяем, существует ли вкладка с таким id
    const foundTab = TABS.find(t => t.id === hash);
    return foundTab ? hash : TABS[0].id;
  };

  const [activeTabId, setActiveTabId] = useState(getInitialTab);

  // Обновляем URL hash при смене вкладки
  const handleTabChange = (tabId) => {
    setActiveTabId(tabId);
    window.location.hash = tabId;
  };

  // Слушаем изменения hash в URL (например, при использовании кнопок "назад/вперед" в браузере)
  useEffect(() => {
    const handleHashChange = () => {
      setActiveTabId(getInitialTab());
    };
    window.addEventListener('hashchange', handleHashChange);
    return () => {
      window.removeEventListener('hashchange', handleHashChange);
    };
  }, []); // Пустой массив зависимостей, getInitialTab не меняется

  const ActivePageComponent = TABS.find(t => t.id === activeTabId)?.component;

  return (
    <div style={{ minHeight: '100vh', background: '#23272f', color: '#c6c6c6' }}>
      <Navbar onLogout={() => { 
        localStorage.clear(); // Очищаем localStorage при выходе
        window.location.href = '/login'; // Предполагается, что у тебя есть роутинг на /login
       }} />
      {/* Добавлен класс dashboard-content-wrapper для адаптивных стилей */}
      <div 
        className="dashboard-content-wrapper" 
        style={{ 
          maxWidth: 1180, 
          margin: '30px auto', 
          background: '#20232a', 
          borderRadius: 20, 
          padding: '24px 36px', 
          boxShadow: '0 8px 32px #00000033' 
        }}
      >
        {/* Добавлен класс tabs-container для адаптивных стилей */}
        <div 
          className="tabs-container"
          style={{ 
            display: 'flex', 
            gap: 8, 
            marginBottom: 24, 
            borderBottom: '1px solid #303548', 
            paddingBottom: 16 
          }}
        >
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => handleTabChange(tab.id)}
              // Классы для стилизации из index.css
              className={activeTabId === tab.id ? 'tab-btn active' : 'tab-btn'} 
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Рендерим активный компонент страницы */}
        {ActivePageComponent && <ActivePageComponent />}

      </div>
    </div>
  );
}