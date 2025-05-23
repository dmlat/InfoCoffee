// frontend/src/pages/ProfilePage.js
import React from 'react';
import { formatDateForInput } from '../constants'; // Убедись, что этот файл и функция существуют и импортируются

export default function ProfilePage() {
  const login = localStorage.getItem('vendista_login') || 'не указан';

  const setupDateRaw = localStorage.getItem('setup_date');
  // Добавим проверку, что setupDateRaw не пустая строка и не "null" перед созданием Date
  const installDate = setupDateRaw && setupDateRaw !== "null" && setupDateRaw !== "" 
                      ? formatDateForInput(new Date(setupDateRaw)) 
                      : 'не указана';

  const acquiringRateString = localStorage.getItem('acquiring_rate') || '0';
  const acquiringDisplay = parseFloat(acquiringRateString).toFixed(1);

  const taxSystemRaw = localStorage.getItem('tax_system');
  let taxSystemDisplay = 'не указана';
  if (taxSystemRaw === 'income_6') {
    taxSystemDisplay = 'Доходы 6%';
  } else if (taxSystemRaw === 'income_expense_15') {
    taxSystemDisplay = 'Доходы - Расходы 15%';
  } else if (taxSystemRaw && taxSystemRaw !== "null" && taxSystemRaw !== "") {
    taxSystemDisplay = taxSystemRaw;
  }

  return (
    <div className="page-container" style={{flexDirection: 'column'}}>
        <div className="main-content-area" style={{width: '100%'}}>
            <div style={{ padding: 20, background: '#23272f', borderRadius: '12px', color: '#eee', fontSize: '1.1em' }}>
                <h2>Профиль пользователя</h2>
                <div style={{ fontSize: '16px', marginBottom: '8px' }}>Vendista-логин: <b>{login}</b></div>
                <div style={{ fontSize: '16px', marginBottom: '8px' }}>Дата установки кофейни: <b>{installDate}</b></div>
                <div style={{ fontSize: '16px', marginBottom: '8px' }}>
                  Система налогообложения: <b>{taxSystemDisplay}</b>
                </div>
                <div style={{ fontSize: '16px', marginBottom: '8px' }}>
                  Комиссия эквайринга: <b>{acquiringDisplay}%</b>
                </div>
            </div>
        </div>
    </div>
  );
}