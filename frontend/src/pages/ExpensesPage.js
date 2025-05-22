// src/pages/ExpensesPage.js
import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { PERIODS, formatDateForInput } from '../constants'; // Убедитесь, что PERIODS здесь те, что нужны для расходов
import ConfirmModal from '../components/ConfirmModal';

// Стили (можно вынести в CSS)
const pageContainerStyle = { display: 'flex', gap: '24px', alignItems: 'flex-start' };
const mainContentAreaStyle = { flex: 3 }; // Область для формы и таблицы
const sidebarAreaStyle = { flex: 1, minWidth: '220px', maxWidth: '260px' }; // Сайдбар для периодов

const formElementStyle = {
  padding: '8px 10px', 
  borderRadius: '6px',
  background: '#2e3340',
  border: '1px solid #303548',
  color: '#c6c6c6',
  fontSize: '0.95em',
  height: '38px', 
  boxSizing: 'border-box'
};

const formLabelStyle = {
  fontSize: '0.9em', 
  color: '#a0a0a0', 
  marginBottom: '3px',
  display: 'block'
};

const cellStyle = { padding: '8px 12px', borderBottom: '1px solid #2a2e37', color: '#c6c6c6' };
const headerCellStyle = { ...cellStyle, color: '#8ae6ff', fontWeight: '600', textAlign: 'left', position: 'sticky', top: 0, background: '#1f2330', zIndex: 1 };

