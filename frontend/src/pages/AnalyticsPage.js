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

  const topProducts = useMemo(() => {
    const productMap = {};
    salesData.forEach(item => {
      const id = item.machine_item_id;
      // Если имя пустое или Unknown, пробуем найти нормальное
      const cleanName = (item.product_name && !item.product_name.startsWith('Unknown')) ? item.product_name : null;
      
      if (!productMap[id]) {
        productMap[id] = { 
          name: cleanName || item.product_name || `Товар #${id}`, 
          count: 0, 
          revenue: 0 
        };
      } else if (cleanName && (!productMap[id].name || productMap[id].name.startsWith('Unknown') || productMap[id].name.startsWith('Товар #'))) {
        // Обновляем имя, если нашли более качественное
        productMap[id].name = cleanName;
      }
      
      productMap[id].count += Number(item.count) || 0;
      productMap[id].revenue += Number(item.revenue) || 0;
    });
    return Object.values(productMap)
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
  }, [salesData]);

  const topTerminals = useMemo(() => {
    const termMap = {};
    salesData.forEach(item => {
      const id = item.coffee_shop_id;
      if (!id) return;
      if (!termMap[id]) {
        termMap[id] = { name: item.terminal_name || `Стойка ${id}`, revenue: 0 };
      }
      termMap[id].revenue += Number(item.revenue) || 0;
    });
    return Object.values(termMap)
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5);
  }, [salesData]);

  const chartData = useMemo(() => {
    const productMap = {};
    salesData.forEach(item => {
      const id = item.machine_item_id;
      const cleanName = (item.product_name && !item.product_name.startsWith('Unknown')) ? item.product_name : null;

      if (!productMap[id]) {
        productMap[id] = { product_name: cleanName || item.product_name || `Товар #${id}`, count: 0 };
      } else if (cleanName && (!productMap[id].product_name || productMap[id].product_name.startsWith('Unknown') || productMap[id].product_name.startsWith('Товар #'))) {
        productMap[id].product_name = cleanName;
      }
      productMap[id].count += Number(item.count) || 0;
    });
    return Object.values(productMap).sort((a, b) => b.count - a.count);
  }, [salesData]);

  const chartHeight = Math.max(300, chartData.length * 45);

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
      console.log('Analytics Sales Data:', res.data); // Добавим лог для проверки структуры
      const rows = Array.isArray(res.data.salesData) ? res.data.salesData : [];
      setSalesData(rows.map(row => ({
        ...row,
        count: Number(row.count) || 0
      })));
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
        {salesData.length > 0 && (
          <div className="summary-card">
            <div className="analytics-top-summary">
              <div className="top-summary-column">
                <div className="top-summary-title">Топ 5 позиций:</div>
                <ul className="top-summary-list">
                  {topProducts.map((p, i) => (
                    <li key={i}>
                      <span className="item-name" title={p.name}>{p.name}</span>
                      <span className="item-value">
                        <span className="value-count">{p.count} шт.</span>
                        <span className="value-separator">|</span>
                        <span className="value-revenue">{(p.revenue / 100).toLocaleString()} ₽</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="top-summary-column">
                <div className="top-summary-title">Топ 5 стоек:</div>
                <ul className="top-summary-list">
                  {topTerminals.map((t, i) => (
                    <li key={i}>
                      <span className="item-name" title={t.name}>{t.name}</span>
                      <span className="item-value">{(t.revenue / 100).toLocaleString()} ₽</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        )}

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
              <div className={`chart-container ${loading ? 'chart-loading' : ''}`}>
              <ResponsiveContainer width="100%" height={chartHeight}>
                <BarChart
                  data={chartData}
                  layout="vertical"
                    margin={{ top: 10, right: 40, left: -20, bottom: 20 }}
                    barSize={24}
                  >
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#353a40" />
                    <XAxis type="number" stroke="#ccc" fontSize={11} />
                    <YAxis
                      dataKey="product_name"
                      type="category"
                      width={100}
                      stroke="#ccc"
                      fontSize={10}
                      tick={(props) => {
                        const { x, y, payload } = props;
                        const lines = splitLabel(payload.value, 10);
                        return (
                          <g transform={`translate(${x},${y})`} className="y-axis-tick">
                            <text x={-10} y={0} textAnchor="end" fill="#a0b0c8" fontSize={10}>
                              {lines.map((line, i) => (
                                <tspan key={i} x={-10} dy={i === 0 ? -((lines.length - 1) * 6) : 12}>
                                  {line}
                                </tspan>
                              ))}
                            </text>
                          </g>
                        );
                      }}
                    />
                    <Tooltip
                      cursor={{fill: 'rgba(255,255,255,0.05)'}}
                      contentStyle={{ backgroundColor: '#282c34', border: '1px solid #3a3e47', borderRadius: '8px' }}
                      itemStyle={{ color: '#8ae6ff' }}
                    />
                    <Bar
                      dataKey="count"
                      fill="#4f81c7"
                      radius={[0, 4, 4, 0]}
                      isAnimationActive={true}
                      animationDuration={400}
                      animationEasing="ease-out"
                    >
                      <LabelList dataKey="count" position="right" fill="#fff" fontSize={11} offset={8} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
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
