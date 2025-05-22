// src/components/Navbar.js
import React from 'react';

export default function Navbar({ onLogout }) {
  return (
    <nav style={{ 
      background: '#1a1d24', 
      padding: '10px 20px', 
      color: 'white', 
      display: 'flex', 
      justifyContent: 'space-between', 
      alignItems: 'center' 
    }}>
      <div style={{ fontSize: '1.5em', fontWeight: 'bold' }}>
        MyCoffeeAnalytics
      </div>
      <button 
        onClick={onLogout} 
        style={{
          background: '#3e67e0', 
          color: '#fff', 
          border: 'none', 
          padding: '8px 15px', 
          borderRadius: '5px', 
          cursor: 'pointer'
        }}
      >
        Выход
      </button>
    </nav>
  );
}