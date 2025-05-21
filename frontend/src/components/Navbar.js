import React from 'react';

export default function Navbar({ onLogout }) {
  // Обработка логаута — удаляет все пользовательские данные
  const handleLogout = () => {
    localStorage.clear(); // Полностью очищает localStorage от всех пользовательских данных
    if (onLogout) onLogout();
    else window.location.href = '/login';
  };

  return (
    <div style={{
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: '18px 36px',
      background: '#23272f',
      borderBottom: '1px solid #282c34'
    }}>
      <div style={{ fontWeight: 'bold', fontSize: 20 }}>☕ Coffee Analytics</div>
      <button
        onClick={handleLogout}
        style={{
          marginLeft: 12,
          background: '#3e67e0',
          color: '#fff',
          border: 'none',
          borderRadius: 8,
          padding: '8px 22px',
          fontWeight: 500,
          cursor: 'pointer'
        }}
      >
        Выйти
      </button>
    </div>
  );
}
