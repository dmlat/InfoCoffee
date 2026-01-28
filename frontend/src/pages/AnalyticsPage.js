// frontend/src/pages/AnalyticsPage.js
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import api from '../api';
import { PERIODS, formatDateForInput } from '../constants';
import './AnalyticsPage.css';
import '../components/ModalFrame.css';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LabelList
} from 'recharts';

const PAGE_KEY = 'analyticsPage_v1';

const splitLabel = (text, maxLen = 10) => {
  if (!text) return [''];
  
  // 1. Заменяем тире на пробел для упрощения переноса по словам
  const cleanText = text.replace(/-/g, ' ');
  const words = cleanText.split(/\s+/);
  const lines = [];
  let currentLine = '';

  words.forEach((word) => {
    if (!word) return;
    
    // Если слово само по себе длиннее лимита, разбиваем его принудительно
    if (word.length > maxLen) {
      if (currentLine) {
        lines.push(currentLine);
        currentLine = '';
      }
      for (let i = 0; i < word.length; i += maxLen) {
        lines.push(word.slice(i, i + maxLen));
      }
      return;
    }

    // Проверяем, влезет ли слово в текущую строку с учетом пробела
    const space = currentLine ? ' ' : '';
    if ((currentLine.length + space.length + word.length) <= maxLen) {
      currentLine += space + word;
    } else {
      // Не влезло — сохраняем текущую строку и начинаем новую
      if (currentLine) lines.push(currentLine);
      currentLine = word;
    }
  });

  if (currentLine) lines.push(currentLine);
  return lines;
};

