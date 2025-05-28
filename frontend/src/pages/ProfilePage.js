// frontend/src/pages/ProfilePage.js
import React, { useState, useEffect, useCallback } from 'react';
import apiClient from '../api';
import { formatDateForInput } from '../constants';

const taxOptions = [
  { value: 'income_6', label: 'Доходы 6%' },
  { value: 'income_expense_15', label: 'Доходы – Расходы 15%' }
];

function normalizeCommissionInput(input) {
  return String(input).replace(',', '.').replace(/[^0-9.]/g, '');
}

export default function ProfilePage() {
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  const [setupDate, setSetupDate] = useState('');
  const [currentTaxSystem, setCurrentTaxSystem] = useState('');
  const [currentAcquiringRate, setCurrentAcquiringRate] = useState('');

  const [initialSettings, setInitialSettings] = useState(null);


  const fetchProfileSettings = useCallback(async () => {
    setIsLoading(true);
    setError('');
    try {
      const response = await apiClient.get('/profile/settings');
      if (response.data.success && response.data.settings) {
        const settings = response.data.settings;
        setInitialSettings(settings); // Store initial settings
        setSetupDate(settings.setup_date ? formatDateForInput(new Date(settings.setup_date)) : '');
        setCurrentTaxSystem(settings.tax_system || '');
        setCurrentAcquiringRate(settings.acquiring !== null ? String(settings.acquiring) : '');
      } else {
        setError(response.data.error || 'Не удалось загрузить настройки профиля.');
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Ошибка сети при загрузке профиля.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProfileSettings();
  }, [fetchProfileSettings]);

  const handleSaveChanges = async (e) => {
    e.preventDefault();
    setError('');
    setSuccessMessage('');
    setIsLoading(true);

    let acquiringValueToSend = null;
    if (currentAcquiringRate.trim() !== '') {
        const normalized = normalizeCommissionInput(currentAcquiringRate);
        if (normalized && !isNaN(parseFloat(normalized))) {
            acquiringValueToSend = parseFloat(normalized);
        } else {
            setError('Комиссия эквайринга должна быть числом, например 1.6');
            setIsLoading(false);
            return;
        }
    }
    
    const payload = {
      tax_system: currentTaxSystem || null,
      acquiring: acquiringValueToSend,
      setup_date: setupDate || null
    };

    try {
      const response = await apiClient.post('/profile/settings', payload);
      if (response.data.success) {
        setSuccessMessage('Настройки успешно обновлены!');
        // Update localStorage to reflect changes immediately for FinancesPage
        localStorage.setItem('user_tax_system', response.data.settings.tax_system || '');
        localStorage.setItem('user_acquiring_rate', String(response.data.settings.acquiring || '0'));
        localStorage.setItem('user_setup_date', response.data.settings.setup_date || '');
        
        // Update state to reflect saved values, especially for formatting (e.g. acquiring)
        setInitialSettings(response.data.settings); // Update initial settings to current saved state
        setCurrentTaxSystem(response.data.settings.tax_system || '');
        setCurrentAcquiringRate(response.data.settings.acquiring !== null ? String(response.data.settings.acquiring) : '');
        setSetupDate(response.data.settings.setup_date ? formatDateForInput(new Date(response.data.settings.setup_date)) : '');

      } else {
        setError(response.data.error || 'Не удалось сохранить настройки.');
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Ошибка сети при сохранении настроек.');
    } finally {
      setIsLoading(false);
      setTimeout(() => setSuccessMessage(''), 3000); // Clear success message after 3s
    }
  };
  
  const isChanged = () => {
    if (!initialSettings) return false; // No initial data to compare against
    const initialAcquiring = initialSettings.acquiring !== null ? String(initialSettings.acquiring) : '';
    const initialSetup = initialSettings.setup_date ? formatDateForInput(new Date(initialSettings.setup_date)) : '';

    return (
      setupDate !== initialSetup ||
      currentTaxSystem !== (initialSettings.tax_system || '') ||
      normalizeCommissionInput(currentAcquiringRate) !== normalizeCommissionInput(initialAcquiring)
    );
  };


  if (isLoading && !initialSettings) { // Show loader only on initial full load
    return <div className="page-container page-loading"><span>Загрузка профиля...</span></div>;
  }
  
  return (
    <div className="page-container profile-page-container">
      <div className="main-content-area">
        <form onSubmit={handleSaveChanges} className="profile-form">
          <h2>Настройки профиля</h2>
          
          {error && <div className="form-message form-error-message">{error}</div>}
          {successMessage && <div className="form-message form-success-message">{successMessage}</div>}

          <div className="form-field">
            <label htmlFor="profileSetupDate">Дата установки кофейни</label>
            <input
              id="profileSetupDate"
              type="date"
              value={setupDate}
              onChange={e => setSetupDate(e.target.value)}
              className="form-input"
            />
          </div>

          <div className="form-field">
            <label>Система налогообложения</label>
            <div className="tax-options-container">
              {taxOptions.map(opt => (
                <button
                  type="button"
                  key={opt.value}
                  onClick={() => setCurrentTaxSystem(prev => prev === opt.value ? '' : opt.value)}
                  className={`tax-option-btn ${currentTaxSystem === opt.value ? 'active' : ''}`}
                >
                  {opt.label}
                </button>
              ))}
               <button // Button to clear selection
                  type="button"
                  onClick={() => setCurrentTaxSystem('')}
                  className={`tax-option-btn clear-btn ${currentTaxSystem === '' ? 'active' : ''}`}
                  title="Сбросить систему налогообложения"
                >
                  Не указана
                </button>
            </div>
          </div>

          <div className="form-field">
            <label htmlFor="profileAcquiringRate">Комиссия эквайринга, %</label>
            <input
              id="profileAcquiringRate"
              type="text"
              value={currentAcquiringRate}
              onChange={e => setCurrentAcquiringRate(e.target.value)}
              placeholder="Например: 2.1"
              className="form-input"
            />
            <small className="form-field-hint">Например, 2.1 (разделитель точка или запятая). Оставьте пустым, если не применяется.</small>
          </div>
          
          <button 
            type="submit" 
            className="action-btn profile-save-button" 
            disabled={isLoading || !isChanged()}
          >
            {isLoading ? 'Сохранение...' : 'Сохранить изменения'}
          </button>
        </form>
      </div>
    </div>
  );
}