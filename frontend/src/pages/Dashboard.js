import React, { useState } from 'react';
import Navbar from '../components/Navbar';
import FinancesPage from './FinancesPage';
import ExpensesPage from './ExpensesPage';
import ProfilePage from './ProfilePage';
import StockPage from './StockPage';

const PERIODS = [
  { label: 'СЕГОДНЯ', getRange: () => {
    const d = new Date();
    const from = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
    const to = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
    return [from, to];
  }},
  { label: 'ВЧЕРА', getRange: () => {
    const d = new Date();
    const from = new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1, 0, 0, 0, 0);
    const to = new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1, 23, 59, 59, 999);
    return [from, to];
  }},
  { label: 'С НАЧАЛА МЕСЯЦА', getRange: () => {
    const d = new Date();
    const from = new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);
    const to = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
    return [from, to];
  }},
  { label: 'ЗА 7 ДНЕЙ', getRange: () => {
    const d = new Date();
    const from = new Date(d.getFullYear(), d.getMonth(), d.getDate() - 6, 0, 0, 0, 0);
    const to = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
    return [from, to];
  }},
  { label: 'ЗА 30 ДНЕЙ', getRange: () => {
    const d = new Date();
    const from = new Date(d.getFullYear(), d.getMonth(), d.getDate() - 29, 0, 0, 0, 0);
    const to = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
    return [from, to];
  }},
  { label: 'С НАЧАЛА ГОДА', getRange: () => {
    const d = new Date();
    const from = new Date(d.getFullYear(), 0, 1, 0, 0, 0, 0);
    const to = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
    return [from, to];
  }},
  { label: 'ВАШ ПЕРИОД', getRange: () => [null, null] }
];

export default function Dashboard() {
  const [tab, setTab] = useState('finances');
  const [period, setPeriod] = useState(PERIODS[0]);
  const [periodRange, setPeriodRange] = useState(PERIODS[0].getRange());
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  // Универсальный обработчик для выбора периода (работает и для расходов, и для финансов)
  const handlePeriodChange = (p) => {
    setPeriod(p);
    const [from, to] = p.getRange();
    setPeriodRange([from, to]);
    if (p.label === 'ВАШ ПЕРИОД') {
      setFromDate('');
      setToDate('');
    }
  };

  // Для пользовательского периода
  const handleCustomFrom = (date) => {
    setFromDate(date);
    setPeriodRange([date ? new Date(date) : null, periodRange[1]]);
  };
  const handleCustomTo = (date) => {
    setToDate(date);
    setPeriodRange([periodRange[0], date ? new Date(date) : null]);
  };

  return (
    <div style={{ minHeight: '100vh', background: '#23272f' }}>
      <Navbar onLogout={() => {
        localStorage.clear();
        window.location.href = '/login';
      }} />
      <div style={{ maxWidth: 980, margin: '40px auto', background: '#23273a', borderRadius: 20, padding: 36, boxShadow: '0 8px 32px #0002' }}>
        <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
          <button onClick={() => setTab('finances')} className={tab === 'finances' ? 'tab-btn active' : 'tab-btn'}>ФИНАНСЫ</button>
          <button onClick={() => setTab('expenses')} className={tab === 'expenses' ? 'tab-btn active' : 'tab-btn'}>РАСХОДЫ</button>
          <button onClick={() => setTab('stock')} className={tab === 'stock' ? 'tab-btn active' : 'tab-btn'}>ЗАПАСЫ</button>
          <button onClick={() => setTab('profile')} className={tab === 'profile' ? 'tab-btn active' : 'tab-btn'}>ПРОФИЛЬ</button>
        </div>
        {tab === 'finances' && (
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 24 }}>
            {/* Левая часть: Финансы */}
            <div style={{ flex: 2, minWidth: 330 }}>
              {/* Если выбран "ВАШ ПЕРИОД" — даты над таблицей */}
              {period.label === 'ВАШ ПЕРИОД' && (
                <div style={{ display: 'flex', gap: 12, marginBottom: 10 }}>
                  <input type="date" value={fromDate} onChange={e => handleCustomFrom(e.target.value)} />
                  <input type="date" value={toDate} onChange={e => handleCustomTo(e.target.value)} />
                </div>
              )}
              <FinancesPage periodRange={periodRange} />
            </div>
            {/* Правая часть — кнопки периодов в столбик */}
            <div style={{ flex: 1, minWidth: 190 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                {PERIODS.map(p => (
                  <button
                    key={p.label}
                    className={period.label === p.label ? 'period-btn active' : 'period-btn'}
                    onClick={() => handlePeriodChange(p)}
                  >{p.label}</button>
                ))}
              </div>
            </div>
          </div>
        )}
        {tab === 'expenses' && (
          <ExpensesPage
            periodRange={periodRange}
            periods={PERIODS}
            period={period}
            setPeriod={handlePeriodChange}
            fromDate={fromDate}
            toDate={toDate}
            setFromDate={handleCustomFrom}
            setToDate={handleCustomTo}
          />
        )}
        {tab === 'stock' && <StockPage />}
        {tab === 'profile' && <ProfilePage />}
      </div>
    </div>
  );
}
