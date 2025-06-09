// frontend/src/components/QuickTransferModal.js
import React, { useState, useMemo } from 'react';
import apiClient from '../api';
import './ModalFrame.css'; // Используем новую "раму"
import './QuickTransferModal.css';

const GRAMS_ITEMS = ['Кофе', 'Сливки', 'Какао', 'Раф'];
const ML_ITEMS = ['Вода'];

export default function QuickTransferModal({ moveRequest, onClose, onSuccess }) {
    const { item_name, currentStock, from, to } = moveRequest;
    const [quantity, setQuantity] = useState('');
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState('');

    const unitInfo = useMemo(() => {
        if (GRAMS_ITEMS.includes(item_name)) return { name: 'килограммах', short: 'кг', multiplier: 1000, buttons: [1, 0.5, 0.1, 0.05] };
        if (ML_ITEMS.includes(item_name)) return { name: 'литрах', short: 'л', multiplier: 1000, buttons: [5, 1, 0.5, 0.1] };
        return { name: 'штуках', short: 'шт', multiplier: 1, buttons: [100, 50, 10, 1] };
    }, [item_name]);

    const availableStock = useMemo(() => {
        return parseFloat((currentStock / unitInfo.multiplier).toFixed(3));
    }, [currentStock, unitInfo]);

    const handleSubmit = async (e) => {
        e.preventDefault();
        const numQuantity = parseFloat(String(quantity).replace(',', '.'));

        if (!numQuantity || numQuantity <= 0) {
            setError('Введите количество больше нуля.');
            return;
        }

        if (numQuantity > availableStock) {
            setError(`Нельзя переместить больше, чем есть в источнике (${availableStock} ${unitInfo.short}).`);
            return;
        }

        setIsSaving(true);
        setError('');

        try {
            const payloadQuantity = numQuantity * unitInfo.multiplier;

            const payload = {
                item_name,
                quantity: payloadQuantity,
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
        const currentVal = parseFloat(String(quantity).replace(',', '.')) || 0;
        const precision = unitInfo.multiplier > 1 ? 3 : 0;
        let newVal = parseFloat((currentVal + amount).toFixed(precision));
        setQuantity(String(newVal));
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
                            Введите количество для перемещения в <span className="highlight">{unitInfo.name}</span>.
                        </p>
                        
                        <div className="quick-transfer-input-group">
                            <label htmlFor="transfer-quantity">
                                Количество <span className="highlight">({unitInfo.short})</span>, 
                                доступно: <span className="highlight">{availableStock}</span>
                            </label>
                            <input
                                id="transfer-quantity"
                                type="text"
                                inputMode="decimal"
                                placeholder="0"
                                value={quantity}
                                onChange={(e) => setQuantity(e.target.value.replace(/[^0-9,.]/g, ''))}
                            />
                        </div>

                        <div className="quick-add-buttons">
                            {unitInfo.buttons.map(amount => (
                                <button key={amount} type="button" onClick={() => addQuantity(amount)}>+{amount}</button>
                            ))}
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