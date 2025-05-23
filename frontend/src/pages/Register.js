// frontend/src/pages/Register.js
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
  const navigate = useNavigate();

  const [vendistaLogin, setVendistaLogin] = useState('');
  const [vendistaPass, setVendistaPass] = useState('');
  const [vendistaCheck, setVendistaCheck] = useState({ status: 'idle', error: '' });

  const [setupDate, setSetupDate] = useState('');
  const [taxSystem, setTaxSystem] = useState('');
  const [acq, setAcq] = useState('');

  const [regError, setRegError] = useState('');
  const [regSuccess, setRegSuccess] = useState('');

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
        setVendistaCheck({ status: 'error', error: resp.data.error || 'Ошибка проверки Vendista' });
      }
    } catch (err) {
      setVendistaCheck({ status: 'error', error: err.response?.data?.error || err.message });
    }
  }

  async function handleRegister(e) {
    e.preventDefault();
    setRegError('');
    setRegSuccess('');
    if (!setupDate) {
      setRegError('Укажите дату установки кофейни.');
      return;
    }

    let acquiringValue = '0';
    if (acq) {
        const normalized = normalizeCommission(acq);
        if (normalized && !isNaN(parseFloat(normalized))) {
            acquiringValue = normalized;
        } else {
            setRegError('Комиссия эквайринга должна быть числом, например 1.6');
            return;
        }
    }

    try {
      localStorage.clear();
      await axios.post('/api/register', {
        vendista_login: vendistaLogin,
        vendista_password: vendistaPass,
        date_install: setupDate,
        tax_system: taxSystem,
        acquiring: acquiringValue
      });
      setRegSuccess('Регистрация успешна! Сейчас вы будете перенаправлены на страницу входа.');
      setTimeout(() => navigate('/login'), 2500);
    } catch (err) {
      setRegError(err.response?.data?.error || 'Ошибка регистрации');
    }
  }

  return (
    <div className="auth-container"> {/* Используем новый класс */}
      <div className="auth-form-wrapper"> {/* Используем новый класс */}
        {step === 1 && (
          <>
            <h2>Регистрация: Шаг 1</h2> {/* Убрал "из 2" для чистоты */}
            <div className="auth-step-info">Проверка аккаунта Vendista</div>
            <form onSubmit={handleVendistaCheck}>
              <input
                value={vendistaLogin}
                onChange={e => setVendistaLogin(e.target.value)}
                placeholder="Логин Vendista"
                autoComplete="username"
                required
              />
              <input
                value={vendistaPass}
                onChange={e => setVendistaPass(e.target.value)}
                placeholder="Пароль Vendista"
                type="password"
                autoComplete="current-password"
                required
              />
              <button type="submit" className="auth-button-primary" disabled={vendistaCheck.status === 'loading'}>
                {vendistaCheck.status === 'loading' ? 'Проверка...' : 'Проверить аккаунт Vendista'}
              </button>
              <button
                type="button"
                onClick={() => navigate('/login')}
                className="auth-button-secondary"
              >
                Назад ко входу
              </button>
              <div className="auth-fine-print">
                Мы проверим ваши учетные данные через API Vendista для старта.
              </div>
              {vendistaCheck.status === 'error' && <div className="auth-error">{vendistaCheck.error}</div>}
            </form>
          </>
        )}

        {step === 2 && (
          <>
            <h2>Регистрация: Шаг 2</h2> {/* Убрал "из 2" */}
            <div className="auth-step-info">Дополнительная информация</div>
            <form onSubmit={handleRegister}>
              <label htmlFor="setupDate" className="auth-step-info">Дата установки кофейни <span style={{ color: 'tomato' }}>*</span></label>
              <input
                type="date"
                id="setupDate"
                value={setupDate}
                onChange={e => setSetupDate(e.target.value)}
                required
              />

              <div className="auth-step-info" style={{marginTop: '15px'}}>Система налогообложения</div> {/* Немного отступа */}
              <div className="tax-options-container">
                {taxOptions.map(opt => (
                  <button
                    type="button"
                    key={opt.value}
                    onClick={() => setTaxSystem(prev => prev === opt.value ? '' : opt.value)}
                    className={taxSystem === opt.value ? 'active' : ''}
                  >{opt.label}</button>
                ))}
              </div>

              <label htmlFor="acq" className="auth-step-info">Комиссия эквайринга, %</label>
              <div> {/* Обертка для инпута и знака % */}
                <input
                  id="acq"
                  name="acquiring"
                  value={acq}
                  onChange={e => setAcq(e.target.value)}
                  placeholder="1.6"
                  type="text"
                /> %
              </div>
              <div className="auth-fine-print" style={{marginTop: '5px'}}>
                Например: 1.6 (разделитель точка или запятая)
              </div>

              <button type="submit" className="auth-button-primary" style={{marginTop: '20px'}}>Завершить регистрацию</button>
              <button type="button" onClick={() => setStep(1)} className="auth-button-secondary">
                Назад к Шагу 1
              </button>
              <button /* Эта кнопка дублирует функционал "Назад к Шагу 1" + переход на логин. Можно оставить одну или уточнить ее назначение.
                         Я бы предложил одну "Отменить регистрацию" которая ведет на /login.
                      */
                type="button"
                onClick={() => navigate('/login')}
                className="auth-button-secondary"
              >
                Отменить и вернуться ко входу
              </button>
              {regError && <div className="auth-error">{regError}</div>}
              {regSuccess && <div style={{ color: 'lightgreen', marginTop: 15, fontSize: '0.9em' }}>{regSuccess}</div>}
            </form>
          </>
        )}
      </div>
    </div>
  );
}