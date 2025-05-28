// src/pages/FinancesPage.js
import React, { useState, useEffect, useCallback } from 'react';
import { useStatsPolling } from './useStatsPolling';
import { PERIODS, formatDateForInput } from '../constants';

export default function FinancesPage() {
  const pageKey = 'financesPage_v5_profile_integration';

  const getTodayRange = useCallback(() => {
    return (PERIODS.find(p => p.label === 'СЕГОДНЯ') || PERIODS[0]).getRange();
  }, []);

  const getInitialPeriodPreset = useCallback(() => {
    const savedLabel = localStorage.getItem(`${pageKey}_periodLabel`);
    return PERIODS.find(p => p.label === savedLabel) || PERIODS.find(p => p.label === 'СЕГОДНЯ') || PERIODS[0];
  }, [pageKey]);

  const getInitialCustomPeriod = useCallback(() => {
    const savedFrom = localStorage.getItem(`${pageKey}_customFrom`);
    const savedTo = localStorage.getItem(`${pageKey}_customTo`);
    const currentInitialPreset = getInitialPeriodPreset();
    let defaultFrom, defaultTo;

    if (currentInitialPreset.label === 'ВАШ ПЕРИОД' && savedFrom && savedTo) {
      defaultFrom = savedFrom;
      defaultTo = savedTo;
    } else {
      const range = currentInitialPreset.getRange();
      defaultFrom = formatDateForInput(range[0]);
      defaultTo = formatDateForInput(range[1]);
    }
    return { from: defaultFrom, to: defaultTo };
  }, [getInitialPeriodPreset, pageKey]);

  const [currentPeriodPreset, setCurrentPeriodPreset] = useState(getInitialPeriodPreset);
  const [userInputCustomPeriod, setUserInputCustomPeriod] = useState(getInitialCustomPeriod);
  
  // State for tax and acquiring, read from localStorage and updated on storage event
  const [taxSystem, setTaxSystem] = useState(localStorage.getItem('user_tax_system') || '');
  const [acquiringRate, setAcquiringRate] = useState(localStorage.getItem('user_acquiring_rate') || '0');


  const calculatePeriodRange = useCallback((preset, customPeriod) => {
    if (preset.label === 'ВАШ ПЕРИОД') {
      if (customPeriod.from && customPeriod.to && new Date(customPeriod.from).getTime() && new Date(customPeriod.to).getTime()) {
        const fromDate = new Date(customPeriod.from); fromDate.setHours(0,0,0,0);
        const toDate = new Date(customPeriod.to); toDate.setHours(23,59,59,999);
        return { dateFrom: formatDateForInput(fromDate), dateTo: formatDateForInput(toDate) };
      }
      const todayRange = getTodayRange(); // Fallback to today if custom dates are invalid
      return { dateFrom: formatDateForInput(todayRange[0]), dateTo: formatDateForInput(todayRange[1]) };
    }
    const range = preset.getRange();
    return { dateFrom: formatDateForInput(range[0]), dateTo: formatDateForInput(range[1]) };
  }, [getTodayRange]);

  const [currentApiPeriod, setCurrentApiPeriod] = useState(() => 
    calculatePeriodRange(getInitialPeriodPreset(), getInitialCustomPeriod())
  );

  // Effect to update tax/acquiring from localStorage if they change (e.g. from ProfilePage)
  useEffect(() => {
    const handleStorageChange = () => {
      setTaxSystem(localStorage.getItem('user_tax_system') || '');
      setAcquiringRate(localStorage.getItem('user_acquiring_rate') || '0');
      // Force stats re-fetch or re-calculation if parameters changed
      // The useStatsPolling hook will refetch if currentApiPeriod changes.
      // If only tax/acquiring change, calculations below will update automatically.
    };
    window.addEventListener('storage', handleStorageChange);
    // Also listen for custom events if ProfilePage dispatches one on save
    const handleProfileUpdate = () => handleStorageChange(); // Re-read from LS
    window.addEventListener('profileUpdated', handleProfileUpdate);

    return () => {
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener('profileUpdated', handleProfileUpdate);
    };
  }, []);


  useEffect(() => {
    localStorage.setItem(`${pageKey}_periodLabel`, currentPeriodPreset.label);
    if (currentPeriodPreset.label === 'ВАШ ПЕРИОД') {
      localStorage.setItem(`${pageKey}_customFrom`, userInputCustomPeriod.from);
      localStorage.setItem(`${pageKey}_customTo`, userInputCustomPeriod.to);
    }
  }, [currentPeriodPreset, userInputCustomPeriod, pageKey]);
  
  const { stats, statsLoading, coffeeStats, coffeeLoading, error: statsError } = useStatsPolling(currentApiPeriod);

  const handlePeriodPresetChange = (p) => {
    setCurrentPeriodPreset(p);
    let newApiDates;
    if (p.label === 'ВАШ ПЕРИОД') {
      let from = userInputCustomPeriod.from;
      let to = userInputCustomPeriod.to;
      // If custom dates are not set or invalid, use today as default for display and API
      if (!from || !to || !new Date(from).getTime() || !new Date(to).getTime()) {
          const todayRange = getTodayRange();
          from = formatDateForInput(todayRange[0]);
          to = formatDateForInput(todayRange[1]);
          setUserInputCustomPeriod({ from, to }); // Update UI input fields
      }
      newApiDates = { dateFrom: from, dateTo: to };
    } else {
      const range = p.getRange();
      const fromDate = formatDateForInput(range[0]);
      const toDate = formatDateForInput(range[1]);
      setUserInputCustomPeriod({ from: fromDate, to: toDate }); // Update UI input fields
      newApiDates = { dateFrom: fromDate, dateTo: toDate };
    }
    setCurrentApiPeriod(newApiDates);
  };

  const handleCustomDateChange = (field, value) => {
    const updatedInput = { ...userInputCustomPeriod, [field]: value };
    setUserInputCustomPeriod(updatedInput);
    // If "Your Period" is active, update API period immediately
    if (currentPeriodPreset.label === 'ВАШ ПЕРИОД' && updatedInput.from && updatedInput.to) {
       if (new Date(updatedInput.from).getTime() && new Date(updatedInput.to).getTime()) {
           setCurrentApiPeriod({ dateFrom: updatedInput.from, dateTo: updatedInput.to });
       }
    }
  };
  
  const displayDateFrom = userInputCustomPeriod.from;
  const displayDateTo = userInputCustomPeriod.to;

  const revenue = stats.revenue || 0;
  const salesCount = stats.salesCount || 0;
  const expensesSum = stats.expensesSum || 0; // These are 'other' expenses

  let userTaxRateDisplay = 'не задана';
  let actualTaxCalculationRate = 0.00;
  const userAcquiringRatePercent = parseFloat(acquiringRate) || 0;
  const actualAcquiringCalcRate = userAcquiringRatePercent / 100;

  const acquiringCommissionCost = revenue * actualAcquiringCalcRate;
  const revenueAfterAcquiring = revenue - acquiringCommissionCost;

  let taxBaseForCalc = 0;
  if (taxSystem === 'income_6') {
    userTaxRateDisplay = '6% от (Выручка - Эквайринг)';
    actualTaxCalculationRate = 0.06;
    taxBaseForCalc = revenueAfterAcquiring;
  } else if (taxSystem === 'income_expense_15') {
    userTaxRateDisplay = '15% от (Выручка - Эквайринг - Расходы)';
    actualTaxCalculationRate = 0.15;
    taxBaseForCalc = Math.max(0, revenueAfterAcquiring - expensesSum);
  }
  
  const taxes = +(Math.max(0, taxBaseForCalc) * actualTaxCalculationRate).toFixed(2);
  const netProfit = +(revenueAfterAcquiring - expensesSum - taxes).toFixed(2);
  const margin = revenue ? (netProfit / revenue * 100).toFixed(1) : 0;


  return (
    <div className="page-container finances-page">
      <div className="main-content-area">
        <div className="summary-card">
            <h4 className="summary-card-title">
                Показатели за период: <span className="summary-card-period">{currentPeriodPreset.label}</span>
            </h4>
            {statsError && <p className="error-message">Ошибка загрузки статистики: {typeof statsError === 'string' ? statsError : 'Проверьте соединение.'}</p>}
            {statsLoading && !statsError && <p className="loading-message">Загрузка показателей...</p>}
            {!statsLoading && !statsError && (
            <table className="summary-table">
            <tbody>
                <tr><td>Продажи</td><td className="value-cell">{salesCount} шт.</td></tr>
                <tr><td>Выручка (общая)</td><td className="value-cell revenue-value">{revenue.toLocaleString('ru-RU', {minimumFractionDigits: 2, maximumFractionDigits: 2})} ₽</td></tr>
                <tr><td>Расходы (кроме налогов и эквайринга)</td><td className="value-cell">{expensesSum.toLocaleString('ru-RU', {minimumFractionDigits: 2, maximumFractionDigits: 2})} ₽</td></tr>
                <tr>
                  <td>Эквайринг ({userAcquiringRatePercent > 0 ? `${userAcquiringRatePercent.toFixed(1)}%` : 'не задан'})</td>
                  <td className="value-cell">{acquiringCommissionCost.toLocaleString('ru-RU', {minimumFractionDigits: 2, maximumFractionDigits: 2})} ₽</td>
                </tr>
                <tr>
                  <td>Выручка (после эквайринга)</td>
                  <td className="value-cell">{revenueAfterAcquiring.toLocaleString('ru-RU', {minimumFractionDigits: 2, maximumFractionDigits: 2})} ₽</td>
                </tr>
                 <tr>
                  <td>Налоги ({userTaxRateDisplay})</td>
                  <td className="value-cell">{taxes.toLocaleString('ru-RU', {minimumFractionDigits: 2, maximumFractionDigits: 2})} ₽</td>
                </tr>
                <tr className="profit-row">
                    <td className="profit-label">Чистая Прибыль</td>
                    <td className="value-cell profit-value">{netProfit.toLocaleString('ru-RU', {minimumFractionDigits: 2, maximumFractionDigits: 2})} ₽</td>
                </tr>
                <tr><td>Маржинальность (от общей выручки)</td><td className="value-cell">{margin}%</td></tr>
            </tbody>
            </table>
            )}
        </div>

        <div className="coffee-stats-card">
            <h4 className="coffee-stats-title">Статистика по кофейням</h4>
            {statsError && <p className="error-message">Ошибка загрузки статистики по кофейням.</p>}
            <div className="table-scroll-container">
                <table className="coffee-stats-table">
                <thead>
                    <tr>
                    <th>Кофейня</th>
                    <th className="text-right">Выручка</th>
                    <th className="text-right">Продажи</th>
                    </tr>
                </thead>
                <tbody>
                    {coffeeLoading && !statsError && (
                    <tr><td colSpan={3} className="loading-message text-center">Загрузка кофеен...</td></tr>
                    )}
                    {!coffeeLoading && !statsError && (!coffeeStats || coffeeStats.length === 0) && (
                    <tr><td colSpan={3} className="empty-data-message text-center">Нет данных по кофейням за период</td></tr>
                    )}
                    {!coffeeLoading && !statsError && coffeeStats && coffeeStats.length > 0 && (
                    coffeeStats.map((row, idx) => (
                        <tr key={row.coffee_shop_id || idx}>
                        <td>{row.terminal_comment || `Кофейня ${row.coffee_shop_id}`}</td>
                        <td className="text-right">{Number(row.revenue).toLocaleString('ru-RU', {minimumFractionDigits: 2, maximumFractionDigits: 2})} ₽</td>
                        <td className="text-right">{row.sales_count}</td>
                        </tr>
                    ))
                    )}
                </tbody>
                </table>
            </div>
        </div>
      </div>

      <div className="sidebar-area">
        <div className="date-inputs-container">
            <div className="date-input-item">
                <label htmlFor="finances_from_date_page">Начало:</label>
                <input
                    id="finances_from_date_page" type="date" value={displayDateFrom}
                    onChange={e => handleCustomDateChange('from', e.target.value)}
                    disabled={currentPeriodPreset.label !== 'ВАШ ПЕРИОД'}
                    className="period-date-input"
                />
            </div>
            <div className="date-input-item">
                <label htmlFor="finances_to_date_page">Конец:</label>
                <input
                    id="finances_to_date_page" type="date" value={displayDateTo}
                    onChange={e => handleCustomDateChange('to', e.target.value)}
                    disabled={currentPeriodPreset.label !== 'ВАШ ПЕРИОД'}
                    className="period-date-input"
                />
            </div>
        </div>
        <div className="period-buttons-container">
          {PERIODS.map(p => (
            <button key={p.label}
              className={`period-btn ${currentPeriodPreset.label === p.label ? 'active' : ''}`}
              onClick={() => handlePeriodPresetChange(p)}
            >{p.label}</button>
          ))}
        </div>
      </div>
    </div>
  );
}