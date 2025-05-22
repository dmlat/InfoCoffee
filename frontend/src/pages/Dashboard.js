// src/pages/Dashboard.js
import React, { useState, useEffect } from 'react';
import Navbar from '../components/Navbar'; // Предполагается, что Navbar существует
import FinancesPage from './FinancesPage';
import ExpensesPage from './ExpensesPage';
import ProfilePage from './ProfilePage';
import StockPage from './StockPage';
import { PERIODS, formatDateForInput } from '../constants'; // Импортируем из constants.js

const TABS = [
  { id: 'finances', label: 'ФИНАНСЫ', component: FinancesPage },
  { id: 'expenses', label: 'РАСХОДЫ', component: ExpensesPage },
  { id: 'stock', label: 'ЗАПАСЫ', component: StockPage },
  { id: 'profile', label: 'ПРОФИЛЬ', component: ProfilePage },
];

export default function Dashboard() {
  // Начальная вкладка из URL hash или TABS[0].id по умолчанию
  const getInitialTab = () => {
    const hash = window.location.hash.replace('#', '');
    const foundTab = TABS.find(t => t.id === hash); //
    return foundTab ? hash : TABS[0].id; //
  };

  const [activeTabId, setActiveTabId] = useState(getInitialTab); //

  // Состояния для управления периодом
  const [currentSelectedPeriod, setCurrentSelectedPeriod] = useState(PERIODS[0]);
  const [periodRange, setPeriodRange] = useState(PERIODS[0].getRange());
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  // Обновляем URL hash при смене вкладки
  const handleTabChange = (tabId) => {
    setActiveTabId(tabId); //
    window.location.hash = tabId; //
  };

  // Слушаем изменения hash в URL
  useEffect(() => {
    const handleHashChange = () => {
      setActiveTabId(getInitialTab()); //
    };
    window.addEventListener('hashchange', handleHashChange); //
    return () => {
      window.removeEventListener('hashchange', handleHashChange); //
    };
  }, []); //

  // Обработчик для выбора периода
  const handlePeriodChange = (p) => {
    setCurrentSelectedPeriod(p);
    const [from, to] = p.getRange();
    setPeriodRange([from, to]);
    if (p.label === 'ВАШ ПЕРИОД') {
      // Если выбран "ВАШ ПЕРИОД", можно инициализировать fromDate и toDate
      // Например, если есть сохраненные значения или нужно взять из текущего periodRange
      // В данном случае, очищаем, чтобы пользователь ввел новые даты.
      setFromDate(from ? formatDateForInput(from) : '');
      setToDate(to ? formatDateForInput(to) : '');
    } else {
        // Для предопределенных периодов очищаем кастомные даты,
        // т.к. они больше не релевантны.
        setFromDate('');
        setToDate('');
    }
  };

  // Для пользовательского периода "с"
  const handleCustomFrom = (dateValue) => { // dateValue это строка 'YYYY-MM-DD'
    setFromDate(dateValue);
    const newFrom = dateValue ? new Date(dateValue) : null;
    if (newFrom) {
        // Корректируем время на начало дня в локальной таймзоне
        newFrom.setHours(0, 0, 0, 0);
    }
    setPeriodRange(prevRange => [newFrom, prevRange[1]]);
  };

  // Для пользовательского периода "по"
  const handleCustomTo = (dateValue) => { // dateValue это строка 'YYYY-MM-DD'
    setToDate(dateValue);
    const newTo = dateValue ? new Date(dateValue) : null;
    if (newTo) {
        // Корректируем время на конец дня в локальной таймзоне
        newTo.setHours(23, 59, 59, 999);
    }
    setPeriodRange(prevRange => [prevRange[0], newTo]);
  };

  // Обновляем periodRange и input-даты при изменении currentSelectedPeriod (например, при инициализации)
  useEffect(() => {
    const [from, to] = currentSelectedPeriod.getRange();
    setPeriodRange([from, to]);
    if (currentSelectedPeriod.label === 'ВАШ ПЕРИОД') {
      // Если это "ВАШ ПЕРИОД", устанавливаем значения из fromDate/toDate,
      // которые могли быть установлены ранее или пусты, если это первый выбор
      // formatDateForInput здесь может быть полезен, если from/to не null
      setFromDate(from ? formatDateForInput(from) : '');
      setToDate(to ? formatDateForInput(to) : '');
    } else {
      // Для остальных периодов очищаем поля кастомных дат
      setFromDate('');
      setToDate('');
    }
  }, [currentSelectedPeriod]);

  const ActivePageComponent = TABS.find(t => t.id === activeTabId)?.component; //

  return (
    <div style={{ minHeight: '100vh', background: '#23272f', color: '#c6c6c6' }}> {/* */}
      <Navbar onLogout={() => {
        localStorage.clear(); //
        window.location.href = '/login'; //
       }} />
      <div
        className="dashboard-content-wrapper" //
        style={{
          maxWidth: 1180, //
          margin: '30px auto', //
          background: '#20232a', //
          borderRadius: 20, //
          padding: '24px 36px', //
          boxShadow: '0 8px 32px #00000033' //
        }}
      >
        <div
          className="tabs-container" //
          style={{
            display: 'flex', //
            gap: 8, //
            marginBottom: 24, //
            borderBottom: '1px solid #303548', //
            paddingBottom: 16 //
          }}
        >
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => handleTabChange(tab.id)} //
              className={activeTabId === tab.id ? 'tab-btn active' : 'tab-btn'} //
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Область контента для активной вкладки */}
        <div>
          {activeTabId === 'finances' && (
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 24 }}>
              <div style={{ flex: 3 }}> {/* Основной контент финансов */}
                {currentSelectedPeriod.label === 'ВАШ ПЕРИОД' && (
                  <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
                    <input
                      type="date"
                      value={fromDate}
                      onChange={e => handleCustomFrom(e.target.value)}
                      style={{ padding: '8px 12px', borderRadius: 6, border: '1px solid #444', background: '#2a2f3a', color: '#c6c6c6' }}
                    />
                    <input
                      type="date"
                      value={toDate}
                      onChange={e => handleCustomTo(e.target.value)}
                      style={{ padding: '8px 12px', borderRadius: 6, border: '1px solid #444', background: '#2a2f3a', color: '#c6c6c6' }}
                    />
                  </div>
                )}
                {ActivePageComponent && <FinancesPage periodRange={periodRange} />}
              </div>
              <div style={{ flex: 1, minWidth: 190, maxWidth: 220 }}> {/* Панель выбора периода */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                  {PERIODS.map(p => (
                    <button
                      key={p.label}
                      className={currentSelectedPeriod.label === p.label ? 'period-btn active' : 'period-btn'}
                      onClick={() => handlePeriodChange(p)}
                    >{p.label}</button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {activeTabId === 'expenses' && ActivePageComponent && (
            // Для Расходов передаем все необходимые props для управления периодом
            // ExpensesPage должен будет сам решить, как отображать и использовать эти данные/контролы
            <ExpensesPage
              periodRange={periodRange}
              periods={PERIODS}
              currentPeriod={currentSelectedPeriod}
              setPeriod={handlePeriodChange} // Позволяет ExpensesPage изменять период через Dashboard
              fromDate={fromDate}
              toDate={toDate}
              setFromDate={handleCustomFrom} // Позволяет ExpensesPage устанавливать кастомные даты
              setToDate={handleCustomTo}
            />
          )}
          
          {/* Для остальных вкладок (Stock, Profile) */}
          {ActivePageComponent && activeTabId !== 'finances' && activeTabId !== 'expenses' && (
            <ActivePageComponent />
          )}
        </div>
      </div>
    </div>
  );
}