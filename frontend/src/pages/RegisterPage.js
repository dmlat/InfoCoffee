// frontend/src/pages/RegisterPage.js
import React, { useState, useEffect } from 'react';
import apiClient from '../api';
import { useNavigate, useLocation } from 'react-router-dom';
import { saveUserDataToLocalStorage } from '../utils/user';
import { useAuth } from '../App';
import authLogger from '../utils/authLogger';


const taxOptions = [
  { value: 'income_6', label: 'Доходы 6%' },
  { value: 'income_expense_15', label: 'Доходы – Расходы 15%' }
];

function normalizeCommission(input) {
  return String(input).replace(',', '.').replace(/[^0-9.]/g, '');
}

export default function RegisterPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { setAuthenticated } = useAuth();

  const [telegramId, setTelegramId] = useState('');
  const [firstName, setFirstName] = useState('');
  const [username, setUsername] = useState('');
  const [currentStep, setCurrentStep] = useState(1);
  const [registrationStatus, setRegistrationStatus] = useState(''); // 'registration_required' or 'registration_incomplete'

  const [vendistaLogin, setVendistaLogin] = useState('');
  const [vendistaPassword, setVendistaPassword] = useState('');
  const [vendistaApiTokenPlain, setVendistaApiTokenPlain] = useState(''); // Нешифрованный токен Vendista
  const [vendistaCheckStatus, setVendistaCheckStatus] = useState({ status: 'idle', message: '' });

  const [setupDate, setSetupDate] = useState('');
  const [taxSystem, setTaxSystem] = useState('');
  const [acquiringRate, setAcquiringRate] = useState('1.9');
  
  const [finalRegStatus, setFinalRegStatus] = useState({ status: 'idle', message: '' });

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const tgIdFromQuery = params.get('tg_id');
    const statusFromQuery = params.get('status');
    const firstNameFromQuery = params.get('firstName');
    const usernameFromQuery = params.get('username');

    if (tgIdFromQuery) {
      setTelegramId(tgIdFromQuery);
    } else {
      // Если нет tg_id, но есть из localStorage (от старого TelegramLogin или initDataUnsafe)
      const storedTgId = localStorage.getItem('telegram_id_unsafe');
      if (storedTgId) setTelegramId(storedTgId);
      else console.warn("RegisterPage: Telegram ID not found in URL or localStorage.");
    }
    
    setFirstName(firstNameFromQuery || localStorage.getItem('firstName_unsafe') || '');
    setUsername(usernameFromQuery || localStorage.getItem('username_unsafe') || '');
    setRegistrationStatus(statusFromQuery || 'registration_required');
    setCurrentStep(1); // Всегда начинаем с шага 1 при входе на эту страницу

  }, [location.search]);

  const handleVendistaCredentialsSubmit = async (e) => {
    e.preventDefault();
    setVendistaCheckStatus({ status: 'loading', message: 'Проверка учетных данных Vendista...' });
    try {
      const response = await apiClient.post('/auth/validate-vendista', { // Новый эндпоинт
        telegram_id: telegramId, // telegram_id нужен для логов или будущих проверок
        vendista_login: vendistaLogin,
        vendista_password: vendistaPassword
      });
      if (response.data.success && response.data.vendista_api_token_plain) {
        setVendistaApiTokenPlain(response.data.vendista_api_token_plain); // Сохраняем нешифрованный токен
        setVendistaCheckStatus({ status: 'success', message: 'Учетные данные Vendista подтверждены.' });
        setCurrentStep(2);
      } else {
        setVendistaCheckStatus({ status: 'error', message: response.data.error || 'Не удалось проверить учетные данные Vendista.' });
      }
    } catch (err) {
      setVendistaCheckStatus({ status: 'error', message: err.response?.data?.error || 'Ошибка сети при проверке Vendista.' });
    }
  };

  const handleFinalRegistrationSubmit = async (e) => {
    e.preventDefault();
    setFinalRegStatus({ status: 'loading', message: 'Завершение регистрации...' });

    if (!setupDate) {
      setFinalRegStatus({ status: 'error', message: 'Укажите дату установки кофейни.' });
      return;
    }
    
    if (!vendistaApiTokenPlain || !vendistaLogin || !vendistaPassword) {
      setFinalRegStatus({ status: 'error', message: 'Ошибка: отсутствуют данные Vendista. Пожалуйста, вернитесь к первому шагу.' });
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
        vendista_api_token_plain: vendistaApiTokenPlain, // Отправляем нешифрованный токен Vendista
        vendista_login: vendistaLogin, 
        vendista_password: vendistaPassword, 
        setup_date: setupDate,
        tax_system: taxSystem || null,
        acquiring: normalizedAcq,
        first_name: firstName, 
        user_name: username  
      }, {
        timeout: 90000 // Устанавливаем таймаут в 90 секунд только для этого запроса
      });

      if (response.data.success && response.data.token) {
        
        setFinalRegStatus({ status: 'success', message: 'Регистрация успешно завершена! Вход в приложение...' });
        
        // Используем новую функцию для установки состояния без полной перезагрузки
        setAuthenticated(response.data.token, response.data.user);

      } else {
        const errorMessage = response.data.error || 'Ошибка при завершении регистрации.';
        setFinalRegStatus({ status: 'error', message: errorMessage });
        authLogger.error('Registration failed on backend', { response: response.data }, {
            telegramId,
            vendistaLogin
        });
        authLogger.sendAuthErrorToTelegram(
            'Complete Registration Backend Error',
            errorMessage,
            { telegram_id: telegramId, first_name: firstName, user_name: username }
        );
      }
    } catch (err) {
      const errorMessage = err.response?.data?.error || 'Ошибка сети при завершении регистрации.';
      setFinalRegStatus({ status: 'error', message: errorMessage });
      authLogger.error('Registration failed on frontend with network error', err, {
        telegramId,
        vendistaLogin
      });
      authLogger.sendAuthErrorToTelegram(
          'Complete Registration Frontend Network Error',
          errorMessage,
          { telegram_id: telegramId, first_name: firstName, user_name: username }
      );
    }
  };

  if (!telegramId && registrationStatus !== 'pending') {
    console.error('[RegisterPage] CRITICAL: No telegram ID available', {
      telegramId,
      registrationStatus,
      locationSearch: location.search,
      localStorage_telegram_id: localStorage.getItem('telegram_id_unsafe'),
      localStorage_firstName: localStorage.getItem('firstName_unsafe'),
      localStorage_username: localStorage.getItem('username_unsafe'),
      hasInitData: !!window.Telegram?.WebApp?.initData
    });
    
    return (
        <div className="auth-container">
            <div className="auth-form-wrapper">
                <h1>InfoCoffee.ru</h1>
                <p>Ошибка: Не удалось определить ваш Telegram ID. Пожалуйста, откройте приложение снова через вашего Telegram бота.</p>
                {process.env.NODE_ENV === 'development' && (
                  <div style={{marginTop: '20px', padding: '10px', background: '#f5f5f5', fontSize: '12px'}}>
                    <strong>Debug info:</strong><br/>
                    Location search: {location.search}<br/>
                    localStorage telegram_id: {localStorage.getItem('telegram_id_unsafe')}<br/>
                    Registration status: {registrationStatus}
                  </div>
                )}
            </div>
        </div>
    );
  }

  return (
    <div className="auth-container">
      <div className="auth-form-wrapper">
        <h1>InfoCoffee.ru</h1>
        <p className="auth-welcome-text">
          {firstName ? `Привет, ${firstName}! ` : 'Добро пожаловать! '} 
          {registrationStatus === 'registration_incomplete' 
            ? 'Завершите настройку вашего аккаунта.' 
            : 'Давайте настроим ваш аккаунт.'}
        </p>

        {currentStep === 1 && (
          <>
            <h2>Регистрация: Шаг 1 из 2</h2>
            <p className="auth-step-info">Введите ваши учетные данные от Vendista для подключения.</p>
            <form onSubmit={handleVendistaCredentialsSubmit} className="auth-form">
              <div className="form-field">
                <label htmlFor="vendistaLogin">Логин Vendista</label>
                <input id="vendistaLogin" type="text" value={vendistaLogin}
                  onChange={e => setVendistaLogin(e.target.value)}
                  placeholder="Логин в системе Vendista" required autoComplete="username" />
              </div>
              <div className="form-field">
                <label htmlFor="vendistaPassword">Пароль Vendista</label>
                <input id="vendistaPassword" type="password" value={vendistaPassword}
                  onChange={e => setVendistaPassword(e.target.value)}
                  placeholder="Пароль в системе Vendista" required autoComplete="current-password"/>
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
                <input id="setupDate" type="date" value={setupDate}
                  onChange={e => setSetupDate(e.target.value)} required />
              </div>
              <div className="form-field">
                <label>Система налогообложения</label>
                <div className="tax-options-container">
                  {taxOptions.map(opt => (
                    <button type="button" key={opt.value}
                      onClick={() => setTaxSystem(prev => prev === opt.value ? '' : opt.value)}
                      className={`tax-option-btn ${taxSystem === opt.value ? 'active' : ''}`}
                    >{opt.label}</button>
                  ))}
                </div>
              </div>
              <div className="form-field">
                <label htmlFor="acquiringRate">Комиссия эквайринга, %</label>
                <input id="acquiringRate" type="text" value={acquiringRate}
                  onChange={e => setAcquiringRate(e.target.value)}
                  placeholder="Например: 1.9" />
                 <small className="form-field-hint">Необязательный шаг. Пример: 2,1 (через точку или запятую)</small>
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