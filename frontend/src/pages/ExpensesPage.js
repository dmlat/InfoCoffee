// src/pages/ExpensesPage.js
import React, { useEffect, useState, useCallback } from 'react';
import apiClient from '../api';
import { formatDateForInput } from '../constants';
import ConfirmModal from '../components/ConfirmModal';

export default function ExpensesPage() {
  const todayISO = formatDateForInput(new Date());

  const [expenses, setExpenses] = useState([]);
  const [eForm, setEForm] = useState({ amount: '', expense_time: todayISO, comment: '' });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(''); // Для ошибок загрузки/удаления списка
  const [submitError, setSubmitError] = useState(''); // Для ошибок формы добавления

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [expenseToDeleteId, setExpenseToDeleteId] = useState(null);

  const fetchExpenses = useCallback(async () => {
    setIsLoading(true);
    setError('');
    try {
      const token = localStorage.getItem('token');
      const res = await apiClient.get('/expenses', {
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
      const res = await apiClient.post('/expenses', payload)
    
      if (res.data.success && res.data.expense) {
        setExpenses(prev => [res.data.expense, ...prev].sort((a,b) => new Date(b.expense_time) - new Date(a.expense_time) || b.id - a.id));
        setEForm({ amount: '', expense_time: todayISO, comment: '' });
        if (document.activeElement && typeof document.activeElement.blur === 'function') { // Предотвращаем zoom-in
          document.activeElement.blur();
        }
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
      const res = await apiClient.delete(`/expenses/${expenseToDeleteId}`, {
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
      <div className="page-container" style={{flexDirection: 'column'}}>
        <div className="main-content-area" style={{width: '100%'}}>
          <h2 style={{ marginBottom: '20px', color: '#eee' }}>Учет расходов</h2>

          <form onSubmit={handleAddExpense} className="expense-form-container">
            {/* Ряд для Суммы и Даты */}
            <div className="expense-form-row">
              <div className="expense-form-field">
                <label htmlFor="exp-amount-page" className="expense-form-label">Сумма (₽) <span style={{color: 'tomato'}}>*</span></label>
                <input
                  id="exp-amount-page"
                  name="amount"
                  value={eForm.amount}
                  onChange={handleEFormChange}
                  placeholder="0.00"
                  type="number"
                  min="0.01"
                  step="0.01"
                  className="expense-form-input"
                  required
                />
              </div>
              <div className="expense-form-field">
                <label htmlFor="exp-date-page" className="expense-form-label">Дата <span style={{color: 'tomato'}}>*</span></label>
                <input
                  id="exp-date-page"
                  name="expense_time"
                  value={eForm.expense_time || todayISO}
                  onChange={handleEFormChange}
                  type="date"
                  className="expense-form-input period-date-input"
                  required
                />
              </div>
            </div>

            {/* Поле Комментарий */}
            <div className="expense-form-field-fullwidth">
              <label htmlFor="exp-comment-page" className="expense-form-label">Комментарий</label>
              <input
                id="exp-comment-page"
                name="comment"
                value={eForm.comment}
                onChange={handleEFormChange}
                placeholder="Например, Аренда"
                className="expense-form-input"
              />
            </div>
            
            <button
              type="submit"
              className="action-btn expense-form-submit-button"
            >
              Добавить
            </button>
            {submitError && <div className="expense-form-error">{submitError}</div>}
          </form>

          {isLoading && <p style={{color: '#888', textAlign: 'center', marginTop: '20px'}}>Загрузка расходов...</p>}
          {error && <p style={{color: 'salmon', textAlign: 'center', marginTop: '20px'}}>{error}</p>}
          
          {!isLoading && !error && (
            <div className="expenses-table-container">
              <table className="expenses-table">
                <thead>
                  <tr>
                    <th className="expenses-table-header th-amount">Сумма</th>
                    <th className="expenses-table-header th-date">Дата</th>
                    <th className="expenses-table-header th-comment">Комментарий</th>
                    <th className="expenses-table-header th-action"></th> {/* Для кнопки удаления */}
                  </tr>
                </thead>
                <tbody>
                  {expenses.length === 0 ? (
                    <tr><td colSpan={4} className="empty-expenses-row">Расходов пока нет. Добавьте первый!</td></tr>
                  ) : (
                    expenses.map((row) => (
                      <tr key={row.id}>
                        <td className="td-amount">{Number(row.amount).toLocaleString('ru-RU', {minimumFractionDigits: 2, maximumFractionDigits: 2})} ₽</td>
                        <td className="td-date">{formatDateForInput(new Date(row.expense_time))}</td>
                        <td className="td-comment">{row.comment}</td>
                        <td className="td-action"><button onClick={() => handleDeleteAttempt(row.id)} className="delete-btn" title="Удалить">🗑</button></td>
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