export default function AnalyticsPage() {
  const getTodayRange = useCallback(() => {
    return (PERIODS.find(p => p.label === 'СЕГОДНЯ') || PERIODS[0]).getRange();
  }, []);

  const getInitialPeriodPreset = useCallback(() => {
    const savedLabel = localStorage.getItem(`${PAGE_KEY}_periodLabel`);
    const foundPeriod = PERIODS.find(p => p.label === savedLabel);
    return foundPeriod || PERIODS.find(p => p.label === 'СЕГОДНЯ') || PERIODS[0];
  }, []);

  const getInitialUserCustomPeriod = useCallback(() => {
    const savedFrom = localStorage.getItem(`${PAGE_KEY}_userCustomFrom`);
    const savedTo = localStorage.getItem(`${PAGE_KEY}_userCustomTo`);
    if (savedFrom && savedTo) {
      return { from: savedFrom, to: savedTo };
    }
    const todayRange = getTodayRange();
    return { from: formatDateForInput(todayRange[0]), to: formatDateForInput(todayRange[1]) };
  }, [getTodayRange]);

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

  const [terminals, setTerminals] = useState([]);
  const [selectedTerminalIds, setSelectedTerminalIds] = useState(() => {
    try {
      const saved = localStorage.getItem(`${PAGE_KEY}_terminalIds`);
      return saved ? JSON.parse(saved) : [];
    } catch (e) {
      return [];
    }
  });
  const [isTerminalModalOpen, setIsTerminalModalOpen] = useState(false);
  const [isChartExpanded, setIsChartExpanded] = useState(() => {
    const saved = localStorage.getItem(`${PAGE_KEY}_isChartExpanded`);
    return saved !== null ? saved === 'true' : true;
  });

  const [salesData, setSalesData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    localStorage.setItem(`${PAGE_KEY}_periodLabel`, currentPeriodPreset.label);
    localStorage.setItem(`${PAGE_KEY}_userCustomFrom`, userCustomPeriodSelection.from);
    localStorage.setItem(`${PAGE_KEY}_userCustomTo`, userCustomPeriodSelection.to);
  }, [currentPeriodPreset, userCustomPeriodSelection]);

  useEffect(() => {
    localStorage.setItem(`${PAGE_KEY}_isChartExpanded`, isChartExpanded);
  }, [isChartExpanded]);

  useEffect(() => {
    localStorage.setItem(`${PAGE_KEY}_terminalIds`, JSON.stringify(selectedTerminalIds));
  }, [selectedTerminalIds]);

  const fetchTerminals = useCallback(async () => {
    try {
      const res = await api.get('/terminals');
      if (res.data.success && Array.isArray(res.data.terminals)) {
        setTerminals(res.data.terminals);
      } else {
        setTerminals([]);
      }
    } catch (err) {
      console.error('Failed to load terminals', err);
      setTerminals([]);
    }
  }, []);

  useEffect(() => {
    fetchTerminals();
  }, [fetchTerminals]);

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
      }
    }
  };

  const fetchSales = useCallback(async () => {
    if (!apiPeriod?.dateFrom || !apiPeriod?.dateTo) return;
    setLoading(true);
    setError('');
    try {
      const params = {
        from: apiPeriod.dateFrom,
        to: apiPeriod.dateTo,
        terminal_ids: selectedTerminalIds.length > 0 ? selectedTerminalIds.join(',') : undefined
      };
      const res = await api.get('/analytics/sales', { params });
      const rows = Array.isArray(res.data.salesData) ? res.data.salesData : [];
      
      const mappedRows = rows.map(row => {
        const isUnknown = row.product_name && row.product_name.startsWith('Unknown Product');
        return {
          ...row,
          product_name: isUnknown ? 'Без названия' : row.product_name,
          isUnknown: isUnknown,
          count: Number(row.count) || 0,
          revenue: Number(row.revenue) || 0
        };
      });
      
      setSalesData(mappedRows);
    } catch (err) {
      console.error('Failed to load analytics sales data', err);
      setSalesData([]);
      setError('Ошибка загрузки данных');
    } finally {
      setLoading(false);
    }
  }, [apiPeriod, selectedTerminalIds]);

  useEffect(() => {
    fetchSales();
  }, [fetchSales]);

  const toggleTerminal = (id) => {
    setSelectedTerminalIds(prev => {
      if (prev.length === 0) return [id];
      if (prev.includes(id)) return prev.filter(item => item !== id);
      return [...prev, id];
    });
  };

  const setAllTerminals = () => setSelectedTerminalIds([]);

  const selectionLabel = useMemo(() => {
    if (selectedTerminalIds.length === 0) return 'Вся сеть';
    if (selectedTerminalIds.length === 1) {
      const found = terminals.find(t => t.id === selectedTerminalIds[0]);
      return found?.name || '1 стойка';
    }
    return `Выбрано: ${selectedTerminalIds.length}`;
  }, [selectedTerminalIds, terminals]);

  const chartHeight = Math.max(300, salesData.length * 45);

  return (
    <div className="page-container analytics-page">
      <div className="sidebar-area">
        <div className="date-inputs-container">
          <div className="date-input-item">
            <label htmlFor="analytics_from_date">Начало:</label>
            <input
              id="analytics_from_date"
              type="date"
              value={displayDatesInInputs.from}
              onChange={e => handleCustomDateChange('from', e.target.value)}
              disabled={currentPeriodPreset.label !== 'ВАШ ПЕРИОД'}
              className="period-date-input"
            />
          </div>
          <div className="date-input-item">
            <label htmlFor="analytics_to_date">Конец:</label>
            <input
              id="analytics_to_date"
              type="date"
              value={displayDatesInInputs.to}
              onChange={e => handleCustomDateChange('to', e.target.value)}
              disabled={currentPeriodPreset.label !== 'ВАШ ПЕРИОД'}
              className="period-date-input"
            />
          </div>
        </div>
        <div className="period-buttons-container">
          {PERIODS.map(p => (
            <button
              key={p.label}
              className={`period-btn ${currentPeriodPreset.label === p.label ? 'active' : ''}`}
              onClick={() => handlePeriodPresetChange(p)}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="terminal-selector-area">
          <span className="terminal-selector-label">Выберите стойки:</span>
          <button className="terminal-selector-button" type="button" onClick={() => setIsTerminalModalOpen(true)}>
            {selectionLabel}
          </button>
        </div>
      </div>

      <div className="main-content-area">
        <div className="summary-card analytics-drinks-card">
          <div className="analytics-card-header" onClick={() => setIsChartExpanded(!isChartExpanded)} style={{ cursor: 'pointer' }}>
            <button 
              className={`chart-toggle-btn ${!isChartExpanded ? 'collapsed' : ''}`}
              type="button"
              title={isChartExpanded ? "Свернуть" : "Развернуть"}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="6 9 12 15 18 9"></polyline>
              </svg>
            </button>
            <h4 className="summary-card-title">Продано напитков</h4>
          </div>
          
          <div className={`chart-expandable-content ${!isChartExpanded ? 'collapsed' : ''}`}>
            {error && <p className="error-message">{error}</p>}
            {loading && salesData.length === 0 && !error && <p className="loading-message">Загрузка продаж...</p>}
            {!loading && !error && salesData.length === 0 && (
              <p className="empty-data-message">Нет данных за период</p>
            )}
            {salesData.length > 0 && (
              <div className={`analytics-custom-grid ${loading ? 'chart-loading' : ''}`}>
                <div className="analytics-grid-header">
                  <div className="header-col-name">
                    <span className="total-badge">Всего</span>
                  </div>
                  <div className="header-col-chart">
                    <span className="total-badge">{salesData.reduce((sum, item) => sum + item.count, 0)} шт.</span>
                  </div>
                  <div className="header-col-revenue">
                    <span className="total-badge">{(salesData.reduce((sum, item) => sum + item.revenue, 0) / 100).toLocaleString()} ₽</span>
                  </div>
                </div>
                {salesData.map((item, index) => {
                   const isFree = item.product_name === 'Бесплатные напитки';
                   const totalSales = salesData.reduce((sum, i) => sum + i.count, 0);
                   const percentage = totalSales > 0 ? ((item.count / totalSales) * 100).toFixed(1) : 0;
                   return (
                  <div key={index} className="analytics-grid-row">
                    <div className="grid-col-name">
                      <div className={`drink-name ${item.isUnknown ? 'unknown' : ''} ${isFree ? 'free' : ''}`}>
                        {splitLabel(item.product_name, 10).map((line, i) => (
                          <div key={i}>{line}</div>
                        ))}
                      </div>
                    </div>
                    <div className="grid-col-chart">
                      <div className="bar-wrapper">
                        <div 
                          className="bar-fill" 
                          style={{ 
                            width: `${(item.count / Math.max(...salesData.map(d => d.count))) * 100}%`,
                            animationDuration: '0.8s'
                          }}
                        >
                        </div>
                        <span className="bar-label">{item.count} шт. / {percentage}%</span>
                      </div>
                    </div>
                    <div className="grid-col-revenue">
                      <span className="revenue-text">{(item.revenue / 100).toLocaleString()} ₽</span>
                    </div>
                  </div>
                )})}
              </div>
            )}
          </div>
        </div>
      </div>

      {isTerminalModalOpen && (
        <div className="modal-overlay" onClick={() => setIsTerminalModalOpen(false)}>
          <div className="modal-content analytics-terminal-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">Выбор стоек</h2>
              <button type="button" className="modal-close-btn" onClick={() => setIsTerminalModalOpen(false)}>&times;</button>
            </div>
            <div className="modal-body">
              <div className="terminal-option all-terminals" onClick={setAllTerminals}>
                <input type="checkbox" checked={selectedTerminalIds.length === 0} readOnly />
                <span>Вся сеть</span>
              </div>
              <div className="terminal-options-list">
                {terminals.length === 0 && <div className="empty-data-message">Нет доступных стоек</div>}
                {terminals.map(terminal => (
                  <label key={terminal.id} className="terminal-option">
                    <input
                      type="checkbox"
                      checked={selectedTerminalIds.length === 0 ? false : selectedTerminalIds.includes(terminal.id)}
                      onChange={() => toggleTerminal(terminal.id)}
                    />
                    <span>{terminal.name || `Стойка #${terminal.id}`}</span>
                  </label>
                ))}
              </div>
              <div className="modal-actions">
                <button type="button" className="action-btn" onClick={() => setIsTerminalModalOpen(false)}>Готово</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
