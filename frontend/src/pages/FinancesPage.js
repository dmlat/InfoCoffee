// src/pages/FinancesPage.js
import React, { useState, useEffect, useCallback } from 'react';
import { useStatsPolling } from './useStatsPolling'; // Убедись, что useStatsPolling.js в той же папке
import { PERIODS, formatDateForInput } from '../constants';

const cellStyle = { padding: '8px 12px', borderBottom: '1px solid #2a2e37', color: '#c6c6c6' };
// Базовый стиль для заголовков таблиц, fontSize соответствует h4 на мобильных (из index.css)
const baseHeaderCellStyle = {
    padding: '8px 12px',
    borderBottom: '1px solid #2a2e37',
    color: '#8ae6ff',
    fontWeight: '600',
    textAlign: 'left',
    fontSize: '1.0em' // Как h4 на мобильных
};
const valueCellStyle = { ...cellStyle, textAlign: 'right', color: '#e0e0e0' };

export default function FinancesPage() {
  const pageKey = 'financesPage_v4_dynamic_rates_final'; // Новый ключ для сброса старых данных localStorage

  const getTodayRange = useCallback(() => { // Вспомогательная функция для получения диапазона "СЕГОДНЯ"
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
    const currentInitialPreset = getInitialPeriodPreset(); // Используем getInitialPeriodPreset чтобы избежать рекурсии
    
    if (currentInitialPreset.label === 'ВАШ ПЕРИОД' && savedFrom && savedTo) {
        defaultFrom = savedFrom;
        defaultTo = savedTo;
    } else { 
        const range = currentInitialPreset.getRange();
        if (range[0] && range[1]) {
            defaultFrom = formatDateForInput(range[0]);
            defaultTo = formatDateForInput(range[1]);
        } else { // Если getRange для пресета вернул null (например, для "ВАШ ПЕРИОД" без сохраненных дат)
            const todayRange = getTodayRange();
            defaultFrom = formatDateForInput(todayRange[0]);
            defaultTo = formatDateForInput(todayRange[1]);
        }
    }
    return { from: defaultFrom, to: defaultTo };
  }, [getInitialPeriodPreset, pageKey, getTodayRange]);
  
  const [currentPeriodPreset, setCurrentPeriodPreset] = useState(getInitialPeriodPreset);
  const [userInputCustomPeriod, setUserInputCustomPeriod] = useState(getInitialCustomPeriod);
  
  const [currentPeriodRange, setCurrentPeriodRange] = useState(() => {
    const initialPreset = getInitialPeriodPreset();
    if (initialPreset.label === 'ВАШ ПЕРИОД') {
      const custom = getInitialCustomPeriod();
      if (custom.from && custom.to && new Date(custom.from).getTime() && new Date(custom.to).getTime()) {
        const fromDate = new Date(custom.from); fromDate.setHours(0,0,0,0);
        const toDate = new Date(custom.to); toDate.setHours(23,59,59,999);
        return [fromDate, toDate];
      }
      // Если кастомные даты невалидны, ставим сегодняшний день по умолчанию
      return getTodayRange();
    }
    return initialPreset.getRange();
  });

  useEffect(() => {
    localStorage.setItem(`${pageKey}_periodLabel`, currentPeriodPreset.label);
    if (currentPeriodPreset.label === 'ВАШ ПЕРИОД') {
        localStorage.setItem(`${pageKey}_customFrom`, userInputCustomPeriod.from);
        localStorage.setItem(`${pageKey}_customTo`, userInputCustomPeriod.to);
    }
  }, [currentPeriodPreset, userInputCustomPeriod, pageKey]);

  const { stats, statsLoading, coffeeStats, coffeeLoading, error: statsError } = useStatsPolling(currentPeriodRange);

  const handlePeriodPresetChange = (p) => {
    setCurrentPeriodPreset(p);
    let newRange;
    if (p.label === 'ВАШ ПЕРИОД') {
      let from = userInputCustomPeriod.from;
      let to = userInputCustomPeriod.to;
      if (!from || !to || !new Date(from).getTime() || !new Date(to).getTime()) {
          const todayRangeDefault = getTodayRange();
          from = formatDateForInput(todayRangeDefault[0]);
          to = formatDateForInput(todayRangeDefault[1]);
          setUserInputCustomPeriod({from, to}); 
      }
      const fromDate = new Date(from); fromDate.setHours(0,0,0,0);
      const toDate = new Date(to); toDate.setHours(23,59,59,999);
      newRange = [fromDate, toDate];
    } else {
      newRange = p.getRange();
      setUserInputCustomPeriod({
        from: formatDateForInput(newRange[0]),
        to: formatDateForInput(newRange[1]),
      });
    }
    setCurrentPeriodRange(newRange);
  };

  const handleCustomDateChange = (field, value) => {
    const updatedInput = { ...userInputCustomPeriod, [field]: value };
    setUserInputCustomPeriod(updatedInput);
    if (currentPeriodPreset.label === 'ВАШ ПЕРИОД' && updatedInput.from && updatedInput.to) {
      if (new Date(updatedInput.from).getTime() && new Date(updatedInput.to).getTime()) {
        const fromDate = new Date(updatedInput.from); fromDate.setHours(0,0,0,0);
        const toDate = new Date(updatedInput.to); toDate.setHours(23,59,59,999);
        setCurrentPeriodRange([fromDate, toDate]);
      }
    }
  };
  
  const displayDateFrom = userInputCustomPeriod.from;
  const displayDateTo = userInputCustomPeriod.to;

  const revenue = stats.revenue || 0;
  const salesCount = stats.salesCount || 0;
  const expensesSum = stats.expensesSum || 0;

  // --- ДИНАМИЧЕСКОЕ ПОЛУЧЕНИЕ СТАВОК ---
  const storedTaxSystem = localStorage.getItem('tax_system'); // e.g., "income_6"
  const storedAcquiringRate = localStorage.getItem('acquiring_rate') || '0'; // e.g., "1.6"

  let userTaxRateDisplay = 0; 
  let actualTaxCalculationRate = 0.00;

  if (storedTaxSystem === 'income_6') {
    userTaxRateDisplay = 6;
    actualTaxCalculationRate = 0.06;
  } else if (storedTaxSystem === 'income_expense_15') {
    userTaxRateDisplay = 15;
    actualTaxCalculationRate = 0.15; // Ставка для Доходы-Расходы
  }
  // Если tax_system не задан или другой, userTaxRateDisplay и actualTaxCalculationRate останутся 0

  const userAcquiringRateDisplay = parseFloat(storedAcquiringRate) || 0; // Для отображения (1.6)
  const actualAcquiringCalculationRate = userAcquiringRateDisplay / 100; // Для расчета (0.016)

  let taxBase = revenue;
  if (storedTaxSystem === 'income_expense_15') {
    taxBase = Math.max(0, revenue - expensesSum); 
  }

  const taxes = +(taxBase * actualTaxCalculationRate).toFixed(2);
  const acquiring = +(revenue * actualAcquiringCalculationRate).toFixed(2);
  const netProfit = +(revenue - expensesSum - taxes - acquiring).toFixed(2);
  const margin = revenue ? (netProfit / revenue * 100).toFixed(1) : 0;

  return (
    <div className="page-container">
      <div className="main-content-area">
        <div style={{ background: '#23272f', padding: '18px', borderRadius: '14px', marginBottom: '24px' }}>
            <h4 style={{marginTop: 0, marginBottom: '15px', color: '#8ae6ff'}}>
                Показатели за период: <span style={{color: '#ffffff', fontWeight: 'bold'}}>{currentPeriodPreset.label}</span>
            </h4>
            {statsError && <p style={{color: 'salmon'}}>Ошибка загрузки статистики: {typeof statsError === 'string' ? statsError : 'Проверьте соединение или попробуйте позже.'}</p>}
            {statsLoading && !statsError && <p style={{color: '#888'}}>Загрузка показателей...</p>}
            {!statsLoading && !statsError && (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.95em'}}>
            <tbody>
                <tr><td style={{...cellStyle, fontWeight: 500}}>Продажи</td><td style={valueCellStyle}>{salesCount} шт.</td></tr>
                <tr><td style={{...cellStyle, fontWeight: 500}}>Выручка</td><td style={{ ...valueCellStyle, color: '#ffb300', fontWeight: 'bold' }}>{revenue.toLocaleString('ru-RU', {minimumFractionDigits: 2, maximumFractionDigits: 2})} ₽</td></tr>
                <tr><td style={{...cellStyle, fontWeight: 500}}>Расходы</td><td style={valueCellStyle}>{expensesSum.toLocaleString('ru-RU', {minimumFractionDigits: 2, maximumFractionDigits: 2})} ₽</td></tr>
                <tr>
                  <td style={{...cellStyle, fontWeight: 500}}>
                    Налоги ({storedTaxSystem === 'income_expense_15' 
                            ? `${userTaxRateDisplay}% от (Д-Р)` 
                            : (userTaxRateDisplay ? `${userTaxRateDisplay}%` : 'не задан')})
                  </td>
                  <td style={valueCellStyle}>{taxes.toLocaleString('ru-RU', {minimumFractionDigits: 2, maximumFractionDigits: 2})} ₽</td>
                </tr>
                <tr>
                  <td style={{...cellStyle, fontWeight: 500}}>
                    Эквайринг ({userAcquiringRateDisplay > 0 ? `${userAcquiringRateDisplay.toFixed(1)}%` : 'не задан'})
                  </td>
                  <td style={valueCellStyle}>{acquiring.toLocaleString('ru-RU', {minimumFractionDigits: 2, maximumFractionDigits: 2})} ₽</td>
                </tr>
                <tr style={{ background: '#2a2e37' }}>
                    <td style={{ ...cellStyle, fontWeight: 700, color: '#fff', borderBottom: '1px solid #3a3e47' }}>Прибыль</td>
                    <td style={{ ...valueCellStyle, fontWeight: 700, color: '#4caf50', borderBottom: '1px solid #3a3e47' }}>{netProfit.toLocaleString('ru-RU', {minimumFractionDigits: 2, maximumFractionDigits: 2})} ₽</td>
                </tr>
                <tr><td style={{...cellStyle, fontWeight: 500, borderBottom: 'none'}}>Маржинальность</td><td style={{...valueCellStyle, borderBottom: 'none'}}>{margin}%</td></tr>
            </tbody>
            </table>
            )}
        </div>

        <div>
            {statsError && <p style={{color: 'salmon'}}>Ошибка загрузки статистики по кофейням.</p>}
            <div style={{maxHeight: '400px', overflowY: 'auto'}}>
                <table style={{ width: '100%', borderCollapse: 'collapse', background: '#23272f', borderRadius: '12px', overflow: 'hidden' }}>
                <thead>
                    <tr style={{ background: '#1f2330', color: '#8ae6ff', position: 'sticky', top: 0, zIndex: 1 }}>
                    <th style={baseHeaderCellStyle}>Кофейня</th>
                    <th style={{...baseHeaderCellStyle, textAlign: 'right'}}>Выручка</th>
                    <th style={{...baseHeaderCellStyle, textAlign: 'right'}}>Продажи</th>
                    </tr>
                </thead>
                <tbody>
                    {coffeeLoading && !statsError && (
                    <tr><td colSpan={3} style={{ ...cellStyle, color: '#888', padding: 20, textAlign: 'center' }}>Загрузка кофеен...</td></tr>
                    )}
                    {!coffeeLoading && !statsError && (!coffeeStats || coffeeStats.length === 0) && (
                    <tr><td colSpan={3} style={{ ...cellStyle, color: '#888', padding: 20, textAlign: 'center' }}>Нет данных по кофейням за период</td></tr>
                    )}
                    {!coffeeLoading && !statsError && coffeeStats && coffeeStats.length > 0 && (
                    coffeeStats.map((row, idx) => (
                        <tr key={row.coffee_shop_id || idx} style={{ background: idx % 2 ? '#262a36' : '#23273a' }}>
                        <td style={{...cellStyle, borderBottom: idx === coffeeStats.length - 1 ? 'none' : cellStyle.borderBottom}}>{row.name || `Кофейня ${row.coffee_shop_id}`}</td>
                        <td style={{...valueCellStyle, borderBottom: idx === coffeeStats.length - 1 ? 'none' : valueCellStyle.borderBottom}}>{Number(row.revenue).toLocaleString('ru-RU', {minimumFractionDigits: 2, maximumFractionDigits: 2})} ₽</td>
                        <td style={{...valueCellStyle, borderBottom: idx === coffeeStats.length - 1 ? 'none' : valueCellStyle.borderBottom}}>{row.sales_count}</td>
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
                {/* Лейбл теперь стилизуется через CSS класс .date-input-item label */}
                <label htmlFor="finances_from_date_page">Начало периода:</label>
                <input
                    id="finances_from_date_page" type="date" value={displayDateFrom}
                    onChange={e => handleCustomDateChange('from', e.target.value)}
                    disabled={currentPeriodPreset.label !== 'ВАШ ПЕРИОД'}
                    className="period-date-input"
                />
            </div>
            <div className="date-input-item">
                <label htmlFor="finances_to_date_page">Конец периода:</label>
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
              className={currentPeriodPreset.label === p.label ? 'period-btn active' : 'period-btn'}
              onClick={() => handlePeriodPresetChange(p)}
            >{p.label}</button>
          ))}
        </div>
      </div>
    </div>
  );
}