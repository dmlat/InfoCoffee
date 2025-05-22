// src/pages/FinancesPage.js
import React, { useState, useEffect, useCallback } from 'react';
import { useStatsPolling } from './useStatsPolling';
import { PERIODS, formatDateForInput } from '../constants';

// Стили для ячеек таблицы теперь лучше определять в CSS, но для примера оставим здесь,
// так как они могут быть очень специфичны для этой таблицы.
// В идеале - вынести в index.css с префиксами типа .finances-table-cell
const cellStyle = { padding: '8px 12px', borderBottom: '1px solid #2a2e37', color: '#c6c6c6' };
const headerCellStyle = { ...cellStyle, color: '#8ae6ff', fontWeight: '600', textAlign: 'left' };
const valueCellStyle = { ...cellStyle, textAlign: 'right', color: '#e0e0e0' };

export default function FinancesPage() {
  const pageKey = 'financesPage_v1_responsive_final'; 

  const getInitialPeriodPreset = useCallback(() => {
    const savedLabel = localStorage.getItem(`${pageKey}_periodLabel`);
    const foundPeriod = PERIODS.find(p => p.label === savedLabel);
    return foundPeriod || PERIODS[0];
  }, [pageKey]); 

  const getInitialCustomPeriod = useCallback(() => {
    const savedFrom = localStorage.getItem(`${pageKey}_customFrom`);
    const savedTo = localStorage.getItem(`${pageKey}_customTo`);
    const defaultPreset = getInitialPeriodPreset();
    const defaultRange = defaultPreset.getRange();
    return {
      from: savedFrom || formatDateForInput(defaultRange[0]),
      to: savedTo || formatDateForInput(defaultRange[1]),
    };
  }, [getInitialPeriodPreset, pageKey]);
  
  const [currentPeriodPreset, setCurrentPeriodPreset] = useState(getInitialPeriodPreset);
  const [userInputCustomPeriod, setUserInputCustomPeriod] = useState(getInitialCustomPeriod);
  
  const [currentPeriodRange, setCurrentPeriodRange] = useState(() => {
    const initialPreset = getInitialPeriodPreset();
    if (initialPreset.label === 'ВАШ ПЕРИОД') {
      const custom = getInitialCustomPeriod();
      if (custom.from && custom.to) {
        const fromDate = new Date(custom.from); fromDate.setHours(0,0,0,0);
        const toDate = new Date(custom.to); toDate.setHours(23,59,59,999);
        return [fromDate, toDate];
      }
    }
    return initialPreset.getRange();
  });

  useEffect(() => {
    localStorage.setItem(`${pageKey}_periodLabel`, currentPeriodPreset.label);
    localStorage.setItem(`${pageKey}_customFrom`, userInputCustomPeriod.from);
    localStorage.setItem(`${pageKey}_customTo`, userInputCustomPeriod.to);
  }, [currentPeriodPreset, userInputCustomPeriod, pageKey]);

  const { stats, statsLoading, coffeeStats, coffeeLoading } = useStatsPolling(currentPeriodRange);

  const handlePeriodPresetChange = (p) => {
    setCurrentPeriodPreset(p);
    if (p.label === 'ВАШ ПЕРИОД') {
      if (userInputCustomPeriod.from && userInputCustomPeriod.to) {
        const fromDate = new Date(userInputCustomPeriod.from); fromDate.setHours(0,0,0,0);
        const toDate = new Date(userInputCustomPeriod.to); toDate.setHours(23,59,59,999);
        setCurrentPeriodRange([fromDate, toDate]);
      } else {
        setCurrentPeriodRange([null, null]);
      }
    } else {
      setCurrentPeriodRange(p.getRange());
    }
  };

  const handleCustomDateChange = (field, value) => {
    const updatedInput = { ...userInputCustomPeriod, [field]: value };
    setUserInputCustomPeriod(updatedInput);
    if (currentPeriodPreset.label === 'ВАШ ПЕРИОД' && updatedInput.from && updatedInput.to) {
      const fromDate = new Date(updatedInput.from); fromDate.setHours(0,0,0,0);
      const toDate = new Date(updatedInput.to); toDate.setHours(23,59,59,999);
      setCurrentPeriodRange([fromDate, toDate]);
    }
  };
  
  const displayDateFrom = currentPeriodPreset.label === 'ВАШ ПЕРИОД' ? userInputCustomPeriod.from : formatDateForInput(currentPeriodRange[0]);
  const displayDateTo = currentPeriodPreset.label === 'ВАШ ПЕРИОД' ? userInputCustomPeriod.to : formatDateForInput(currentPeriodRange[1]);

  const revenue = stats.revenue || 0;
  const salesCount = stats.salesCount || 0;
  const expensesSum = stats.expensesSum || 0;
  const userTaxRate = 0.06; 
  const userAcquiringRate = 0.016;
  const taxes = +(revenue * userTaxRate).toFixed(2);
  const acquiring = +(revenue * userAcquiringRate).toFixed(2);
  const netProfit = +(revenue - expensesSum - taxes - acquiring).toFixed(2);
  const margin = revenue ? (netProfit / revenue * 100).toFixed(1) : 0;

  return (
    <div className="page-container"> {/* Используем CSS класс */}
      <div className="main-content-area"> {/* Используем CSS класс */}
        <div style={{ background: '#23272f', padding: '18px', borderRadius: '14px', marginBottom: '24px' }}>
            <h4 style={{marginTop: 0, marginBottom: '15px', color: '#8ae6ff', fontSize: '1.1em'}}>
                Показатели за период: <span style={{color: '#ffffff', fontWeight: 'bold'}}>{currentPeriodPreset.label}</span>
            </h4>
            {statsLoading ? ( <p style={{color: '#888'}}>Загрузка показателей...</p> ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 16}}>
            <tbody>
                <tr><td style={{...cellStyle, fontWeight: 500}}>Продажи</td><td style={valueCellStyle}>{salesCount} шт.</td></tr>
                <tr><td style={{...cellStyle, fontWeight: 500}}>Выручка</td><td style={{ ...valueCellStyle, color: '#ffb300', fontWeight: 'bold' }}>{revenue.toLocaleString('ru-RU', {minimumFractionDigits: 2, maximumFractionDigits: 2})} ₽</td></tr>
                <tr><td style={{...cellStyle, fontWeight: 500}}>Расходы</td><td style={valueCellStyle}>{expensesSum.toLocaleString('ru-RU', {minimumFractionDigits: 2, maximumFractionDigits: 2})} ₽</td></tr>
                <tr><td style={{...cellStyle, fontWeight: 500}}>Налоги ({ (userTaxRate * 100).toFixed(0) }%)</td><td style={valueCellStyle}>{taxes.toLocaleString('ru-RU', {minimumFractionDigits: 2, maximumFractionDigits: 2})} ₽</td></tr>
                <tr><td style={{...cellStyle, fontWeight: 500}}>Эквайринг ({ (userAcquiringRate * 100).toFixed(1) }%)</td><td style={valueCellStyle}>{acquiring.toLocaleString('ru-RU', {minimumFractionDigits: 2, maximumFractionDigits: 2})} ₽</td></tr>
                <tr style={{ background: '#2a2e37' }}>
                    <td style={{ ...cellStyle, fontWeight: 700, color: '#fff', borderBottom: '1px solid #3a3e47' }}>Прибыль</td>
                    <td style={{ ...valueCellStyle, fontWeight: 700, color: '#4caf50', borderBottom: '1px solid #3a3e47' }}>{netProfit.toLocaleString('ru-RU', {minimumFractionDigits: 2, maximumFractionDigits: 2})} ₽</td>
                </tr>
                <tr><td style={{...cellStyle, fontWeight: 500, borderBottom: 'none'}}>Маржинальность</td><td style={{...valueCellStyle, borderBottom: 'none'}}>{margin}%</td></tr>
            </tbody>
            </table>
            )}
        </div>

        <div style={{maxHeight: '400px', overflowY: 'auto'}}>
        <table style={{ width: '100%', borderCollapse: 'collapse', background: '#23272f', borderRadius: 12, overflow: 'hidden' }}>
          <thead>
            <tr style={{ background: '#1f2330', color: '#8ae6ff', position: 'sticky', top: 0, zIndex: 1 }}>
              <th style={headerCellStyle}>Статистика Кофеен</th>
              <th style={{...headerCellStyle, textAlign: 'right'}}>Выручка</th>
              <th style={{...headerCellStyle, textAlign: 'right'}}>Продажи</th>
            </tr>
          </thead>
          <tbody>
            {coffeeLoading ? (
              <tr><td colSpan={3} style={{ color: '#888', padding: 20, textAlign: 'center', borderBottom: '1px solid #2a2e37' }}>Загрузка кофеен...</td></tr>
            ) : coffeeStats.length === 0 ? (
              <tr><td colSpan={3} style={{ color: '#888', padding: 20, textAlign: 'center', borderBottom: '1px solid #2a2e37' }}>Нет данных по кофейням за период</td></tr>
            ) : (
              coffeeStats.map((row, idx) => (
                <tr key={row.id || idx} style={{ background: idx % 2 ? '#262a36' : '#23273a', borderBottom: '1px solid #303548' }}>
                  <td style={{...cellStyle, color: '#c6c6c6', borderBottom: 'none'}}>{row.name || `Кофейня ${row.coffee_shop_id || idx + 1}`}</td>
                  <td style={{...valueCellStyle, borderBottom: 'none'}}>{Number(row.revenue).toLocaleString('ru-RU', {minimumFractionDigits: 2, maximumFractionDigits: 2})} ₽</td>
                  <td style={{...valueCellStyle, borderBottom: 'none'}}>{row.sales_count}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        </div>
      </div>

      <div className="sidebar-area"> {/* Используем CSS класс */}
        <div className="date-inputs-container"> {/* Используем CSS класс */}
            <label htmlFor="finances_from_date_page" style={{fontSize: '0.9em', color: '#a0a0a0'}}>Своя дата С:</label>
            <input 
                id="finances_from_date_page" type="date" value={displayDateFrom}
                onChange={e => handleCustomDateChange('from', e.target.value)}
                disabled={currentPeriodPreset.label !== 'ВАШ ПЕРИОД'}
                className="period-date-input" // Используем CSS класс
            />
            <label htmlFor="finances_to_date_page" style={{fontSize: '0.9em', color: '#a0a0a0', marginTop: '5px'}}>Своя дата ПО:</label>
            <input 
                id="finances_to_date_page" type="date" value={displayDateTo}
                onChange={e => handleCustomDateChange('to', e.target.value)}
                disabled={currentPeriodPreset.label !== 'ВАШ ПЕРИОД'}
                className="period-date-input" // Используем CSS класс
            />
        </div>
        <div className="period-buttons-container"> {/* Используем CSS класс */}
          {PERIODS.map(p => (
            <button key={p.label}
              className={currentPeriodPreset.label === p.label ? 'period-btn active' : 'period-btn'}
              onClick={() => handlePeriodPresetChange(p)}
              // Инлайновый style для ширины убран, т.к. управляется через CSS класс .period-buttons-container и .period-btn
            >{p.label}</button>
          ))}
        </div>
      </div>
    </div>
  );
}