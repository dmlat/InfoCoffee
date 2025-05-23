// src/pages/ExpensesPage.js
import React, { useEffect, useState, useCallback } from 'react';
import axios from 'axios';
import { formatDateForInput } from '../constants';
import ConfirmModal from '../components/ConfirmModal';

// Общие стили для элементов формы, чтобы избежать дублирования в инлайновых стилях
// и чтобы их можно было легко переопределить в index.css при необходимости
const formInputStyleBase = { // Базовый стиль для инпутов в форме
  padding: '8px 10px',
  borderRadius: '6px',
  background: '#2e3340',
  border: '1px solid #303548',
  color: '#c6c6c6',
  fontSize: '0.95em',
  height: '38px', // Совпадает с .period-date-input и .action-btn
  boxSizing: 'border-box',
  width: '100%' // По умолчанию инпут занимает всю ширину своего контейнера
};

const formLabelStyleBase = { // Базовый стиль для лейблов в форме
  fontSize: '0.9em',
  color: '#a0b0c8',
  marginBottom: '4px', // Небольшой отступ под лейблом
  display: 'block',
  textAlign: 'left' // Лейблы по левому краю
};

// Стили для ячеек и заголовков таблицы
const tableCellStyle = {
  padding: '10px 12px', // Немного увеличим паддинг для читаемости
  borderBottom: '1px solid #23272f', // Линия между строками
  // Вертикальные разделители добавим к каждому, кроме последнего
};

const tableHeaderCellStyle = {
  ...tableCellStyle,
  color: '#a0b0c8', // Цвет как у неактивных кнопок периода
  fontWeight: 500,
  textAlign: 'left', // Все заголовки по левому краю
  borderBottom: '1px solid #353a40', // Более заметная линия под заголовками
};

