// src/pages/FinancesPage.js
import React, { useState, useEffect, useCallback } from 'react';
import { useStatsPolling } from './useStatsPolling'; // Убедись, что путь правильный, если useStatsPolling в той же папке, то './useStatsPolling'
import { PERIODS, formatDateForInput } from '../constants';

const cellStyle = { padding: '8px 12px', borderBottom: '1px solid #2a2e37', color: '#c6c6c6' };
const baseHeaderCellStyle = {
    padding: '8px 12px',
    borderBottom: '1px solid #2a2e37',
    color: '#8ae6ff',
    fontWeight: '600',
    textAlign: 'left',
    fontSize: '1.0em' // Совпадает с h4 на мобильных
};
const valueCellStyle = { ...cellStyle, textAlign: 'right', color: '#e0e0e0' };

export default function FinancesPage() {
  const pageKey = 'financesPage_v2_dynamic_rates'; 

  const getInitialPeriodPreset = useCallback(() => {
    const savedLabel = localStorage.getItem(`${pageKey}_periodLabel`);
    const foundPeriod = PERIODS.find(p => p.label === savedLabel);
    return foundPeriod || PERIODS.find(p => p.label === 'СЕГОДНЯ') || PERIODS[0]; // Улучшение: если нет СЕГОДНЯ, то первый из списка
  }, [pageKey]); 

  const getInitialCustomPeriod = useCallback(() => {
    const savedFrom = localStorage.getItem(`${pageKey}_customFrom`);
    const savedTo = localStorage.getItem(`${pageKey}_customTo`);
    const defaultPreset = getInitialPeriodPreset();
    let defaultRange = defaultPreset.getRange();
    
    // Если getRange вернул [null, null] (для "ВАШ ПЕРИОД" без сохраненных дат), 
    // установим дефолтом сегодняшний день
    if (!defaultRange[0] || !defaultRange[1]) {
        const todayPreset = PERIODS.find(p => p.label === 'СЕГОДНЯ') || PERIODS[0];
        defaultRange = todayPreset.getRange();
    }

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
      const custom = getInitialCustomPeriod(); // getInitialCustomPeriod уже содержит логику для дефолтных дат
      if (custom.from && custom.to) {
        const fromDate = new Date(custom.from); fromDate.setHours(0,0,0,0);
        const toDate = new Date(custom.to); toDate.setHours(23,59,59,999);
        return [fromDate, toDate];
      } 
      // Если custom.from или custom.to все еще пустые, getInitialCustomPeriod должен был вернуть валидные даты (например, сегодня)
      // Но на всякий случай, если что-то пошло не так, вернем диапазон "СЕГОДНЯ"
      const todayPreset = PERIODS.find(p => p.label === 'СЕГОДНЯ') || PERIODS[0];
      return todayPreset.getRange();
    }
    return initialPreset.getRange();
  });

  useEffect(() => {
    localStorage.setItem(`${pageKey}_periodLabel`, currentPeriodPreset.label);
    // Сохраняем кастомные даты только если выбран "ВАШ ПЕРИОД"
    if (currentPeriodPreset.label === 'ВАШ ПЕРИОД') {
        localStorage.setItem(`${pageKey}_customFrom`, userInputCustomPeriod.from);
        localStorage.setItem(`${pageKey}_customTo`, userInputCustomPeriod.to);
    } else {
      // Очищаем кастомные даты, если выбран другой пресет, чтобы при следующем выборе "ВАШ ПЕРИОД" они не подтянулись
      localStorage.removeItem(`${pageKey}_customFrom`);
      localStorage.removeItem(`${pageKey}_customTo`);
    }
  }, [currentPeriodPreset, userInputCustomPeriod, pageKey]);

  const { stats, statsLoading, coffeeStats, coffeeLoading, error: statsError } = useStatsPolling(currentPeriodRange);

  const handlePeriodPresetChange = (p) => {
    setCurrentPeriodPreset(p);
    if (p.label === 'ВАШ ПЕРИОД') {
      let from = userInputCustomPeriod.from;
      let to = userInputCustomPeriod.to;

      if (!from || !to) { // Если кастомные даты пусты, ставим сегодняшний день
        const todayRange = PERIODS.find(period => period.label === 'СЕГОДНЯ').getRange();
        from = formatDateForInput(todayRange[0]);
        to = formatDateForInput(todayRange[1]);
        setUserInputCustomPeriod({ from, to }); // Обновляем состояние инпутов
      }
      
      const fromDate = new Date(from); fromDate.setHours(0,0,0,0);
      const toDate = new Date(to); toDate.setHours(23,59,59,999);
      setCurrentPeriodRange([fromDate, toDate]);

    } else {
      const newRange = p.getRange();
      setCurrentPeriodRange(newRange);
      // Обновляем и userInputCustomPeriod, чтобы поля дат тоже отражали выбранный пресет
      setUserInputCustomPeriod({
        from: formatDateForInput(newRange[0]),
        to: formatDateForInput(newRange[1]),
      });
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

  // Даты для отображения в инпутах
  // Если выбран пресет, показываем даты пресета. Если "ВАШ ПЕРИОД", показываем то, что ввел пользователь.
  const displayDateFrom = currentPeriodPreset.label === 'ВАШ ПЕРИОД' 
    ? userInputCustomPeriod.from 
    : (currentPeriodRange[0] ? formatDateForInput(currentPeriodRange[0]) : '');
  const displayDateTo = currentPeriodPreset.label === 'ВАШ ПЕРИОД' 
    ? userInputCustomPeriod.to 
    : (currentPeriodRange[1] ? formatDateForInput(currentPeriodRange[1]) : '');


  const revenue = stats.revenue || 0;
  const salesCount = stats.salesCount || 0;
  const expensesSum = stats.expensesSum || 0;

  // Получаем данные пользователя из localStorage
  const storedTaxSystem = localStorage.getItem('tax_system');
  const storedAcquiringRate = localStorage.getItem('acquiring_rate') || '0'; // "1.6"

  let userTaxRateDisplay = 0; // Для отображения (6% или 15%)
  let actualTaxCalculationRate = 0.00; // Для расчета (0.06 или 0.15)

  if (storedTaxSystem === 'income_6') {
    userTaxRateDisplay = 6;
    actualTaxCalculationRate = 0.06;
  } else if (storedTaxSystem === 'income_expense_15') {
    userTaxRateDisplay = 15;
    actualTaxCalculationRate = 0.15; // Ставка для Доходы-Расходы
  }

  const userAcquiringRateDisplay = parseFloat(storedAcquiringRate); // 1.6
  const actualAcquiringCalculationRate = userAcquiringRateDisplay / 100; // 0.016

  let taxBase = revenue;
  if (storedTaxSystem === 'income_expense_15') {
    taxBase = Math.max(0, revenue - expensesSum); // Налог от (Выручка - Расходы)
  }

  const taxes = +(taxBase * actualTaxCalculationRate).toFixed(2);
  const acquiring = +(revenue * actualAcquiringCalculationRate).toFixed(2);
  const netProfit = +(revenue - expensesSum - taxes - acquiring).toFixed(2);
  const margin = revenue ? (netProfit / revenue * 100).toFixed(1) : 0;

  return (
    <div className="page-container">
      <div className="main-content-area">
        <div style={{ background: '#23272f', padding: '18px', borderRadius: '14px', marginBottom: '24px' }}>
            <h4 style={{marginTop: 0, marginBottom: '15px', color: '#8ae6ff', fontSize: '1.1em'}}>
                Показатели за период: <span style={{color: '#ffffff', fontWeight: 'bold'}}>{currentPeriodPreset.label}</span>
            </h4>
            {statsError && <p style={{color: 'salmon'}}>Ошибка загрузки статистики: {statsError}</p>}
            {statsLoading ? ( <p style={{color: '#888'}}>Загрузка показателей...</p> ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.95em' /* Чуть меньше для компактности */}}>
            <tbody>
                <tr><td style={{...cellStyle, fontWeight: 500}}>Продажи</td><td style={valueCellStyle}>{salesCount} шт.</td></tr>
                <tr><td style={{...cellStyle, fontWeight: 500}}>Выручка</td><td style={{ ...valueCellStyle, color: '#ffb300', fontWeight: 'bold' }}>{revenue.toLocaleString('ru-RU', {minimumFractionDigits: 2, maximumFractionDigits: 2})} ₽</td></tr>
                <tr><td style={{...cellStyle, fontWeight: 500}}>Расходы</td><td style={valueCellStyle}>{expensesSum.toLocaleString('ru-RU', {minimumFractionDigits: 2, maximumFractionDigits: 2})} ₽</td></tr>
                <tr>
                  <td style={{...cellStyle, fontWeight: 500}}>
                    Налоги ({storedTaxSystem === 'income_expense_15' ? `${userTaxRateDisplay}% от (Д-Р)` : `${userTaxRateDisplay}%`})
                  </td>
                  <td style={valueCellStyle}>{taxes.toLocaleString('ru-RU', {minimumFractionDigits: 2, maximumFractionDigits: 2})} ₽</td>
                </tr>
                <tr>
                  <td style={{...cellStyle, fontWeight: 500}}>
                    Эквайринг ({userAcquiringRateDisplay.toFixed(1)}%)
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

        {/* Таблица Статистики Кофеен */}
        <div> {/* Обертка для таблицы кофеен, чтобы заголовок был вместе с ней */}
            <h4 style={{color: '#8ae6ff', fontSize: '1.0em', marginBottom: '10px' }}>Статистика Кофеен</h4>
            {statsError && <p style={{color: 'salmon'}}>Ошибка загрузки статистики по кофейням.</p>}
            <div style={{maxHeight: '400px', overflowY: 'auto'}}>
                <table style={{ width: '100%', borderCollapse: 'collapse', background: '#23272f', borderRadius: 12, overflow: 'hidden' }}>
                <thead>
                    {/* Используем baseHeaderCellStyle для заголовков */}
                    <tr style={{ background: '#1f2330', color: '#8ae6ff', position: 'sticky', top: 0, zIndex: 1 }}>
                    <th style={baseHeaderCellStyle}>Кофейня</th>
                    <th style={{...baseHeaderCellStyle, textAlign: 'right'}}>Выручка</th>
                    <th style={{...baseHeaderCellStyle, textAlign: 'right'}}>Продажи</th>
                    </tr>
                </thead>
                <tbody>
                    {coffeeLoading ? (
                    <tr><td colSpan={3} style={{ ...cellStyle, color: '#888', padding: 20, textAlign: 'center' }}>Загрузка кофеен...</td></tr>
                    ) : !coffeeStats || coffeeStats.length === 0 ? (
                    <tr><td colSpan={3} style={{ ...cellStyle, color: '#888', padding: 20, textAlign: 'center' }}>Нет данных по кофейням за период</td></tr>
                    ) : (
                    coffeeStats.map((row, idx) => (
                        <tr key={row.coffee_shop_id || idx} style={{ background: idx % 2 ? '#262a36' : '#23273a', borderBottom: '1px solid #303548' }}>
                        <td style={{...cellStyle, color: '#c6c6c6', borderBottom: 'none'}}>{row.name || `Кофейня ${row.coffee_shop_id}`}</td>
                        <td style={{...valueCellStyle, borderBottom: 'none'}}>{Number(row.revenue).toLocaleString('ru-RU', {minimumFractionDigits: 2, maximumFractionDigits: 2})} ₽</td>
                        <td style={{...valueCellStyle, borderBottom: 'none'}}>{row.sales_count}</td>
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
            <div className="date-input-item"> {/* Обертка для первой пары */}
                <label htmlFor="finances_from_date_page">Начало периода:</label>
                <input
                    id="finances_from_date_page" type="date" value={displayDateFrom}
                    onChange={e => handleCustomDateChange('from', e.target.value)}
                    disabled={currentPeriodPreset.label !== 'ВАШ ПЕРИОД'}
                    className="period-date-input"
                />
            </div>
            <div className="date-input-item"> {/* Обертка для второй пары */}
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