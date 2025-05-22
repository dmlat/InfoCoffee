// src/components/ConfirmModal.js
import React from 'react';

export default function ConfirmModal({ isOpen, message, onConfirm, onCancel, confirmText = 'Да', cancelText = 'Нет' }) {
  if (!isOpen) {
    return null;
  }

  const modalOverlayStyle = {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1000, // Убедимся, что модальное окно поверх всего
  };

  const modalContentStyle = {
    background: '#282c34', // Темный фон
    padding: '25px 30px',
    borderRadius: '12px',
    boxShadow: '0 5px 15px rgba(0, 0, 0, 0.3)',
    color: '#e0e0e0',
    width: 'auto',
    minWidth: '300px',
    maxWidth: '90%',
    textAlign: 'center',
  };

  const messageStyle = {
    marginBottom: '25px',
    fontSize: '1.1em',
    lineHeight: '1.5',
  };

  const buttonContainerStyle = {
    display: 'flex',
    justifyContent: 'space-around', // Равномерно распределяем кнопки
    gap: '15px',
  };
  
  const buttonBaseStyle = {
    padding: '10px 25px',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    fontWeight: '500',
    fontSize: '1em',
    minWidth: '100px',
    transition: 'background-color 0.2s ease',
  };

  return (
    <div style={modalOverlayStyle} onClick={onCancel}> {/* Закрытие по клику на оверлей */}
      <div style={modalContentStyle} onClick={e => e.stopPropagation()}> {/* Предотвращаем закрытие по клику на сам контент */}
        <p style={messageStyle}>{message}</p>
        <div style={buttonContainerStyle}>
          <button 
            onClick={onCancel} 
            style={{...buttonBaseStyle, background: '#4a4f58', color: '#f0f0f0'}}
            onMouseEnter={e => e.currentTarget.style.backgroundColor = '#5a5f68'}
            onMouseLeave={e => e.currentTarget.style.backgroundColor = '#4a4f58'}
          >
            {cancelText}
          </button>
          <button 
            onClick={onConfirm} 
            style={{...buttonBaseStyle, background: '#e06b6b', color: 'white'}} // Красный для подтверждения удаления
            onMouseEnter={e => e.currentTarget.style.backgroundColor = '#f07b7b'}
            onMouseLeave={e => e.currentTarget.style.backgroundColor = '#e06b6b'}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}