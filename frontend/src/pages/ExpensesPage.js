// src/pages/ExpensesPage.js
import React, { useEffect, useState, useCallback } from 'react';
import apiClient from '../api';
import { formatDateForInput } from '../constants';
import ConfirmModal from '../components/ConfirmModal';
import './ExpensesPage.css';

const formatDateForTableDisplay = (isoOrYyyyMmDdDateString) => {
  if (!isoOrYyyyMmDdDateString) return '';
  try {
    if (typeof isoOrYyyyMmDdDateString === 'string' && /^\d{2}\.\d{2}\.\d{4}$/.test(isoOrYyyyMmDdDateString)) {
        return isoOrYyyyMmDdDateString;
    }
    const date = new Date(isoOrYyyyMmDdDateString);
    if (isNaN(date.getTime())) {
        return isoOrYyyyMmDdDateString; 
    }
    const day = String(date.getUTCDate()).padStart(2, '0');
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const year = date.getUTCFullYear();
    return `${day}.${month}.${year}`;
  } catch (err) {
    return String(isoOrYyyyMmDdDateString); 
  }
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
      const res = await apiClient.get('/expenses');
      if (res.data.success) {
        setExpenses(res.data.expenses.sort((a, b) => new Date(b.expense_time) - new Date(a.expense_time) || b.id - a.id));
      } else {
        setError(res.data.error || 'Не удалось загрузить расходы.');
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Ошибка сети при загрузке расходов.');
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
      const res = await apiClient.post('/expenses', payload);
    
      if (res.data.success && res.data.expense) {
        setExpenses(prev => [res.data.expense, ...prev].sort((a,b) => new Date(b.expense_time) - new Date(a.expense_time) || b.id - a.id));
        setEForm({ amount: '', expense_time: todayISO, comment: '' });
        if (document.activeElement && typeof document.activeElement.blur === 'function') { 
          document.activeElement.blur();
        }
      } else {
        setSubmitError(res.data.error || 'Не удалось добавить расход.');
      }
    } catch (err) {
      setSubmitError(err.response?.data?.error || 'Ошибка сети при добавлении расхода.');
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
      const res = await apiClient.delete(`/expenses/${expenseToDeleteId}`);
      if (res.data.success) {
        setExpenses(prevExpenses => prevExpenses.filter(e => e.id !== expenseToDeleteId));
      } else {
        setError(res.data.error || 'Не удалось удалить расход.');
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Ошибка сети при удалении расхода.');
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
        confirmButtonClass="danger"
      />
      <div className="page-container expenses-page-layout" style={{flexDirection: 'column'}}> 
        <div className="main-content-area" style={{width: '100%'}}>
          
          <form onSubmit={handleAddExpense} className="expense-form-container">
            <h2 className="form-title">Учёт расходов</h2>

            <div className="expense-form-row expense-form-row-amount-date"> 
              <div className="expense-form-field"> 
                <label htmlFor="exp-amount-page" className="expense-form-label">Сумма (₽) <span style={{color: 'tomato'}}>*</span></label>
                <input
                  id="exp-amount-page" name="amount" value={eForm.amount}
                  onChange={handleEFormChange} placeholder="0.00"
                  type="number" min="0.01" step="0.01"
                  className="expense-form-input" required
                />
              </div>
              <div className="expense-form-field"> 
                <label htmlFor="exp-date-page" className="expense-form-label">Дата <span style={{color: 'tomato'}}>*</span></label>
                <input
                  id="exp-date-page" name="expense_time" value={eForm.expense_time || todayISO} 
                  onChange={handleEFormChange} type="date"
                  className="expense-form-input period-date-input" required
                />
              </div>
            </div>

            <div className="expense-form-field-fullwidth"> 
              <label htmlFor="exp-comment-page" className="expense-form-label">Комментарий</label>
              <input
                id="exp-comment-page" name="comment" value={eForm.comment}
                onChange={handleEFormChange} placeholder="Например, Аренда"
                className="expense-form-input"
              />
            </div>
            
            <button type="submit" className="action-btn expense-form-submit-button">
              Добавить
            </button>
            {submitError && <div className="expense-form-error">{submitError}</div>}
          </form>

          {isLoading && <p className="page-loading-container"><span>Загрузка расходов...</span></p>}
          {error && <p className="error-message" style={{textAlign: 'center'}}>{error}</p>}
          
          {!isLoading && !error && (
            <div className="data-table-container expenses-table-container">
              {/* ИЗМЕНЕНО: Добавлен класс .data-table */}
              <table className="data-table expenses-table"> 
                <thead>
                  <tr>
                    {/* ИЗМЕНЕНО: Добавлены классы для выравнивания */}
                    <th className="td-amount">Сумма</th>
                    <th className="td-date">Дата</th>
                    <th className="td-comment">Комментарий</th>
                    <th className="td-action"></th>
                  </tr>
                </thead>
                <tbody>
                  {expenses.length === 0 ? (
                    <tr className="empty-data-row"><td colSpan={4}>Расходов пока нет. Добавьте первый!</td></tr>
                  ) : (
                    expenses.map((row) => (
                      <tr key={row.id}>
                        {/* ИЗМЕНЕНО: Добавлены классы для выравнивания */}
                        <td className="td-amount">{Number(row.amount).toLocaleString('ru-RU', {minimumFractionDigits: 2, maximumFractionDigits: 2})}{`\u00A0`}₽</td>
                        <td className="td-date">{formatDateForTableDisplay(row.expense_time)}</td>
                        <td className="td-comment">{row.comment}</td>
                        <td className="td-action">
                          {/* ИЗМЕНЕНО: иконка корзины заменена на крестик */}
                          <button onClick={() => handleDeleteAttempt(row.id)} className="delete-btn" title="Удалить">
                            &times;
                          </button>
                        </td>
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