import React, { useState } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';

const taxOptions = [
  { value: 'income_6', label: 'Доходы 6%' },
  { value: 'income_expense_15', label: 'Доходы – Расходы 15%' }
];

function normalizeCommission(input) {
  return input.replace(',', '.').replace(/[^0-9.]/g, '');
}

export default function Register() {
  const [step, setStep] = useState(1);

  // Vendista Login/Pass
  const [vendistaLogin, setVendistaLogin] = useState('');
  const [vendistaPass, setVendistaPass] = useState('');
  const [vendistaCheck, setVendistaCheck] = useState({ status: 'idle', error: '' });
  const [setupDate, setSetupDate] = useState('');
  const [taxSystem, setTaxSystem] = useState('');
  const [acq, setAcq] = useState('');
  const [regError, setRegError] = useState('');
  const [regSuccess, setRegSuccess] = useState('');
  const navigate = useNavigate();

  // Проверка Vendista профиля
  async function handleVendistaCheck(e) {
    e.preventDefault();
    setVendistaCheck({ status: 'loading', error: '' });
    try {
      const resp = await axios.post('/api/vendista/validate', {
        login: vendistaLogin,
        password: vendistaPass
      });
      if (resp.data.success) {
        setVendistaCheck({ status: 'success', error: '' });
        setStep(2);
      } else {
        setVendistaCheck({ status: 'error', error: resp.data.error || 'Ошибка' });
      }
    } catch (err) {
      setVendistaCheck({ status: 'error', error: err.response?.data?.error || err.message });
    }
  }

  // Регистрация пользователя
  async function handleRegister(e) {
    e.preventDefault();
    setRegError('');
    setRegSuccess('');
    if (!setupDate) return setRegError('Укажите дату установки кофейни.');
    try {
      localStorage.clear(); // ОЧИСТКА всех старых данных перед регистрацией!
      await axios.post('/api/register', {
        vendista_login: vendistaLogin,
        vendista_password: vendistaPass,
        date_install: setupDate,
        tax_system: taxSystem,
        acquiring: acq ? normalizeCommission(acq) : '0'
      });
      localStorage.setItem('vendista_login', vendistaLogin);
      setRegSuccess('Регистрация успешна! Перенаправление на вход...');
      setTimeout(() => navigate('/login'), 1600);
    } catch (err) {
      setRegError(err.response?.data?.error || 'Ошибка регистрации');
    }
  }

  return (
    <div className="container" style={{ maxWidth: 400, margin: '40px auto', padding: 20 }}>
      <h2 style={{ marginBottom: 20, textAlign: 'center', color: '#3e67e0' }}>
        Добро пожаловать в Финансовый Дашборд для Vendista!
      </h2>
      {/* Шаг 1: Vendista login/pass */}
      {step === 1 && (
        <form onSubmit={handleVendistaCheck}>
          <div style={{ fontWeight: 500, marginBottom: 6 }}>Введите логин и пароль Vendista</div>
          <input
            value={vendistaLogin}
            onChange={e => setVendistaLogin(e.target.value)}
            placeholder="Vendista логин"
            autoComplete="username"
            style={{ width: '100%', marginBottom: 8 }}
            required
          />
          <input
            value={vendistaPass}
            onChange={e => setVendistaPass(e.target.value)}
            placeholder="Vendista пароль"
            type="password"
            autoComplete="current-password"
            style={{ width: '100%', marginBottom: 8 }}
            required
          />
          <button type="submit" style={{ width: '100%' }} disabled={vendistaCheck.status === 'loading'}>
            {vendistaCheck.status === 'loading' ? 'Проверяем Vendista...' : 'Авторизуйтесь в Vendista'}
          </button>
          <div style={{ fontSize: 13, color: '#888', marginTop: 10 }}>
            После авторизации Vendista начнёт передавать данные в ваш Финансовый Дашборд.
          </div>
          {vendistaCheck.status === 'error' && <div style={{ color: 'salmon', marginTop: 8 }}>{vendistaCheck.error}</div>}
        </form>
      )}

      {/* Шаг 2: Дата установки, налоги, эквайринг */}
      {step === 2 && (
        <form onSubmit={handleRegister}>
          <div style={{ fontWeight: 500, marginBottom: 10 }}>Дата установки кофейни <span style={{ color: 'tomato' }}>*</span></div>
          <input
            type="date"
            value={setupDate}
            onChange={e => setSetupDate(e.target.value)}
            required
            style={{ width: '100%', marginBottom: 14 }}
          />
          <div style={{ fontWeight: 500, marginBottom: 8 }}>Система налогообложения (необязательно)</div>
          <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
            {taxOptions.map(opt => (
              <button
                type="button"
                key={opt.value}
                onClick={() => setTaxSystem(opt.value)}
                style={{
                  flex: 1,
                  padding: 10,
                  background: taxSystem === opt.value ? '#3e67e0' : '#282c34',
                  color: taxSystem === opt.value ? '#fff' : '#3e67e0',
                  border: '1px solid #3e67e0',
                  borderRadius: 8,
                  fontWeight: 600
                }}
              >{opt.label}</button>
            ))}
          </div>
          <div style={{ fontWeight: 500, marginBottom: 8 }}>Комиссия эквайринга % (необязательно)</div>
          <input
            value={acq}
            onChange={e => setAcq(e.target.value.replace(/[^0-9.,]/g, ''))}
            placeholder="0"
            style={{ width: 100, marginBottom: 20 }}
          /> %
          <div style={{ fontSize: 12, color: '#888', margin: '10px 0 0 0' }}>Разделитель: точка или запятая</div>
          <button type="submit" style={{ width: '100%', marginTop: 20 }}>Завершить регистрацию</button>
          <button type="button" onClick={() => setStep(1)} style={{ background: '#282c34', color: '#3e67e0', width: '100%', marginTop: 6 }}>Назад</button>
          {regError && <div style={{ color: 'salmon', marginTop: 8 }}>{regError}</div>}
          {regSuccess && <div style={{ color: 'lightgreen', marginTop: 8 }}>{regSuccess}</div>}
        </form>
      )}
    </div>
  );
}