export default function ExpensesPage() {
  const todayISO = formatDateForInput(new Date());

  const [expenses, setExpenses] = useState([]);
  const [eForm, setEForm] = useState({ amount: '', expense_time: todayISO, comment: '' });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [submitError, setSubmitError] = useState('');

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [expenseToDeleteId, setExpenseToDeleteId] = useState(null);

  const fetchExpenses = useCallback(async () => {
    setIsLoading(true);
    setError('');
    try {
      const token = localStorage.getItem('token');
      const res = await axios.get('/api/expenses', {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.data.success) {
        setExpenses(res.data.expenses.sort((a, b) => new Date(b.expense_time) - new Date(a.expense_time) || b.id - a.id));
      } else {
        setError(res.data.error || 'Не удалось загрузить расходы.');
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Ошибка сети при загрузке расходов.');
      console.error("Ошибка загрузки расходов:", err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchExpenses();
  }, [fetchExpenses]);

  const handleEFormChange = e => {
    setEForm({ ...eForm, [e.target.name]: e.target.value });
    if (e.target.name === 'amount' && submitError) {
        setSubmitError('');
    }
  };

  const handleAddExpense = async (e) => {
    e.preventDefault();
    setSubmitError('');

    const amountNum = parseFloat(eForm.amount);
    if (isNaN(amountNum) || amountNum <= 0) {
      setSubmitError('Сумма должна быть положительным числом.');
      return;
    }
    if (!eForm.expense_time) {
        setSubmitError('Дата расхода обязательна.');
        return;
    }

    const payload = {
      amount: amountNum,
      expense_time: eForm.expense_time,
      comment: eForm.comment.trim() || '',
    };

    try {
      const token = localStorage.getItem('token');
      const res = await axios.post('/api/expenses', payload, {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (res.data.success && res.data.expense) {
        setExpenses(prev => [res.data.expense, ...prev].sort((a,b) => new Date(b.expense_time) - new Date(a.expense_time) || b.id - a.id));
        setEForm({ amount: '', expense_time: todayISO, comment: '' });
      } else {
        setSubmitError(res.data.error || 'Не удалось добавить расход.');
      }
    } catch (err) {
      setSubmitError(err.response?.data?.error || 'Ошибка сети при добавлении расхода.');
      console.error("Ошибка добавления расхода:", err);
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
      const token = localStorage.getItem('token');
      const res = await axios.delete(`/api/expenses/${expenseToDeleteId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.data.success) {
        setExpenses(prevExpenses => prevExpenses.filter(e => e.id !== expenseToDeleteId));
      } else {
        setError(res.data.error || 'Не удалось удалить расход.');
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Ошибка сети при удалении расхода.');
      console.error("Ошибка удаления расхода:", err);
    } finally {
      setIsModalOpen(false);
      setExpenseToDeleteId(null);
    }
  };

  const cancelDeleteExpense = () => {
    setIsModalOpen(false);
    setExpenseToDeleteId(null);
  };

  // Стиль для колонок с разделителем справа (кроме последней)
  const cellWithBorder = { ...tableCellStyle, borderRight: '1px solid #23272f' };
  const headerCellWithBorder = { ...tableHeaderCellStyle, borderRight: '1px solid #23272f' };


  return (
    <>
      <ConfirmModal
        isOpen={isModalOpen}
        message="Вы уверены, что хотите удалить этот расход?"
        onConfirm={confirmDeleteExpense}
        onCancel={cancelDeleteExpense}
        confirmText="Удалить"
        cancelText="Отмена"
      />
      {/* Этот div теперь использует классы из index.css, если ты хочешь 
        двухколоночный макет с сайдбаром на десктопе, как у FinancesPage.
        Если нужен простой одноколоночный макет, как было, то можно оставить 
        инлайновые maxWidth и margin: '0 auto'.
        Я верну .page-container и .main-content-area для консистентности.
        Если сайдбар для расходов не нужен, его можно просто не рендерить.
      */}
      <div className="page-container" style={{flexDirection: 'column'}}> {/* Заставим быть одной колонкой всегда для Expenses */}
        <div className="main-content-area" style={{width: '100%'}}> {/* Займет всю ширину */}
          <h2 style={{ marginBottom: '20px', color: '#eee' }}>Учет расходов</h2>

          <form 
            onSubmit={handleAddExpense} 
            style={{ 
              display: 'flex', 
              flexDirection: 'column', // Элементы формы теперь в колонку
              gap: '15px', 
              marginBottom: 24, 
              background: '#282c34', 
              padding: '20px', 
              borderRadius: '12px' 
            }}
          >
            {/* Ряд для Суммы и Даты */}
            <div style={{ display: 'flex', gap: '12px', width: '100%' }}>
              <div style={{ flex: 1 /* Равная ширина для суммы */ }}>
                <label htmlFor="exp-amount-page" style={formLabelStyleBase}>Сумма (₽) <span style={{color: 'tomato'}}>*</span></label>
                <input
                  id="exp-amount-page"
                  name="amount"
                  value={eForm.amount}
                  onChange={handleEFormChange}
                  placeholder="0.00"
                  type="number"
                  min="0.01"
                  step="0.01"
                  style={formInputStyleBase}
                  required
                />
              </div>
              <div style={{ flex: 1 /* Равная ширина для даты */ }}>
                <label htmlFor="exp-date-page" style={formLabelStyleBase}>Дата <span style={{color: 'tomato'}}>*</span></label>
                <input
                  id="exp-date-page"
                  name="expense_time"
                  value={eForm.expense_time || todayISO}
                  onChange={handleEFormChange}
                  type="date"
                  className="period-date-input" // Используем общий класс, formInputStyleBase его дополнит
                  style={formInputStyleBase}
                  required
                />
              </div>
            </div>

            {/* Поле Комментарий */}
            <div>
              <label htmlFor="exp-comment-page" style={formLabelStyleBase}>Комментарий</label>
              <input
                id="exp-comment-page"
                name="comment"
                value={eForm.comment}
                onChange={handleEFormChange}
                placeholder="Например, Аренда"
                style={formInputStyleBase} // Займет всю ширину родителя (формы)
              />
            </div>
            
            <button
              type="submit"
              className="action-btn"
              style={{ marginTop: '5px', width: 'auto', alignSelf: 'flex-start' /* Кнопка не растягивается на всю ширину */ }}
            >
              Добавить
            </button>
            {submitError && <div style={{ color: 'salmon', marginTop: 10, width: '100%', textAlign: 'left' }}>{submitError}</div>}
          </form>

          {isLoading && <p style={{color: '#888', textAlign: 'center'}}>Загрузка расходов...</p>}
          {error && <p style={{color: 'salmon', textAlign: 'center'}}>{error}</p>}
          
          {!isLoading && !error && (
            <div style={{overflowX: 'auto', background: '#282c34', padding: '1px 15px 15px 15px', borderRadius: '12px'}}> {/* Добавлен overflowX: 'auto' на случай, если таблица все же не влезет */}
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #353a40' }}>
                    <th style={{...headerCellWithBorder, textAlign: 'left' }}>Сумма</th> {/* Изменено */}
                    <th style={{...headerCellWithBorder, textAlign: 'left' }}>Дата</th> {/* Изменено */}
                    <th style={{...tableHeaderCellStyle, textAlign: 'left' }}>Комментарий</th> {/* Изменено, без правого бордера */}
                    <th style={{ ...tableHeaderCellStyle, width: '44px', paddingRight: 0, paddingLeft: 0 }}></th> {/* Для кнопки удаления, без бордера */}
                  </tr>
                </thead>
                <tbody>
                  {expenses.length === 0 ? (
                    <tr><td colSpan={4} style={{ ...tableCellStyle, color: '#888', padding: '20px', textAlign: 'center' }}>Расходов пока нет. Добавьте первый!</td></tr>
                  ) : (
                    expenses.map((row, idx) => (
                      <tr key={row.id} style={{ borderBottom: '1px solid #23272f' }}>
                        <td style={{...cellWithBorder, textAlign: 'left', color: '#e0e0e0', fontWeight: 500 }}>{Number(row.amount).toLocaleString('ru-RU', {minimumFractionDigits: 2, maximumFractionDigits: 2})} ₽</td>
                        <td style={{...cellWithBorder, textAlign: 'left' }}>{formatDateForInput(new Date(row.expense_time))}</td>
                        <td style={{...tableCellStyle, textAlign: 'right', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{row.comment}</td> {/* Изменено */}
                        <td style={{ ...tableCellStyle, textAlign: 'center', paddingRight: 0, paddingLeft: 0 }}><button onClick={() => handleDeleteAttempt(row.id)} className="delete-btn" title="Удалить">🗑</button></td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </>
  );
}