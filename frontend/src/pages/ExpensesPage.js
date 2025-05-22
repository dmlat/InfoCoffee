// src/pages/ExpensesPage.js
import React, { useEffect, useState } from 'react';
import { formatDateForInput } from '../constants'; 
import ConfirmModal from '../components/ConfirmModal';

const MOCK_EXPENSES_DATA = [
  { id: 1, amount: 5000.00, expense_time: '2025-05-10', comment: 'Аренда точки А (Май)' },
  { id: 2, amount: 1200.50, expense_time: '2025-05-15', comment: 'Зерна кофе "Арабика Премиум"' },
  { id: 3, amount: 300.00, expense_time: '2025-05-20', comment: 'Стаканчики (упаковка 1000шт)' },
  { id: 4, amount: 6500.00, expense_time: '2025-04-10', comment: 'Аренда точки Б (Апрель)' },
  { id: 5, amount: 250.75, expense_time: formatDateForInput(new Date()), comment: 'Молоко Parmalat 3.2%' },
  { id: 6, amount: 150.00, expense_time: formatDateForInput(new Date(new Date().setDate(new Date().getDate() -1))), comment: 'Сироп "Карамель"' },
];

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

export default function ExpensesPage() {
  const todayISO = formatDateForInput(new Date());

  const [expenses, setExpenses] = useState([]);
  const [eForm, setEForm] = useState({ amount: '', expense_time: todayISO, comment: '' });
  const [error, setError] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [expenseToDeleteId, setExpenseToDeleteId] = useState(null);

  useEffect(() => {
    setExpenses(MOCK_EXPENSES_DATA.sort((a,b) => new Date(b.expense_time) - new Date(a.expense_time)));
  }, []);
  
  const allExpenses = expenses; 

  const handleEFormChange = e => setEForm({ ...eForm, [e.target.name]: e.target.value });

  const handleAddExpense = async (e) => { 
    e.preventDefault(); 
    setError('');
    const payload = { 
      ...eForm, 
      id: Date.now(), 
      expense_time: eForm.expense_time || todayISO, 
      comment: eForm.comment || '', 
      amount: parseFloat(eForm.amount) 
    };
    if (isNaN(payload.amount) || payload.amount <= 0) { 
      setError('Сумма должна быть числом > 0.'); 
      return; 
    }
    setExpenses(prev => [payload, ...prev].sort((a,b) => new Date(b.expense_time) - new Date(a.expense_time)));
    setEForm({ amount: '', expense_time: todayISO, comment: '' });
  };

  const handleDeleteAttempt = (id) => { 
    setExpenseToDeleteId(id); 
    setIsModalOpen(true); 
  };

  const confirmDeleteExpense = () => {
    if (expenseToDeleteId === null) return; 
    setError('');
    setExpenses(prevExpenses => prevExpenses.filter(e => e.id !== expenseToDeleteId));
    setIsModalOpen(false); 
    setExpenseToDeleteId(null);
  };

  const cancelDeleteExpense = () => { 
    setIsModalOpen(false); 
    setExpenseToDeleteId(null); 
  };

  return (
    <>
      <ConfirmModal 
        isOpen={isModalOpen}
        message="Удалить расход?"
        onConfirm={confirmDeleteExpense}
        onCancel={cancelDeleteExpense}
      />
      {/* Убрали классы page-container и main-content-area, так как эта страница 
        теперь имеет простую одноколоночную структуру с фиксированной максимальной шириной.
        Если потребуется сделать ее адаптивной по ширине родителя (main-content-area),
        тогда эти классы нужно будет вернуть, а maxWidth убрать отсюда.
      */}
      <div style={{ 
          maxWidth: '650px', // Установим максимальную ширину чуть больше суммарной ширины элементов формы
          margin: '0 auto' // Центрируем блок, если он уже, чем доступное пространство
        }}
      > 
        <div style={{ fontSize: 22, fontWeight: 600, marginBottom: 18, color: '#eee' }}>Записать расход</div>
        
        <form onSubmit={handleAddExpense} style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'flex-end', marginBottom: 24 }}>
          <div>
            <label htmlFor="exp-amount-page" style={formLabelStyle}>Сумма (₽)</label>
            <input 
              id="exp-amount-page" 
              name="amount" 
              value={eForm.amount} 
              onChange={handleEFormChange} 
              placeholder="0.00" 
              type="number" 
              min="0" 
              step="0.01" 
              style={{...formElementStyle, width: '120px' }} 
              required 
            />
          </div>
          <div>
            <label htmlFor="exp-date-page" style={formLabelStyle}>Дата</label>
            <input 
              id="exp-date-page" 
              name="expense_time" 
              value={eForm.expense_time || todayISO} 
              onChange={handleEFormChange} 
              type="date" 
              className="period-date-input" // Используем класс для общих стилей input[type=date]
              style={{...formElementStyle, width: '160px' }} // width здесь переопределит width из .period-date-input
              required 
            />
          </div>
          <div>
            <label htmlFor="exp-comment-page" style={formLabelStyle}>Категория/Комментарий</label>
            <input 
              id="exp-comment-page" 
              name="comment" 
              value={eForm.comment} 
              onChange={handleEFormChange} 
              placeholder="Например, Аренда" 
              style={{...formElementStyle, width: '220px' }} 
            />
          </div>
          <button 
            type="submit" 
            className="action-btn" 
            style={{...formElementStyle, background: '#3e67e0', color: '#fff', fontWeight: 500, cursor: 'pointer', width: 'auto', paddingLeft: '22px', paddingRight: '22px' }}
          >
            Добавить
          </button>
        </form>
        
        {/* Заголовок "Список расходов" УДАЛЕН */}
        
        <div style={{maxHeight: '500px', overflowY: 'auto'}}>
          {/* Таблица теперь будет занимать ширину родителя, который ограничен maxWidth */}
          <table style={{ width: '100%', minWidth: 420, borderCollapse: 'collapse', background: '#23272f', borderRadius: 12, overflow: 'hidden' }}>
            <thead>
              <tr style={{ background: '#1f2330', color: '#8ae6ff', position: 'sticky', top: 0, zIndex: 1 }}>
                <th style={{ textAlign: 'left', padding: '10px 12px', width: 'auto', fontWeight: 600 }}>Расходы</th> {/* Убрал фиксированную ширину */}
                <th style={{ textAlign: 'left', padding: '10px 12px', width: '120px', fontWeight: 600 }}>Дата</th>
                <th style={{ textAlign: 'right', padding: '10px 12px', fontWeight: 600 }}>Категория/Комментарий</th>
                <th style={{ width: '44px' }}></th>
              </tr>
            </thead>
            <tbody>
              {allExpenses.map((row, idx) => (
                <tr key={row.id} style={{ background: idx % 2 ? '#262a36' : '#23273a', borderBottom: '1px solid #303548' }}>
                  <td style={{ textAlign: 'right', padding: '8px 12px', color: '#e0e0e0' }}>{Number(row.amount).toLocaleString('ru-RU', {minimumFractionDigits: 2, maximumFractionDigits: 2})} ₽</td>
                  <td style={{ textAlign: 'left', padding: '8px 12px', color: '#c6c6c6' }}>{formatDateForInput(new Date(row.expense_time))}</td>
                  <td style={{ textAlign: 'left', padding: '8px 12px', color: '#c6c6c6' }}>{row.comment}</td>
                  <td style={{ textAlign: 'center', padding: '8px 0' }}><button onClick={() => handleDeleteAttempt(row.id)} className="delete-btn" title="Удалить">🗑</button></td>
                </tr>
              ))}
              {!allExpenses.length && ( <tr><td colSpan={4} style={{ color: '#888', padding: 20, textAlign: 'center' }}>Расходов пока нет</td></tr> )}
            </tbody>
          </table>
        </div>
        {error && <div style={{ color: 'salmon', marginTop: 10 }}>{error}</div>}
      </div>
    </>
  );
}