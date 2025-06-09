// frontend/src/components/InventoryTransferModal.js
import React, { useState } from 'react';
import apiClient from '../api';
import './Modals.css';

export default function InventoryTransferModal({ moveRequest, onClose, onSuccess }) {
    const { item_name, from, to } = moveRequest;
    const [quantity, setQuantity] = useState('');
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState('');
    
    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!quantity || parseFloat(quantity) <= 0) {
            setError('Введите количество больше нуля.');
            return;
        }
        
        setIsSaving(true);
        setError('');

        try {
            const payload = {
                item_name,
                quantity: parseFloat(quantity),
                from: { location: from.type, terminal_id: from.terminalId },
                to: { location: to.type, terminal_id: to.terminalId },
            };
            const response = await apiClient.post('/inventory/move', payload);
            if (response.data.success) {
                onSuccess();
                onClose();
            } else {
                setError(response.data.error || 'Произошла ошибка.');
            }
        } catch (err) {
            setError(err.response?.data?.error || 'Сетевая ошибка.');
        } finally {
            setIsSaving(false);
        }
    };

    const getPanelName = (panel) => {
        if (panel.type === 'warehouse') return 'Склад';
        return `${panel.terminalName} (${panel.type === 'stand' ? 'Стойка' : 'Кофемашина'})`;
    };
    
    return (
         <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content" style={{ maxWidth: '400px' }} onClick={e => e.stopPropagation()}>
                <form onSubmit={handleSubmit}>
                    <div className="modal-header">
                        <h2>Перемещение: {item_name}</h2>
                        <button type="button" className="modal-close-btn" onClick={onClose}>&times;</button>
                    </div>
                    <div className="modal-body">
                        <p className="transfer-route">
                            <span>Из: <strong>{getPanelName(from)}</strong></span>
                            <span>→</span>
                            <span>В: <strong>{getPanelName(to)}</strong></span>
                        </p>
                        {error && <p className="error-message small">{error}</p>}
                        <div className="transfer-input-group">
                            <label htmlFor="transfer-quantity">Количество:</label>
                            <input
                                id="transfer-quantity"
                                type="number"
                                placeholder="0"
                                value={quantity}
                                onChange={(e) => setQuantity(e.target.value)}
                                autoFocus
                            />
                        </div>
                    </div>
                    <div className="modal-footer">
                        <button type="button" className="action-btn secondary" onClick={onClose}>Отмена</button>
                        <button type="submit" className="action-btn" disabled={isSaving}>
                            {isSaving ? 'Перемещение...' : 'Переместить'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}