// src/pages/FinancesPage.js
import React, { useState, useEffect, useCallback } from 'react';
import { useStatsPolling } from './useStatsPolling';
import { PERIODS, formatDateForInput } from '../constants';

// Стили оставим как были в твоей последней версии или в index.css

export default function FinancesPage() {
  const pageKey = 'financesPage_v6_profile_sync'; // Обновим ключ для сброса, если структура хранения меняется

  // Функции getTodayRange, getInitialPeriodPreset, getInitialCustomPeriod остаются как в твоей последней версии
  const getTodayRange = useCallback(() => {
    return (PERIODS.find(p => p.label === 'СЕГОДНЯ') || PERIODS[0]).getRange();
  }, []);

  const getInitialPeriodPreset = useCallback(() => {
    const savedLabel = localStorage.getItem(`${pageKey}_periodLabel`);
    const foundPeriod = PERIODS.find(p => p.label === savedLabel);
    return foundPeriod || PERIODS.find(p => p.label === 'СЕГОДНЯ') || PERIODS[0];
  }, [pageKey]);

  const getInitialCustomPeriod = useCallback(() => {
    const savedFrom = localStorage.getItem(`${pageKey}_customFrom`);
    const savedTo = localStorage.getItem(`${pageKey}_customTo`);
    let defaultFrom, defaultTo;
    const currentInitialPreset = getInitialPeriodPreset();
    
    if (currentInitialPreset.label === 'ВАШ ПЕРИОД' && savedFrom && savedTo) {
        defaultFrom = savedFrom;
        defaultTo = savedTo;
    } else { 
        const range = currentInitialPreset.getRange();
        if (range[0] && range[1]) {
            defaultFrom = formatDateForInput(range[0]);
            defaultTo = formatDateForInput(range[1]);
        } else { 
            const todayRange = getTodayRange();
            defaultFrom = formatDateForInput(todayRange[0]);
            defaultTo = formatDateForInput(todayRange[1]);
        }
    }
    return { from: defaultFrom, to: defaultTo };
  }, [getInitialPeriodPreset, pageKey, getTodayRange]);
  
  const [currentPeriodPreset, setCurrentPeriodPreset] = useState(getInitialPeriodPreset);
  const [userInputCustomPeriod, setUserInputCustomPeriod] = useState(getInitialCustomPeriod);
  
  const [apiPeriod, setApiPeriod] = useState(() => { // Раньше было currentApiPeriod
    const initialPreset = getInitialPeriodPreset();
    const initialCustom = getInitialCustomPeriod();
    if (initialPreset.label === 'ВАШ ПЕРИОД') {
      if (initialCustom.from && initialCustom.to && new Date(initialCustom.from).getTime() && new Date(initialCustom.to).getTime()) {
        return { dateFrom: initialCustom.from, dateTo: initialCustom.to };
      }
      const todayRange = getTodayRange();
      return { dateFrom: formatDateForInput(todayRange[0]), dateTo: formatDateForInput(todayRange[1]) };
    }
    const range = initialPreset.getRange();
    return { dateFrom: formatDateForInput(range[0]), dateTo: formatDateForInput(range[1]) };
  });

  // Состояния для налогов и эквайринга, теперь обновляются по событию
  const [taxSystem, setTaxSystem] = useState(localStorage.getItem('user_tax_system') || '');
  const [acquiringRate, setAcquiringRate] = useState(localStorage.getItem('user_acquiring_rate') || '0');

  // Эффект для обновления налогов/эквайринга из localStorage при монтировании и по событию
  useEffect(() => {
    const updateRatesFromStorage = () => {
      setTaxSystem(localStorage.getItem('user_tax_system') || '');
      setAcquiringRate(localStorage.getItem('user_acquiring_rate') || '0');
    };
    
    updateRatesFromStorage(); // При монтировании

    window.addEventListener('storage', updateRatesFromStorage); // Для изменений из других вкладок (менее вероятно для TWA)
    window.addEventListener('profileSettingsUpdated', updateRatesFromStorage); // Кастомное событие из ProfilePage

    return () => {
      window.removeEventListener('storage', updateRatesFromStorage);
      window.removeEventListener('profileSettingsUpdated', updateRatesFromStorage);
    };
  }, []);


  useEffect(() => {
    localStorage.setItem(`${pageKey}_periodLabel`, currentPeriodPreset.label);
    if (currentPeriodPreset.label === 'ВАШ ПЕРИОД') {
        localStorage.setItem(`${pageKey}_customFrom`, userInputCustomPeriod.from);
        localStorage.setItem(`${pageKey}_customTo`, userInputCustomPeriod.to);
    }
  }, [currentPeriodPreset, userInputCustomPeriod, pageKey]);
  
  // Передаем apiPeriod в хук useStatsPolling
  const { stats, statsLoading, coffeeStats, coffeeLoading, error: statsError } = useStatsPolling(apiPeriod);


  const handlePeriodPresetChange = (p) => {
    setCurrentPeriodPreset(p);
    let newApiDates;
    if (p.label === 'ВАШ ПЕРИОД') {
      let from = userInputCustomPeriod.from;
      let to = userInputCustomPeriod.to;
      if (!from || !to || !new Date(from).getTime() || !new Date(to).getTime()) {
          const todayRangeDefault = getTodayRange();
          from = formatDateForInput(todayRangeDefault[0]);
          to = formatDateForInput(todayRangeDefault[1]);
          setUserInputCustomPeriod({from, to}); 
      }
      newApiDates = { dateFrom: from, dateTo: to };
    } else {
      const range = p.getRange();
      const fromDate = formatDateForInput(range[0]);
      const toDate = formatDateForInput(range[1]);
      setUserInputCustomPeriod({ from: fromDate, to: toDate });
      newApiDates = { dateFrom: fromDate, dateTo: toDate };
    }
    setApiPeriod(newApiDates); // Обновляем apiPeriod, что вызовет перезагрузку данных в useStatsPolling
  };

  const handleCustomDateChange = (field, value) => {
    const updatedInput = { ...userInputCustomPeriod, [field]: value };
    setUserInputCustomPeriod(updatedInput);
    if (currentPeriodPreset.label === 'ВАШ ПЕРИОД' && updatedInput.from && updatedInput.to) {
      if (new Date(updatedInput.from).getTime() && new Date(updatedInput.to).getTime()) {
        setApiPeriod({ dateFrom: updatedInput.from, dateTo: updatedInput.to });
      }
    }
  };
  
  const displayDateFrom = userInputCustomPeriod.from;
  const displayDateTo = userInputCustomPeriod.to;

  const revenue = stats.revenue || 0;
  const salesCount = stats.salesCount || 0;
  const expensesSum = stats.expensesSum || 0;

  let userTaxRateDisplay = 'не задана';
  let actualTaxCalculationRate = 0.00;
  const userAcquiringRatePercent = parseFloat(acquiringRate) || 0;
  const actualAcquiringCalcRate = userAcquiringRatePercent / 100;

  const acquiringCommissionCost = revenue * actualAcquiringCalcRate;
  const revenueAfterAcquiring = revenue - acquiringCommissionCost;

  let taxBaseForCalc = 0;
  if (taxSystem === 'income_6') {
    userTaxRateDisplay = 'Доходы 6%'; // Обновленный текст
    actualTaxCalculationRate = 0.06;
    taxBaseForCalc = revenueAfterAcquiring; // Налог с выручки за вычетом эквайринга
  } else if (taxSystem === 'income_expense_15') {
    userTaxRateDisplay = 'Доходы - Расходы 15%'; // Обновленный текст
    actualTaxCalculationRate = 0.15;
    taxBaseForCalc = Math.max(0, revenueAfterAcquiring - expensesSum); // Налог с (Выручка - Эквайринг - Прочие Расходы)
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
                <tr>
                  <td>Эквайринг ({userAcquiringRatePercent > 0 ? `${userAcquiringRatePercent.toFixed(1)}%` : 'не задан'})</td>
                  <td className="value-cell">{acquiringCommissionCost.toLocaleString('ru-RU', {minimumFractionDigits: 2, maximumFractionDigits: 2})} ₽</td>
                </tr>
                <tr>
                  <td>Выручка (за вычетом эквайринга)</td>
                  <td className="value-cell">{revenueAfterAcquiring.toLocaleString('ru-RU', {minimumFractionDigits: 2, maximumFractionDigits: 2})} ₽</td>
                </tr>
                <tr><td>Прочие расходы</td><td className="value-cell">{expensesSum.toLocaleString('ru-RU', {minimumFractionDigits: 2, maximumFractionDigits: 2})} ₽</td></tr>
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

        {/* Coffee Stats Card остается без изменений */}
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

      {/* Sidebar Area остается без изменений */}
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