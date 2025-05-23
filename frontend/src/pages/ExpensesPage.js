// src/pages/ExpensesPage.js
import React, { useEffect, useState, useCallback } from 'react';
import axios from 'axios'; // Импортируем axios
import { formatDateForInput } from '../constants';
import ConfirmModal from '../components/ConfirmModal';

// Стили для элементов формы (можно вынести в index.css, если будут использоваться еще где-то)
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
  color: '#a0a0a0', // Цвет как у неактивных элементов сайдбара
  marginBottom: '3px',
  display: 'block'
};

export default function ExpensesPage() {
  const todayISO = formatDateForInput(new Date());

  const [expenses, setExpenses] = useState([]);
  const [eForm, setEForm] = useState({ amount: '', expense_time: todayISO, comment: '' });
  const [isLoading, setIsLoading] = useState(false); // Состояние для отслеживания загрузки
  const [error, setError] = useState('');
  const [submitError, setSubmitError] = useState(''); // Отдельная ошибка для формы

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
        // Сортируем по дате (новые сверху), и по ID для стабильности при одинаковой дате
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
    if (e.target.name === 'amount' && submitError) { // Сбрасываем ошибку суммы при изменении
        setSubmitError('');
    }
  };

  const handleAddExpense = async (e) => {
    e.preventDefault();
    setSubmitError(''); // Сбрасываем предыдущие ошибки формы

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
      comment: eForm.comment.trim() || '', // Убираем лишние пробелы или пустая строка
    };

    try {
      const token = localStorage.getItem('token');
      const res = await axios.post('/api/expenses', payload, {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (res.data.success && res.data.expense) {
        // Добавляем новый расход в начало списка и пересортировываем
        setExpenses(prev => [res.data.expense, ...prev].sort((a,b) => new Date(b.expense_time) - new Date(a.expense_time) || b.id - a.id));
        setEForm({ amount: '', expense_time: todayISO, comment: '' }); // Очищаем форму
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
    setError(''); // Очищаем общую ошибку списка
    try {
      const token = localStorage.getItem('token');
      const res = await axios.delete(`/api/expenses/${expenseToDeleteId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.data.success) {
        setExpenses(prevExpenses => prevExpenses.filter(e => e.id !== expenseToDeleteId));
      } else {
        setError(res.data.error || 'Не удалось удалить расход.'); // Показываем ошибку в общем списке
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
      <div style={{
          maxWidth: '700px', // Немного увеличим, чтобы таблица лучше смотрелась
          margin: '0 auto'
        }}
      >
        <h2 style={{ marginBottom: '20px', color: '#eee' }}>Учет расходов</h2> {/* Используем h2 как на других страницах */}

        <form onSubmit={handleAddExpense} style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'flex-end', marginBottom: 24, background: '#282c34', padding: '20px', borderRadius: '12px' }}>
          <div>
            <label htmlFor="exp-amount-page" style={formLabelStyle}>Сумма (₽) <span style={{color: 'tomato'}}>*</span></label>
            <input
              id="exp-amount-page"
              name="amount"
              value={eForm.amount}
              onChange={handleEFormChange}
              placeholder="0.00"
              type="number"
              min="0.01" // Сумма должна быть больше 0
              step="0.01"
              style={{...formElementStyle, width: '130px' }} // Немного шире
              required
            />
          </div>
          <div>
            <label htmlFor="exp-date-page" style={formLabelStyle}>Дата <span style={{color: 'tomato'}}>*</span></label>
            <input
              id="exp-date-page"
              name="expense_time"
              value={eForm.expense_time || todayISO}
              onChange={handleEFormChange}
              type="date"
              className="period-date-input" // Используем общий класс
              style={{...formElementStyle, width: '170px' }} // Ширина для даты
              required
            />
          </div>
          <div style={{ flexGrow: 1, minWidth: '180px' }}> {/* Поле комментария займет оставшееся место */}
            <label htmlFor="exp-comment-page" style={formLabelStyle}>Категория/Комментарий</label>
            <input
              id="exp-comment-page"
              name="comment"
              value={eForm.comment}
              onChange={handleEFormChange}
              placeholder="Например, Аренда"
              style={{...formElementStyle, width: '100%' }} // Ширина 100% от родителя
            />
          </div>
          <button
            type="submit"
            className="action-btn" // Используем общий класс для кнопки действия
            // Инлайновые стили для специфичных отступов или размеров можно оставить, но основные лучше через класс
            style={{ minWidth: '120px' /* Минимальная ширина кнопки */ }}
          >
            Добавить
          </button>
          {submitError && <div style={{ color: 'salmon', marginTop: 8, width: '100%', textAlign: 'center' }}>{submitError}</div>}
        </form>

        {/* Убрали заголовок "Список расходов", таблица сама за себя говорит */}
        {isLoading && <p style={{color: '#888', textAlign: 'center'}}>Загрузка расходов...</p>}
        {error && <p style={{color: 'salmon', textAlign: 'center'}}>{error}</p>}

        {!isLoading && !error && (
          <div style={{maxHeight: '500px', overflowY: 'auto', background: '#282c34', padding: '15px', borderRadius: '12px'}}>
            <table style={{ width: '100%', minWidth: '550px', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #353a40' }}>
                  <th style={{ textAlign: 'right', padding: '10px 12px', color: '#a0b0c8', fontWeight: 500 }}>Сумма</th>
                  <th style={{ textAlign: 'left', padding: '10px 12px', color: '#a0b0c8', fontWeight: 500 }}>Дата</th>
                  <th style={{ textAlign: 'left', padding: '10px 12px', color: '#a0b0c8', fontWeight: 500 }}>Комментарий</th>
                  <th style={{ width: '44px' }}></th>
                </tr>
              </thead>
              <tbody>
                {expenses.length === 0 ? (
                  <tr><td colSpan={4} style={{ color: '#888', padding: '20px', textAlign: 'center' }}>Расходов пока нет. Добавьте первый!</td></tr>
                ) : (
                  expenses.map((row, idx) => (
                    <tr key={row.id} style={{ borderBottom: '1px solid #23272f' }}>
                      <td style={{ textAlign: 'right', padding: '10px 12px', color: '#e0e0e0', fontWeight: 500 }}>{Number(row.amount).toLocaleString('ru-RU', {minimumFractionDigits: 2, maximumFractionDigits: 2})} ₽</td>
                      <td style={{ textAlign: 'left', padding: '10px 12px', color: '#c6c6c6' }}>{formatDateForInput(new Date(row.expense_time))}</td>
                      <td style={{ textAlign: 'left', padding: '10px 12px', color: '#c6c6c6', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{row.comment}</td>
                      <td style={{ textAlign: 'center', padding: '10px 0' }}><button onClick={() => handleDeleteAttempt(row.id)} className="delete-btn" title="Удалить">🗑</button></td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}