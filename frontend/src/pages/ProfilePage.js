import React from 'react';

export default function ProfilePage() {
  const login = localStorage.getItem('vendista_login') || 'example@demo.com';
  const installDate = localStorage.getItem('install_date') || '';
  const acqFee = parseFloat(localStorage.getItem('acq_fee')?.replace(',', '.') || '0') / 100;
  const taxType = localStorage.getItem('tax_type') || '6';

  return (
    <div style={{ padding: 28 }}>
      <div style={{ fontSize: 22, fontWeight: 600, marginBottom: 14, color: '#eee' }}>Профиль пользователя</div>
      <div style={{ fontSize: 16, marginBottom: 8 }}>Vendista-логин: <b>{login}</b></div>
      <div style={{ fontSize: 16, marginBottom: 8 }}>Дата установки: <b>{installDate}</b></div>
      <div style={{ fontSize: 16, marginBottom: 8 }}>
        Система налогообложения: <b>
          {taxType === '6' ? 'Доходы 6%' : taxType === '15' ? 'Доходы - Расходы 15%' : '-'}
        </b>
      </div>
      <div style={{ fontSize: 16, marginBottom: 8 }}>
        Комиссия эквайринга: <b>{acqFee}%</b>
      </div>
    </div>
  );
}
