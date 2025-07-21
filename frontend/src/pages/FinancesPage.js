// src/pages/FinancesPage.js
import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../App'; // Импортируем useAuth
import useStatsPolling from './useStatsPolling'; 
import { PERIODS, formatDateForInput } from '../constants'; 
import './FinancesPage.css';
import '../styles/tables.css'; // Импортируем общие стили для таблиц

export default function FinancesPage() { // Удаляем user из пропсов
  const { user, token } = useAuth(); // Получаем user и token из контекста
  const pageKey = 'financesPage_v7_custom_persist'; 

  const getTodayRange = useCallback(() => {
    return (PERIODS.find(p => p.label === 'СЕГОДНЯ') || PERIODS[0]).getRange();
  }, []);

  const getInitialPeriodPreset = useCallback(() => {
    const savedLabel = localStorage.getItem(`${pageKey}_periodLabel`);
    const foundPeriod = PERIODS.find(p => p.label === savedLabel);
    return foundPeriod || PERIODS.find(p => p.label === 'СЕГОДНЯ') || PERIODS[0];
  }, [pageKey]);

  const getInitialUserCustomPeriod = useCallback(() => {
    const savedFrom = localStorage.getItem(`${pageKey}_userCustomFrom`);
    const savedTo = localStorage.getItem(`${pageKey}_userCustomTo`);
    if (savedFrom && savedTo) {
      return { from: savedFrom, to: savedTo };
    }
    const todayRange = getTodayRange();
    return { from: formatDateForInput(todayRange[0]), to: formatDateForInput(todayRange[1]) };
  }, [pageKey, getTodayRange]);

  const [currentPeriodPreset, setCurrentPeriodPreset] = useState(getInitialPeriodPreset);
  const [userCustomPeriodSelection, setUserCustomPeriodSelection] = useState(getInitialUserCustomPeriod);

  const [displayDatesInInputs, setDisplayDatesInInputs] = useState(() => {
    const initialPreset = getInitialPeriodPreset();
    if (initialPreset.label === 'ВАШ ПЕРИОД') {
      return getInitialUserCustomPeriod();
    }
    const range = initialPreset.getRange();
    return { from: formatDateForInput(range[0]), to: formatDateForInput(range[1]) };
  });

  const [apiPeriod, setApiPeriod] = useState(() => {
    const initialPreset = getInitialPeriodPreset();
    if (initialPreset.label === 'ВАШ ПЕРИОД') {
      const initialUserCustom = getInitialUserCustomPeriod();
      if (initialUserCustom.from && initialUserCustom.to && 
          new Date(initialUserCustom.from).getTime() && new Date(initialUserCustom.to).getTime()) {
        return { dateFrom: initialUserCustom.from, dateTo: initialUserCustom.to };
      }
      const todayRange = getTodayRange();
      return { dateFrom: formatDateForInput(todayRange[0]), dateTo: formatDateForInput(todayRange[1]) };
    }
    const range = initialPreset.getRange();
    return { dateFrom: formatDateForInput(range[0]), dateTo: formatDateForInput(range[1]) };
  });

  // Добавляем проверку на user перед доступом к business_profile
  const taxSystem = user?.business_profile?.tax_system || '';
  const acquiringRate = user?.business_profile?.acquiring_rate || '0';

  useEffect(() => {
    localStorage.setItem(`${pageKey}_periodLabel`, currentPeriodPreset.label);
    localStorage.setItem(`${pageKey}_userCustomFrom`, userCustomPeriodSelection.from);
    localStorage.setItem(`${pageKey}_userCustomTo`, userCustomPeriodSelection.to);
    // console.log('[FinancesPage] Period state saved to localStorage.');
  }, [currentPeriodPreset, userCustomPeriodSelection, pageKey]);
  
  const { isLoading: isAuthLoading } = useAuth();

  // console.log('[FinancesPage] Rendering. Auth loading:', isAuthLoading, 'Token available:', !!token, 'API Period:', apiPeriod);
  
  const { stats, statsLoading, coffeeStats, coffeeLoading, error: statsError } = useStatsPolling(apiPeriod, isAuthLoading ? null : token);

  const handlePeriodPresetChange = (p) => {
    setCurrentPeriodPreset(p);
    let newApiDates;
    let newDisplayDates;

    if (p.label === 'ВАШ ПЕРИОД') {
      newDisplayDates = { ...userCustomPeriodSelection };
      if (!newDisplayDates.from || !newDisplayDates.to || 
          !new Date(newDisplayDates.from).getTime() || !new Date(newDisplayDates.to).getTime()) {
        const todayRangeDefault = getTodayRange();
        newDisplayDates = { 
          from: formatDateForInput(todayRangeDefault[0]), 
          to: formatDateForInput(todayRangeDefault[1]) 
        };
        setUserCustomPeriodSelection(newDisplayDates); 
      }
      newApiDates = { dateFrom: newDisplayDates.from, dateTo: newDisplayDates.to };
    } else {
      const range = p.getRange();
      const fromDate = formatDateForInput(range[0]);
      const toDate = formatDateForInput(range[1]);
      newDisplayDates = { from: fromDate, to: toDate };
      newApiDates = { dateFrom: fromDate, dateTo: toDate };
    }
    setDisplayDatesInInputs(newDisplayDates);
    setApiPeriod(newApiDates);
    // console.log('[FinancesPage] Period changed. New API Period:', newApiDates);
  };

  const handleCustomDateChange = (field, value) => {
    if (currentPeriodPreset.label === 'ВАШ ПЕРИОД') {
      const updatedSelection = { ...userCustomPeriodSelection, [field]: value };
      setUserCustomPeriodSelection(updatedSelection);
      setDisplayDatesInInputs(updatedSelection); 

      if (updatedSelection.from && updatedSelection.to &&
          new Date(updatedSelection.from).getTime() && new Date(updatedSelection.to).getTime()) {
        const newApiDates = { dateFrom: updatedSelection.from, dateTo: updatedSelection.to };
        setApiPeriod(newApiDates);
        // console.log('[FinancesPage] Custom date changed. New API Period:', newApiDates);
      }
    }
  };
  
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
    userTaxRateDisplay = 'Доходы 6%';
    actualTaxCalculationRate = 0.06;
    taxBaseForCalc = revenueAfterAcquiring;
  } else if (taxSystem === 'income_expense_15') {
    userTaxRateDisplay = 'Доходы - Расходы 15%';
    actualTaxCalculationRate = 0.15;
    taxBaseForCalc = Math.max(0, revenueAfterAcquiring - expensesSum);
  }
  
  const taxes = +(Math.max(0, taxBaseForCalc) * actualTaxCalculationRate).toFixed(2);
  const netProfit = +(revenueAfterAcquiring - expensesSum - taxes).toFixed(2);
  const margin = revenue ? (netProfit / revenue * 100).toFixed(1) : 0;

  const formattedAcquiringRateDisplay = userAcquiringRatePercent > 0 
    ? `${userAcquiringRatePercent.toLocaleString('ru-RU', {minimumFractionDigits: 1, maximumFractionDigits: 1})}%` 
    : 'не задан';

  // -- НОВОЕ: Показываем заглушку во время проверки авторизации --
  if (isAuthLoading) {
    return (
        <div className="page-container finances-page">
            <div className="main-content-area">
                <div className="summary-card">
                    <p className="loading-message">Проверка авторизации...</p>
                </div>
            </div>
        </div>
    );
  }

  return (
    <div className="page-container finances-page"> 
      <div className="sidebar-area">
        <div className="date-inputs-container">
            <div className="date-input-item">
                <label htmlFor="finances_from_date_page">Начало:</label>
                <input
                    id="finances_from_date_page" type="date" 
                    value={displayDatesInInputs.from}
                    onChange={e => handleCustomDateChange('from', e.target.value)}
                    disabled={currentPeriodPreset.label !== 'ВАШ ПЕРИОД'}
                    className="period-date-input"
                />
            </div>
            <div className="date-input-item">
                <label htmlFor="finances_to_date_page">Конец:</label>
                <input
                    id="finances_to_date_page" type="date" 
                    value={displayDatesInInputs.to}
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
                <tr><td>Продажи</td><td className="value-cell">{salesCount.toLocaleString('ru-RU')}{`\u00A0`}шт.</td></tr>
                <tr><td>Выручка (общая)</td><td className="value-cell revenue-value">{revenue.toLocaleString('ru-RU', {minimumFractionDigits: 2, maximumFractionDigits: 2})}{`\u00A0`}₽</td></tr>
                <tr>
                    <td>Эквайринг ({formattedAcquiringRateDisplay})</td> 
                    <td className="value-cell">{acquiringCommissionCost.toLocaleString('ru-RU', {minimumFractionDigits: 2, maximumFractionDigits: 2})}{`\u00A0`}₽</td>
                </tr>
                <tr>
                    <td>Выручка (за вычетом эквайринга)</td>
                    <td className="value-cell">{revenueAfterAcquiring.toLocaleString('ru-RU', {minimumFractionDigits: 2, maximumFractionDigits: 2})}{`\u00A0`}₽</td>
                </tr>
                <tr><td>Расходы</td><td className="value-cell">{expensesSum.toLocaleString('ru-RU', {minimumFractionDigits: 2, maximumFractionDigits: 2})}{`\u00A0`}₽</td></tr>
                <tr>
                    <td>Налоги ({userTaxRateDisplay})</td>
                    <td className="value-cell">{taxes.toLocaleString('ru-RU', {minimumFractionDigits: 2, maximumFractionDigits: 2})}{`\u00A0`}₽</td>
                </tr>
                <tr className="profit-row">
                    <td className="profit-label">Чистая Прибыль</td>
                    <td className="value-cell profit-value">{netProfit.toLocaleString('ru-RU', {minimumFractionDigits: 2, maximumFractionDigits: 2})}{`\u00A0`}₽</td>
                </tr>
                <tr><td>Маржинальность (от общей выручки)</td><td className="value-cell">{margin}%</td></tr>
            </tbody>
            </table>
            )}
        </div>

        <div className="table-block coffee-stats-card">
            <table className="data-table coffee-stats-table"> 
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
                <tr className="empty-data-row"><td colSpan={3}>Нет данных по кофейням за период</td></tr>
                )}
                {!coffeeLoading && !statsError && coffeeStats && coffeeStats.length > 0 && (
                coffeeStats.map((row, idx) => (
                    <tr key={row.coffee_shop_id || idx}>
                    <td className="td-coffee-shop-name">{row.terminal_comment || `Кофейня ${row.coffee_shop_id}`}</td>
                    <td className="td-revenue text-right">{Number(row.revenue).toLocaleString('ru-RU', {minimumFractionDigits: 2, maximumFractionDigits: 2})}{` `}₽</td>
                    <td className="td-sales-count text-right">{Number(row.sales_count).toLocaleString('ru-RU')}</td>
                    </tr>
                ))
                )}
            </tbody>
            </table>
        </div>
      </div>
    </div>
  );
}