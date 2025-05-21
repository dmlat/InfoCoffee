import React, { useEffect, useState } from 'react';
import axios from 'axios';

// Периоды можно вынести в отдельный файл или передавать как props
function formatDate(date) {
  if (!date) return '';
  return date.toISOString().split('T')[0];
}

export default function ExpensesPage({ periodRange }) {
  const today = formatDate(new Date());
  const [expenses, setExpenses] = useState([]);
  const [eForm, setEForm] = useState({ amount: '', expense_time: today, comment: '' });
  const [error, setError] = useState('');
  const token = localStorage.getItem('token');

  useEffect(() => {
    const fetchExpenses = async () => {
      try {
        const eRes = await axios.get('/api/expenses', { headers: { Authorization: `Bearer ${token}` } });
        setExpenses(eRes.data.expenses);
      } catch (err) {
        setError('Ошибка загрузки расходов');
      }
    };
    fetchExpenses();
  }, [token]);

  const filteredExpenses = expenses.filter(e => {
    if (!periodRange[0] || !periodRange[1]) return true;
    const ts = new Date(e.expense_time).getTime();
    return (!periodRange[0] || ts >= periodRange[0].getTime()) &&
           (!periodRange[1] || ts <= periodRange[1].getTime());
  });

  const handleEForm = e => setEForm({ ...eForm, [e.target.name]: e.target.value });

  const addExpense = async (e) => {
    e.preventDefault();
    const payload = {
      ...eForm,
      expense_time: eForm.expense_time || today,
      comment: eForm.comment || ''
    };
    try {
      await axios.post('/api/expenses', payload, { headers: { Authorization: `Bearer ${token}` } });
      setEForm({ amount: '', expense_time: today, comment: '' });
      const eRes = await axios.get('/api/expenses', { headers: { Authorization: `Bearer ${token}` } });
      setExpenses(eRes.data.expenses);
    } catch (err) {
      setError('Ошибка добавления расхода');
    }
  };

  const deleteExpense = async (id) => {
    if (!window.confirm('Удалить расход?')) return;
    try {
      await axios.delete(`/api/expenses/${id}`, { headers: { Authorization: `Bearer ${token}` } });
      setExpenses(expenses.filter(e => e.id !== id));
    } catch (err) {
      setError('Ошибка удаления расхода');
    }
  };

  const expensesSum = filteredExpenses.reduce((s, e) => s + Number(e.amount), 0);

  return (
    <div style={{
      maxWidth: 700,
      margin: '0 auto',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'stretch'
    }}>
      <div style={{ fontSize: 22, fontWeight: 600, marginBottom: 18, color: '#eee', alignSelf: 'flex-start' }}>Запишите расходы</div>
      <form onSubmit={addExpense} style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 24 }}>
        <input
          name="amount"
          value={eForm.amount}
          onChange={handleEForm}
          placeholder="Сумма"
          type="number"
          min="0"
          style={{ width: 100 }}
          required
        />
        <input
          name="expense_time"
          value={eForm.expense_time || today}
          onChange={handleEForm}
          type="date"
          style={{ width: 140 }}
          required
        />
        <input
          name="comment"
          value={eForm.comment}
          onChange={handleEForm}
          placeholder="Комментарий"
          style={{ width: 200 }}
        />
        <button
          type="submit"
          style={{
            background: '#3e67e0',
            color: '#fff',
            fontWeight: 500,
            border: 'none',
            borderRadius: 8,
            padding: '8px 22px'
          }}
        >
          Добавить
        </button>
      </form>
      <div style={{
        marginBottom: 14,
        fontWeight: 500,
        fontSize: 17,
        alignSelf: 'flex-start'
      }}>Итог: <b style={{ color: '#ffb300' }}>{expensesSum.toLocaleString('ru-RU')} ₽</b></div>
      <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 8, alignSelf: 'flex-start' }}>Список расходов</div>
      <table style={{
        width: '100%',
        minWidth: 420,
        borderCollapse: 'collapse',
        background: '#23272f',
        borderRadius: 12,
        overflow: 'hidden'
      }}>
        <thead>
          <tr style={{ background: '#1f2330', color: '#8ae6ff' }}>
            <th style={{ textAlign: 'right', padding: '8px 12px', width: 130 }}>Сумма расходов</th>
            <th style={{ textAlign: 'left', padding: '8px 12px', width: 120 }}>Дата</th>
            <th style={{ textAlign: 'left', padding: '8px 12px' }}>Комментарий</th>
            <th style={{ width: 44 }}></th>
          </tr>
        </thead>
        <tbody>
          {filteredExpenses.map((row, idx) => (
            <tr key={row.id} style={{ background: idx % 2 ? '#262a36' : '#23273a' }}>
              <td style={{ textAlign: 'right', padding: '8px 12px' }}>{row.amount.toLocaleString('ru-RU')} ₽</td>
              <td style={{ textAlign: 'left', padding: '8px 12px' }}>{formatDate(new Date(row.expense_time))}</td>
              <td style={{ textAlign: 'left', padding: '8px 12px' }}>{row.comment}</td>
              <td style={{ textAlign: 'center', padding: '8px 0' }}>
                <button
                  onClick={() => deleteExpense(row.id)}
                  style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    color: '#e06b6b',
                    fontSize: 18,
                    lineHeight: 1,
                    padding: 0
                  }}
                  title="Удалить"
                >
                  🗑️
                </button>
              </td>
            </tr>
          ))}
          {!filteredExpenses.length && (
            <tr>
              <td colSpan={4} style={{ color: '#888', padding: 20, textAlign: 'center' }}>Нет расходов за период</td>
            </tr>
          )}
        </tbody>
      </table>
      {error && <div style={{ color: 'salmon', marginTop: 10 }}>{error}</div>}
    </div>
  );
}
