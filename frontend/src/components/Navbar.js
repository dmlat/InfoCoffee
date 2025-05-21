import React from 'react';

export default function Navbar({ onLogout }) {
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
      <button onClick={onLogout} style={{ marginLeft: 12 }}>Выйти</button>
    </div>
  );
}
