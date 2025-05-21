import React, { useState } from 'react';
import Navbar from '../components/Navbar';
import FinancesPage from './FinancesPage';
import ExpensesPage from './ExpensesPage';
import ProfilePage from './ProfilePage';
import StockPage from './StockPage';

// Быстрые периоды
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

  // Обработчик выбора периода
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

  // Корректный logout (очищает всё)
  const handleLogout = () => {
    localStorage.clear();
    window.location.href = '/login';
  };

  return (
    <div style={{ minHeight: '100vh', background: '#23272f' }}>
      <Navbar onLogout={handleLogout} />
      <div style={{ maxWidth: 980, margin: '40px auto', background: '#23273a', borderRadius: 20, padding: 36, boxShadow: '0 8px 32px #0002' }}>
        <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
          <button onClick={() => setTab('finances')} className={tab === 'finances' ? 'tab-btn active' : 'tab-btn'}>ФИНАНСЫ</button>
          <button onClick={() => setTab('expenses')} className={tab === 'expenses' ? 'tab-btn active' : 'tab-btn'}>РАСХОДЫ</button>
          <button onClick={() => setTab('stock')} className={tab === 'stock' ? 'tab-btn active' : 'tab-btn'}>ЗАПАСЫ</button>
          <button onClick={() => setTab('profile')} className={tab === 'profile' ? 'tab-btn active' : 'tab-btn'}>ПРОФИЛЬ</button>
        </div>

        {/* Быстрый выбор периода */}
        <div style={{ marginBottom: 18, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {PERIODS.map(p => (
            <button
              key={p.label}
              className={period.label === p.label ? 'period-btn active' : 'period-btn'}
              onClick={() => handlePeriodChange(p)}
            >{p.label}</button>
          ))}
          {period.label === 'ВАШ ПЕРИОД' && (
            <>
              <input
                type="date"
                value={fromDate}
                onChange={e => handleCustomFrom(e.target.value)}
                style={{ marginLeft: 10, marginRight: 10 }}
              />
              <input
                type="date"
                value={toDate}
                onChange={e => handleCustomTo(e.target.value)}
              />
            </>
          )}
        </div>

        {tab === 'finances' && <FinancesPage periodRange={periodRange} />}
        {tab === 'expenses' && <ExpensesPage periodRange={periodRange} />}
        {tab === 'stock' && <StockPage />}
        {tab === 'profile' && <ProfilePage />}
      </div>
    </div>
  );
}
