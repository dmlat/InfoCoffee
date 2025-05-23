// frontend/src/pages/ProfilePage.js
import React from 'react';
import { formatDateForInput } from '../constants'; // Если дата в другом формате

export default function ProfilePage() {
  const login = localStorage.getItem('vendista_login') || 'не указан';

  // Получаем дату установки и форматируем, если нужно
  const setupDateRaw = localStorage.getItem('setup_date');
  const installDate = setupDateRaw ? formatDateForInput(new Date(setupDateRaw)) : 'не указана';

  // Получаем процент эквайринга (из БД он приходит как "1.6" для 1.6%)
  const acquiringRateString = localStorage.getItem('acquiring_rate') || '0';
  const acquiringDisplay = parseFloat(acquiringRateString).toFixed(1); // Просто отображаем как есть, добавив .0 если целое

  // Получаем систему налогообложения (из БД приходит 'income_6' или 'income_expense_15')
  const taxSystemRaw = localStorage.getItem('tax_system');
  let taxSystemDisplay = 'не указана';
  if (taxSystemRaw === 'income_6') {
    taxSystemDisplay = 'Доходы 6%';
  } else if (taxSystemRaw === 'income_expense_15') {
    taxSystemDisplay = 'Доходы - Расходы 15%';
  } else if (taxSystemRaw) {
    taxSystemDisplay = taxSystemRaw; // На случай других значений
  }

  return (
    <div className="page-container" style={{flexDirection: 'column'}}>
        <div className="main-content-area" style={{width: '100%'}}>
            <div style={{ padding: 20, background: '#23272f', borderRadius: '12px', color: '#eee', fontSize: '1.1em' }}>
                <h2>Профиль пользователя</h2>
                <div style={{ fontSize: 16, marginBottom: 8 }}>Vendista-логин: <b>{login}</b></div>
                <div style={{ fontSize: 16, marginBottom: 8 }}>Дата установки кофейни: <b>{installDate}</b></div>
                <div style={{ fontSize: 16, marginBottom: 8 }}>
                  Система налогообложения: <b>{taxSystemDisplay}</b>
                </div>
                <div style={{ fontSize: 16, marginBottom: 8 }}>
                  Комиссия эквайринга: <b>{acquiringDisplay}%</b>
                </div>
            </div>
        </div>
    </div>
  );
}