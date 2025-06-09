// frontend/src/components/QuickTransferModal.js
import React, { useState, useMemo } from 'react';
import apiClient from '../api';
import './QuickTransferModal.css';

const GRAMS_ITEMS = ['Кофе', 'Сливки', 'Какао', 'Раф'];

export default function QuickTransferModal({ moveRequest, onClose, onSuccess }) {
    const { item_name, from, to } = moveRequest;
    const [quantity, setQuantity] = useState('');
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState('');

    const unitInfo = useMemo(() => {
        if (GRAMS_ITEMS.includes(item_name)) return { name: 'граммах', short: 'г' };
        if (item_name === 'Вода') return { name: 'миллилитрах', short: 'мл' };
        return { name: 'штуках', short: 'шт' };
    }, [item_name]);

    const handleSubmit = async (e) => {
        e.preventDefault();
        const numQuantity = parseFloat(quantity);

        if (!numQuantity || numQuantity <= 0) {
            setError('Введите количество больше нуля.');
            return;
        }

        setIsSaving(true);
        setError('');

        try {
            const payload = {
                item_name,
                quantity: numQuantity,
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
        return `${panel.terminalName || `Стойка #${panel.terminalId}`}`;
    };

    const addQuantity = (amount) => {
        setQuantity(prev => (Number(prev) || 0) + amount);
    };

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content quick-transfer-modal" onClick={e => e.stopPropagation()}>
                <form onSubmit={handleSubmit}>
                    <div className="modal-header">
                        <h2>Перемещение: {item_name}</h2>
                        <button type="button" className="modal-close-btn" onClick={onClose}>&times;</button>
                    </div>
                    <div className="modal-body">
                        <p className="quick-transfer-hint">
                            Остатки <span className="highlight">{item_name}</span> считаются в <span className="highlight">{unitInfo.name}</span>.
                        </p>
                        
                        <div className="quick-transfer-input-group">
                            <label htmlFor="transfer-quantity">Количество ({unitInfo.short})</label>
                            <input
                                id="transfer-quantity"
                                type="number"
                                placeholder="0"
                                value={quantity}
                                onChange={(e) => setQuantity(e.target.value)}
                                autoFocus
                            />
                        </div>

                        <div className="quick-add-buttons">
                            <button type="button" onClick={() => addQuantity(1000)}>+1000</button>
                            <button type="button" onClick={() => addQuantity(100)}>+100</button>
                            <button type="button" onClick={() => addQuantity(10)}>+10</button>
                            <button type="button" onClick={() => setQuantity('')}>Сброс</button>
                        </div>
                        
                        {error && <p className="error-message small">{error}</p>}
                    </div>
                    <div className="modal-footer column">
                        <p className="preview-text">
                           Переместить из <strong>{getPanelName(from)}</strong> в <strong>{getPanelName(to)}</strong>: {quantity || 0} {unitInfo.short} <strong>{item_name}</strong>
                        </p>
                        <button type="submit" className="action-btn confirm-btn" disabled={isSaving || !quantity}>
                            {isSaving ? 'Перемещение...' : 'Подтвердить'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}