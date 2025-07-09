// src/components/ConfirmModal.js
import React from 'react';
import './ConfirmModal.css';

export default function ConfirmModal({ isOpen, message, onConfirm, onCancel, confirmText = 'Да', cancelText = 'Нет' }) {
  if (!isOpen) {
    return null;
  }

  return (
    <div className="confirm-modal-overlay" onClick={onCancel}>
      <div className="confirm-modal-content" onClick={e => e.stopPropagation()}>
        <p className="confirm-modal-message">{message}</p>
        <div className="confirm-modal-buttons">
          <button 
            onClick={onCancel} 
            className="confirm-modal-btn cancel"
          >
            {cancelText}
          </button>
          <button 
            onClick={onConfirm} 
            className="confirm-modal-btn confirm"
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}