export default function ExpensesPage() {
  const pageKey = 'expensesPage_v1_autonomous'; // Уникальный ключ для localStorage
  const token = localStorage.getItem('token');
  const todayISO = formatDateForInput(new Date());

  // --- Логика управления периодом (аналогично FinancesPage) ---
  const getInitialPeriodPreset = useCallback(() => {
    const savedLabel = localStorage.getItem(`${pageKey}_periodLabel`);
    const foundPeriod = PERIODS.find(p => p.label === savedLabel);
    return foundPeriod || PERIODS[0]; // По умолчанию первый период из констант
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

  const handlePeriodPresetChange = (p) => {
    setCurrentPeriodPreset(p);
    if (p.label === 'ВАШ ПЕРИОД') {
      if (userInputCustomPeriod.from && userInputCustomPeriod.to) {
        const fromDate = new Date(userInputCustomPeriod.from); fromDate.setHours(0,0,0,0);
        const toDate = new Date(userInputCustomPeriod.to); toDate.setHours(23,59,59,999);
        setCurrentPeriodRange([fromDate, toDate]);
      } else {
        // Если одна из дат "ВАШ ПЕРИОД" не задана, можно установить null или текущие даты
        setCurrentPeriodRange([
            userInputCustomPeriod.from ? new Date(userInputCustomPeriod.from) : null,
            userInputCustomPeriod.to ? new Date(userInputCustomPeriod.to) : null
        ]);
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
    } else if (currentPeriodPreset.label === 'ВАШ ПЕРИОД') {
        // Обновляем диапазон даже если одна из дат не полная, для useStatsPolling
         setCurrentPeriodRange([
            updatedInput.from ? new Date(updatedInput.from) : null,
            updatedInput.to ? new Date(updatedInput.to) : null
        ]);
    }
  };
  
  const displayDateFrom = currentPeriodPreset.label === 'ВАШ ПЕРИОД' ? userInputCustomPeriod.from : formatDateForInput(currentPeriodRange[0]);
  const displayDateTo = currentPeriodPreset.label === 'ВАШ ПЕРИОД' ? userInputCustomPeriod.to : formatDateForInput(currentPeriodRange[1]);

  // --- Логика для расходов (из "серверной" и "локальной" версий) ---
  const [expenses, setExpenses] = useState([]);
  const [eForm, setEForm] = useState({ amount: '', expense_time: todayISO, comment: '' });
  const [error, setError] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [expenseToDeleteId, setExpenseToDeleteId] = useState(null);

  // Загрузка расходов
  useEffect(() => {
    const fetchExpenses = async () => {
      if (!token) {
        setError('Пользователь не авторизован');
        return;
      }
      try {
        setError('');
        const eRes = await axios.get('/api/expenses', { headers: { Authorization: `Bearer ${token}` } });
        setExpenses(eRes.data.expenses.sort((a, b) => new Date(b.expense_time) - new Date(a.expense_time)));
      } catch (err) {
        setError('Ошибка загрузки расходов');
        console.error("Fetch expenses error:", err);
      }
    };
    fetchExpenses();
  }, [token]);

  // Фильтрация расходов на клиенте по currentPeriodRange
  const filteredExpenses = expenses.filter(e => {
    if (!currentPeriodRange || !currentPeriodRange[0] || !currentPeriodRange[1]) {
        // Если currentPeriodRange не установлен полностью (например, "ВАШ ПЕРИОД" без дат), не фильтруем или показываем все
        // В данном случае, для "ВАШ ПЕРИОД" без дат, useStatsPolling получит [null, null], что может означать "все данные"
        // Здесь на клиенте, если диапазон не полный, можно показывать все или ничего, в зависимости от логики.
        // Если "ВАШ ПЕРИОД" и даты не введены, currentPeriodRange будет [null,null] или [Date, null] и т.д.
        // Покажем все, если диапазон не полный.
        const fromOk = !currentPeriodRange[0] || (new Date(e.expense_time).setHours(0,0,0,0) >= new Date(currentPeriodRange[0]).setHours(0,0,0,0));
        const toOk = !currentPeriodRange[1] || (new Date(e.expense_time).setHours(23,59,59,999) <= new Date(currentPeriodRange[1]).setHours(23,59,59,999));
        return fromOk && toOk;
    }
    const expenseDate = new Date(e.expense_time);
    expenseDate.setHours(0,0,0,0); // Для сравнения только дат
    const ts = expenseDate.getTime();
    
    const fromTime = new Date(currentPeriodRange[0]).getTime();
    const toTime = new Date(currentPeriodRange[1]).getTime();
    
    return ts >= fromTime && ts <= toTime;
  });

  const handleEFormChange = event => setEForm({ ...eForm, [event.target.name]: event.target.value });

  const handleAddExpense = async (event) => {
    event.preventDefault();
    setError('');
    const payload = {
      ...eForm,
      expense_time: eForm.expense_time || todayISO,
      comment: eForm.comment || '',
      amount: parseFloat(eForm.amount)
    };

    if (isNaN(payload.amount) || payload.amount <= 0) {
      setError('Сумма должна быть числом > 0.');
      return;
    }

    try {
      const response = await axios.post('/api/expenses', payload, { headers: { Authorization: `Bearer ${token}` } });
      // Предполагаем, что API возвращает созданный расход с id
      const newExpense = response.data.expense || { ...payload, id: response.data.id || Date.now() }; // Адаптируйте под ваш API ответ
      setExpenses(prev => [newExpense, ...prev].sort((a, b) => new Date(b.expense_time) - new Date(a.expense_time)));
      setEForm({ amount: '', expense_time: todayISO, comment: '' });
    } catch (err) {
      setError('Ошибка добавления расхода. ' + (err.response?.data?.message || err.message));
      console.error("Add expense error:", err);
    }
  };

  const handleDeleteAttempt = (id) => {
    setExpenseToDeleteId(id);
    setIsModalOpen(true);
  };

  const confirmDeleteExpense = async () => {
    if (expenseToDeleteId === null) return;
    setError('');
    try {
      await axios.delete(`/api/expenses/${expenseToDeleteId}`, { headers: { Authorization: `Bearer ${token}` } });
      setExpenses(prevExpenses => prevExpenses.filter(e => e.id !== expenseToDeleteId));
      setIsModalOpen(false);
      setExpenseToDeleteId(null);
    } catch (err) {
      setError('Ошибка удаления расхода. ' + (err.response?.data?.message || err.message));
      console.error("Delete expense error:", err);
      setIsModalOpen(false);
      setExpenseToDeleteId(null);
    }
  };

  const cancelDeleteExpense = () => {
    setIsModalOpen(false);
    setExpenseToDeleteId(null);
  };

  const expensesSum = filteredExpenses.reduce((s, e) => s + Number(e.amount), 0);

  return (
    <>
      <ConfirmModal
        isOpen={isModalOpen}
        message="Удалить расход?"
        onConfirm={confirmDeleteExpense}
        onCancel={cancelDeleteExpense}
      />
      <div style={pageContainerStyle} className="expenses-page-container"> {/* Общий контейнер страницы */}
        {/* Основная область контента (форма, таблица) */}
        <div style={mainContentAreaStyle} className="expenses-main-content">
          <div style={{ fontSize: 22, fontWeight: 600, marginBottom: 18, color: '#eee' }}>Расходы за период: <span style={{color: '#ffffff'}}>{currentPeriodPreset.label}</span></div>
          
          <form onSubmit={handleAddExpense} style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'flex-end', marginBottom: 24 }}>
            <div>
              <label htmlFor="exp-amount-page" style={formLabelStyle}>Сумма (₽)</label>
              <input id="exp-amount-page" name="amount" value={eForm.amount} onChange={handleEFormChange} placeholder="0.00" type="number" min="0" step="0.01" style={{...formElementStyle, width: '120px' }} required />
            </div>
            <div>
              <label htmlFor="exp-date-page" style={formLabelStyle}>Дата</label>
              <input id="exp-date-page" name="expense_time" value={eForm.expense_time || todayISO} onChange={handleEFormChange} type="date" style={{...formElementStyle, width: '160px' }} required />
            </div>
            <div>
              <label htmlFor="exp-comment-page" style={formLabelStyle}>Категория/Комментарий</label>
              <input id="exp-comment-page" name="comment" value={eForm.comment} onChange={handleEFormChange} placeholder="Например, Аренда" style={{...formElementStyle, width: '220px' }} />
            </div>
            <button type="submit" className="action-btn" style={{...formElementStyle, background: '#3e67e0', color: '#fff', fontWeight: 500, cursor: 'pointer', width: 'auto', paddingLeft: '22px', paddingRight: '22px' }}>
              Добавить
            </button>
          </form>
          
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div style={{ fontSize: 18, fontWeight: 600, color: '#ddd' }}>Список расходов</div>
            <div style={{fontWeight: 500, fontSize: 17, color: '#eee' }}>Итог: <b style={{ color: '#ffb300' }}>{expensesSum.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₽</b></div>
          </div>

          <div style={{maxHeight: '500px', overflowY: 'auto', borderRadius: 12, border: '1px solid #303548'}}>
            <table style={{ width: '100%', borderCollapse: 'collapse', background: '#23272f' }}>
              <thead>
                <tr>
                  <th style={{ ...headerCellStyle, textAlign: 'right', width: '130px'}}>Сумма</th>
                  <th style={{ ...headerCellStyle, width: '120px' }}>Дата</th>
                  <th style={{ ...headerCellStyle }}>Категория/Комментарий</th>
                  <th style={{ ...headerCellStyle, width: '44px' }}></th>
                </tr>
              </thead>
              <tbody>
                {filteredExpenses.map((row, idx) => (
                  <tr key={row.id} style={{ background: idx % 2 ? '#262a36' : '#23273a', borderBottom: '1px solid #303548' }}>
                    <td style={{ ...cellStyle, textAlign: 'right' }}>{Number(row.amount).toLocaleString('ru-RU', {minimumFractionDigits: 2, maximumFractionDigits: 2})} ₽</td>
                    <td style={cellStyle}>{formatDateForInput(new Date(row.expense_time))}</td>
                    <td style={{ ...cellStyle, wordBreak: 'break-word' }}>{row.comment}</td>
                    <td style={{ ...cellStyle, textAlign: 'center', padding: '8px 0' }}><button onClick={() => handleDeleteAttempt(row.id)} className="delete-btn" title="Удалить">🗑</button></td>
                  </tr>
                ))}
                {!filteredExpenses.length && expenses.length > 0 && (<tr><td colSpan={4} style={{ color: '#888', padding: 20, textAlign: 'center' }}>Нет расходов за выбранный период</td></tr>)}
                {expenses.length === 0 && (<tr><td colSpan={4} style={{ color: '#888', padding: 20, textAlign: 'center' }}>Расходов пока нет</td></tr>)}
              </tbody>
            </table>
          </div>
          {error && <div style={{ color: 'salmon', marginTop: 10, textAlign: 'center', width: '100%' }}>{error}</div>}
        </div>

        {/* Сайдбар для выбора периода */}
        <div style={sidebarAreaStyle} className="expenses-sidebar-area">
          <div className="date-inputs-container" style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '16px'}}>
              <label htmlFor="expenses_from_date_page" style={{fontSize: '0.9em', color: '#a0a0a0'}}>Своя дата С:</label>
              <input 
                  id="expenses_from_date_page" type="date" value={displayDateFrom}
                  onChange={e => handleCustomDateChange('from', e.target.value)}
                  disabled={currentPeriodPreset.label !== 'ВАШ ПЕРИОД'}
                  className="period-date-input" // Добавьте CSS класс для общих стилей input[type=date]
                  style={{ ...formElementStyle, width: '100%', opacity: currentPeriodPreset.label !== 'ВАШ ПЕРИОД' ? 0.6 : 1 }}
              />
              <label htmlFor="expenses_to_date_page" style={{fontSize: '0.9em', color: '#a0a0a0', marginTop: '5px'}}>Своя дата ПО:</label>
              <input 
                  id="expenses_to_date_page" type="date" value={displayDateTo}
                  onChange={e => handleCustomDateChange('to', e.target.value)}
                  disabled={currentPeriodPreset.label !== 'ВАШ ПЕРИОД'}
                  className="period-date-input"
                  style={{ ...formElementStyle, width: '100%', opacity: currentPeriodPreset.label !== 'ВАШ ПЕРИОД' ? 0.6 : 1 }}
              />
          </div>
          <div className="period-buttons-container" style={{display: 'flex', flexDirection: 'column', gap: '8px'}}>
            {PERIODS.map(p => (
              <button key={p.label}
                className={currentPeriodPreset.label === p.label ? 'period-btn active' : 'period-btn'}
                // Стили для кнопок периода лучше задавать через CSS классы
                // 'period-btn' и 'period-btn active'
                onClick={() => handlePeriodPresetChange(p)}
              >{p.label}</button>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}