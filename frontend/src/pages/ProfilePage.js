// src/pages/ProfilePage.js
import React from 'react';

export default function ProfilePage() {
  // Твоя логика получения данных из localStorage
  const login = localStorage.getItem('vendista_login') || 'example@demo.com';
  const installDate = localStorage.getItem('install_date') || 'не указана';
  const acqFeeString = localStorage.getItem('acq_fee');
  const acqRateDecimal = parseFloat(acqFeeString?.replace(',', '.') || '0');
  const acqFeeDisplay = isNaN(acqRateDecimal) ? '0.0' : (acqRateDecimal * 100).toFixed(1);
  const taxType = localStorage.getItem('tax_type') || 'не указана';

  return (
    // Используем классы для консистентного отображения и адаптивности
    <div className="page-container" style={{flexDirection: 'column'}}>
        <div className="main-content-area" style={{width: '100%'}}>
            <div style={{ padding: 20, background: '#23272f', borderRadius: '12px', color: '#eee', fontSize: '1.1em' }}>
                <h2>Профиль пользователя</h2>
                <div style={{ fontSize: 16, marginBottom: 8 }}>Vendista-логин: <b>{login}</b></div>
                <div style={{ fontSize: 16, marginBottom: 8 }}>Дата установки: <b>{installDate}</b></div>
                <div style={{ fontSize: 16, marginBottom: 8 }}>
                  Система налогообложения: <b>
                    {taxType === '6' ? 'Доходы 6%' : 
                     taxType === '15' ? 'Доходы - Расходы 15%' : 
                     taxType !== 'не указана' ? taxType : 'не указана'}
                  </b>
                </div>
                <div style={{ fontSize: 16, marginBottom: 8 }}>
                  Комиссия эквайринга: <b>{acqFeeDisplay}%</b>
                </div>
                {/* Добавь сюда другие данные профиля, которые мы сохраняем */}
            </div>
        </div>
    </div>
  );
}