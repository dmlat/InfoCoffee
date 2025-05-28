// frontend/src/pages/RegisterPage.js
import React, { useState, useEffect } from 'react';
import apiClient from '../api';
import { useNavigate, useLocation } from 'react-router-dom';

const taxOptions = [
  { value: 'income_6', label: 'Доходы 6%' },
  { value: 'income_expense_15', label: 'Доходы – Расходы 15%' }
];

function normalizeCommission(input) {
  return String(input).replace(',', '.').replace(/[^0-9.]/g, '');
}

export default function RegisterPage({ setIsAuth }) {
  const navigate = useNavigate();
  const location = useLocation();

  const [telegramId, setTelegramId] = useState('');
  const [currentStep, setCurrentStep] = useState(1); // 1: Vendista creds, 2: Other details

  // Form fields for Step 1 (Vendista Credentials)
  const [vendistaLogin, setVendistaLogin] = useState('');
  const [vendistaPassword, setVendistaPassword] = useState('');
  const [vendistaApiToken, setVendistaApiToken] = useState(''); // To store token from step 1 backend response
  const [vendistaCheckStatus, setVendistaCheckStatus] = useState({ status: 'idle', message: '' });

  // Form fields for Step 2 (Other Details)
  const [setupDate, setSetupDate] = useState('');
  const [taxSystem, setTaxSystem] = useState('');
  const [acquiringRate, setAcquiringRate] = useState('');
  
  const [finalRegStatus, setFinalRegStatus] = useState({ status: 'idle', message: '' });

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const tgIdFromQuery = params.get('tg_id');
    const statusFromQuery = params.get('status');

    if (tgIdFromQuery) {
      setTelegramId(tgIdFromQuery);
    } else {
      // If no tg_id, this page shouldn't be accessible directly
      // navigate('/app-entry?error=missing_tg_id_for_registration', { replace: true });
      console.warn("Registration page accessed without Telegram ID.");
    }
    if (statusFromQuery === 'registration_incomplete') {
        // If registration was incomplete, user might already have some data.
        // For now, we just start the flow. Could pre-fill if backend sent existing data.
        setCurrentStep(1); // Start with Vendista credentials input again
    }

  }, [location.search, navigate]);

  // Step 1: Submit Vendista Credentials
  const handleVendistaCredentialsSubmit = async (e) => {
    e.preventDefault();
    setVendistaCheckStatus({ status: 'loading', message: 'Проверка учетных данных Vendista...' });
    try {
      const response = await apiClient.post('/auth/vendista-credentials', {
        telegram_id: telegramId,
        vendista_login: vendistaLogin,
        vendista_password: vendistaPassword
      });
      if (response.data.success && response.data.vendista_api_token) {
        setVendistaApiToken(response.data.vendista_api_token);
        setVendistaCheckStatus({ status: 'success', message: 'Учетные данные Vendista подтверждены.' });
        setCurrentStep(2); // Move to step 2
      } else {
        setVendistaCheckStatus({ status: 'error', message: response.data.error || 'Не удалось проверить учетные данные Vendista.' });
      }
    } catch (err) {
      setVendistaCheckStatus({ status: 'error', message: err.response?.data?.error || 'Ошибка сети при проверке Vendista.' });
    }
  };

  // Step 2: Submit Final Registration Details
  const handleFinalRegistrationSubmit = async (e) => {
    e.preventDefault();
    setFinalRegStatus({ status: 'loading', message: 'Завершение регистрации...' });

    if (!setupDate) {
      setFinalRegStatus({ status: 'error', message: 'Укажите дату установки кофейни.' });
      return;
    }
    let normalizedAcq = acquiringRate ? normalizeCommission(acquiringRate) : null;
    if (acquiringRate && (normalizedAcq === '' || isNaN(parseFloat(normalizedAcq)))) {
        setFinalRegStatus({ status: 'error', message: 'Комиссия эквайринга должна быть числом, например 2.1' });
        return;
    }
    if (normalizedAcq !== null) normalizedAcq = parseFloat(normalizedAcq);


    try {
      const response = await apiClient.post('/auth/complete-registration', {
        telegram_id: telegramId,
        vendista_api_token: vendistaApiToken,
        setup_date: setupDate,
        tax_system: taxSystem || null, // Send null if empty
        acquiring: normalizedAcq // Send normalized number or null
      });

      if (response.data.success && response.data.token) {
        localStorage.setItem('app_token', response.data.token);
        if (response.data.user) {
          localStorage.setItem('userId', String(response.data.user.userId));
          localStorage.setItem('user_setup_date', response.data.user.setup_date || '');
          localStorage.setItem('user_tax_system', response.data.user.tax_system || '');
          localStorage.setItem('user_acquiring_rate', String(response.data.user.acquiring || '0'));
        }
        setIsAuth(true);
        setFinalRegStatus({ status: 'success', message: 'Регистрация успешно завершена! Перенаправление на дашборд...' });
        setTimeout(() => navigate('/dashboard', { replace: true }), 2000);
      } else {
        setFinalRegStatus({ status: 'error', message: response.data.error || 'Ошибка при завершении регистрации.' });
      }
    } catch (err) {
      setFinalRegStatus({ status: 'error', message: err.response?.data?.error || 'Ошибка сети при завершении регистрации.' });
    }
  };


  if (!telegramId && currentStep !== 0) { // currentStep 0 could be a loading/error state if needed
    return <div className="auth-container"><div className="auth-form-wrapper"><p>Для регистрации необходимо открыть приложение через Telegram.</p></div></div>;
  }


  return (
    <div className="auth-container">
      <div className="auth-form-wrapper">
        <h1>InfoCoffee.ru</h1>
        <p className="auth-welcome-text">Добро пожаловать в сервис аналитики!</p>

        {currentStep === 1 && (
          <>
            <h2>Регистрация: Шаг 1 из 2</h2>
            <p className="auth-step-info">Введите ваши учетные данные от Vendista для подключения.</p>
            <form onSubmit={handleVendistaCredentialsSubmit} className="auth-form">
              <div className="form-field">
                <label htmlFor="vendistaLogin">Логин Vendista</label>
                <input
                  id="vendistaLogin" type="text" value={vendistaLogin}
                  onChange={e => setVendistaLogin(e.target.value)}
                  placeholder="Ваш логин в системе Vendista" required
                />
              </div>
              <div className="form-field">
                <label htmlFor="vendistaPassword">Пароль Vendista</label>
                <input
                  id="vendistaPassword" type="password" value={vendistaPassword}
                  onChange={e => setVendistaPassword(e.target.value)}
                  placeholder="Ваш пароль в системе Vendista" required
                />
              </div>
              <button type="submit" className="auth-button-primary" disabled={vendistaCheckStatus.status === 'loading'}>
                {vendistaCheckStatus.status === 'loading' ? 'Проверка...' : 'Далее'}
              </button>
              {vendistaCheckStatus.message && (
                <div className={`auth-message ${vendistaCheckStatus.status === 'error' ? 'auth-error' : 'auth-success'}`}>
                  {vendistaCheckStatus.message}
                </div>
              )}
            </form>
          </>
        )}

        {currentStep === 2 && (
          <>
            <h2>Регистрация: Шаг 2 из 2</h2>
            <p className="auth-step-info">Укажите детали для более точных расчетов.</p>
            <form onSubmit={handleFinalRegistrationSubmit} className="auth-form">
              <div className="form-field">
                <label htmlFor="setupDate">Дата установки кофейни <span className="required-asterisk">*</span></label>
                <input
                  id="setupDate" type="date" value={setupDate}
                  onChange={e => setSetupDate(e.target.value)} required
                />
              </div>
              <div className="form-field">
                <label>Система налогообложения</label>
                <div className="tax-options-container">
                  {taxOptions.map(opt => (
                    <button
                      type="button" key={opt.value}
                      onClick={() => setTaxSystem(prev => prev === opt.value ? '' : opt.value)}
                      className={`tax-option-btn ${taxSystem === opt.value ? 'active' : ''}`}
                    >{opt.label}</button>
                  ))}
                </div>
              </div>
              <div className="form-field">
                <label htmlFor="acquiringRate">Комиссия эквайринга, %</label>
                <input
                  id="acquiringRate" type="text" value={acquiringRate}
                  onChange={e => setAcquiringRate(e.target.value)}
                  placeholder="Например: 2.1"
                />
                 <small className="form-field-hint">Необязательный шаг. Например, 2.1 (разделитель точка или запятая)</small>
              </div>
              <button type="submit" className="auth-button-primary" disabled={finalRegStatus.status === 'loading'} style={{marginTop: '20px'}}>
                {finalRegStatus.status === 'loading' ? 'Регистрация...' : 'Завершить регистрацию'}
              </button>
              {finalRegStatus.message && (
                <div className={`auth-message ${finalRegStatus.status === 'error' ? 'auth-error' : 'auth-success'}`}>
                  {finalRegStatus.message}
                </div>
              )}
            </form>
          </>
        )}
      </div>
    </div>
  );
}