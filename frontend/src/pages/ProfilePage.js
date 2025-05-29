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

// Функция для форматирования даты и времени или возврата "нет данных"
function formatSyncTimestamp(timestamp) {
  if (!timestamp) return 'нет данных';
  try {
    const date = new Date(timestamp);
    if (isNaN(date.getTime())) return 'некорректная дата';
    // Формат: ДД.ММ.ГГГГ ЧЧ:мм
    return date.toLocaleString('ru-RU', { 
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit' 
    });
  } catch (e) {
    console.error("Error formatting sync timestamp:", e);
    return 'ошибка форматирования';
  }
}

export default function ProfilePage() {
  const [isLoading, setIsLoading] = useState(true); // Для загрузки основных настроек
  const [isSaving, setIsSaving] = useState(false); // Для процесса сохранения
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  const [setupDate, setSetupDate] = useState('');
  const [currentTaxSystem, setCurrentTaxSystem] = useState('');
  const [currentAcquiringRate, setCurrentAcquiringRate] = useState('');
  const [initialSettings, setInitialSettings] = useState(null);

  const [syncStatus, setSyncStatus] = useState({
    lastTransactionsUpdate: null,
    lastReturnsUpdate: null,
    lastButtonsUpdate: null,
  });
  const [syncStatusLoading, setSyncStatusLoading] = useState(true);
  const [syncStatusError, setSyncStatusError] = useState('');

  const fetchProfileData = useCallback(async () => {
    setIsLoading(true);
    setSyncStatusLoading(true);
    setError('');
    setSyncStatusError('');

    try {
      const settingsResponse = await apiClient.get('/profile/settings');
      if (settingsResponse.data.success && settingsResponse.data.settings) {
        const settings = settingsResponse.data.settings;
        setInitialSettings(settings);
        setSetupDate(settings.setup_date ? formatDateForInput(new Date(settings.setup_date)) : '');
        setCurrentTaxSystem(settings.tax_system || '');
        setCurrentAcquiringRate(settings.acquiring !== null ? String(settings.acquiring) : '');
      } else {
        setError(settingsResponse.data.error || 'Не удалось загрузить настройки профиля.');
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Ошибка сети при загрузке профиля.');
    } finally {
      setIsLoading(false);
    }

    try {
      const syncResponse = await apiClient.get('/profile/sync-status');
      if (syncResponse.data.success && syncResponse.data.syncStatus) {
        setSyncStatus(syncResponse.data.syncStatus);
      } else {
        setSyncStatusError(syncResponse.data.error || 'Не удалось загрузить статус синхронизации.');
      }
    } catch (err) {
      setSyncStatusError(err.response?.data?.error || 'Ошибка сети при загрузке статуса синхронизации.');
    } finally {
      setSyncStatusLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProfileData();
  }, [fetchProfileData]);

  const handleSaveChanges = async (e) => {
    e.preventDefault();
    setError('');
    setSuccessMessage('');
    setIsSaving(true); // Используем isSaving

    let acquiringValueToSend = null;
    if (currentAcquiringRate.trim() !== '') {
        const normalized = normalizeCommissionInput(currentAcquiringRate);
        if (normalized && !isNaN(parseFloat(normalized))) {
            acquiringValueToSend = parseFloat(normalized);
        } else {
            setError('Комиссия эквайринга должна быть числом, например 1.6');
            setIsSaving(false);
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
      if (response.data.success && response.data.settings) {
        setSuccessMessage('Настройки успешно обновлены!');
        const newSettings = response.data.settings;
        localStorage.setItem('user_tax_system', newSettings.tax_system || '');
        localStorage.setItem('user_acquiring_rate', String(newSettings.acquiring || '0'));
        localStorage.setItem('user_setup_date', newSettings.setup_date || '');
        
        setInitialSettings(newSettings);
        setCurrentTaxSystem(newSettings.tax_system || '');
        setCurrentAcquiringRate(newSettings.acquiring !== null ? String(newSettings.acquiring) : '');
        setSetupDate(newSettings.setup_date ? formatDateForInput(new Date(newSettings.setup_date)) : '');

        // Диспатчим событие, чтобы FinancesPage мог обновить расчеты, если открыт
        window.dispatchEvent(new CustomEvent('profileSettingsUpdated'));

      } else {
        setError(response.data.error || 'Не удалось сохранить настройки.');
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Ошибка сети при сохранении настроек.');
    } finally {
      setIsSaving(false);
      setTimeout(() => setSuccessMessage(''), 3000);
    }
  };
  
  const isChanged = () => {
    if (!initialSettings) return true; // Если начальные настройки еще не загружены, считаем, что есть изменения (чтобы кнопка не была задизейблена)
    const initialAcquiring = initialSettings.acquiring !== null ? String(initialSettings.acquiring) : '';
    const initialSetup = initialSettings.setup_date ? formatDateForInput(new Date(initialSettings.setup_date)) : '';

    return (
      setupDate !== initialSetup ||
      currentTaxSystem !== (initialSettings.tax_system || '') ||
      normalizeCommissionInput(currentAcquiringRate) !== normalizeCommissionInput(initialAcquiring)
    );
  };

  if (isLoading) { // Общий лоадер, пока грузятся основные настройки
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
              id="profileSetupDate" type="date" value={setupDate}
              onChange={e => setSetupDate(e.target.value)} className="form-input"
            />
          </div>

          <div className="form-field">
            <label>Система налогообложения</label>
            <div className="tax-options-container">
              {taxOptions.map(opt => (
                <button
                  type="button" key={opt.value}
                  onClick={() => setCurrentTaxSystem(prev => prev === opt.value ? '' : opt.value)}
                  className={`tax-option-btn ${currentTaxSystem === opt.value ? 'active' : ''}`}
                >{opt.label}</button>
              ))}
               <button
                  type="button" onClick={() => setCurrentTaxSystem('')}
                  className={`tax-option-btn clear-btn ${currentTaxSystem === '' ? 'active' : ''}`}
                  title="Сбросить систему налогообложения"
                >Не указана</button>
            </div>
          </div>

          <div className="form-field">
            <label htmlFor="profileAcquiringRate">Комиссия эквайринга, %</label>
            <input
              id="profileAcquiringRate" type="text" value={currentAcquiringRate}
              onChange={e => setCurrentAcquiringRate(e.target.value)}
              placeholder="Например: 2.1" className="form-input"
            />
            <small className="form-field-hint">Например, 2.1 (разделитель точка или запятая). Оставьте пустым, если не применяется.</small>
          </div>
          
          <button 
            type="submit" className="action-btn profile-save-button" 
            disabled={isSaving || !isChanged()} // Дизейблим если сохраняется или нет изменений
          >
            {isSaving ? 'Сохранение...' : 'Сохранить изменения'}
          </button>
        </form>

        <div className="profile-sync-status-card" style={{ marginTop: '30px', background: '#282c34', padding: '20px', borderRadius: '12px'}}>
          <h3 style={{ marginTop: 0, color: '#8ae6ff', marginBottom: '15px'}}>Статус синхронизации данных</h3>
          {syncStatusLoading && <p>Загрузка статуса синхронизации...</p>}
          {syncStatusError && <div className="form-message form-error-message">{syncStatusError}</div>}
          {!syncStatusLoading && !syncStatusError && (
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, fontSize: '0.95em' }}>
              <li style={{ marginBottom: '8px' }}>
                Последнее обновление транзакций: <strong>{formatSyncTimestamp(syncStatus.lastTransactionsUpdate)}</strong>
              </li>
              <li style={{ marginBottom: '8px' }}>
                Последнее обновление возвратов: <strong>{formatSyncTimestamp(syncStatus.lastReturnsUpdate)}</strong>
              </li>
              <li style={{ marginBottom: '8px' }}>
                Последнее обновление товаров (кнопок): <strong>{formatSyncTimestamp(syncStatus.lastButtonsUpdate)}</strong>
              </li>
            </ul>
          )}
        </div>

      </div>
    </div>
  );
}