// frontend/src/components/StockUpModal.js
import React, { useState } from 'react';
import apiClient from '../api';
import './StockUpModal.css';

const INGREDIENTS = ['Кофе', 'Сливки', 'Какао', 'Раф', 'Вода'];
const CONSUMABLES = ['Стаканы', 'Крышки', 'Размеш.', 'Сахар', 'Трубочки'];

const STEPS = {
    kg: ['20', '10', '5', '1', '0.1', '0.01'],
    l: ['38', '19', '10', '5', '2', '1'],
    pcs: ['10000', '5000', '1000', '100', '10', '1'],
};

export default function StockUpModal({ onClose, onSuccess }) {
    const [activeSteps, setActiveSteps] = useState({ kg: '1', l: '1', pcs: '100' });
    const [deltas, setDeltas] = useState({});
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState('');

    const handleStepChange = (type, step) => {
        setActiveSteps(prev => ({ ...prev, [type]: step }));
    };

    const handleAdjust = (itemName, increment) => {
        const itemType = itemName === 'Вода' ? 'l' : (INGREDIENTS.includes(itemName) ? 'kg' : 'pcs');
        const step = parseFloat(activeSteps[itemType]);
    
        setDeltas(prev => {
            const currentDelta = prev[itemName] || 0;
        // Используем Math.max, чтобы не уйти в минус
            const newDelta = Math.max(0, currentDelta + (step * increment)); 
        
        // Для штучных товаров округляем до целого, для остальных - до 3 знаков
            const finalValue = itemType === 'pcs' ? Math.round(newDelta) : parseFloat(newDelta.toFixed(3));

            return { ...prev, [itemName]: finalValue };
        });
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setIsSaving(true);
        setError('');
        
        const itemsToStockUp = Object.entries(deltas)
            .map(([itemName, quantity]) => ({ item_name: itemName, quantity }))
            .filter(item => item.quantity > 0);

        if (itemsToStockUp.length === 0) {
            setError('Добавьте хотя бы один товар.');
            setIsSaving(false);
            return;
        }

        try {
            const response = await apiClient.post('/warehouse/stock-up', { items: itemsToStockUp });
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

    const renderStepSelector = (type, label, steps) => (
        <div className="step-selector-row">
            <h4 className="step-selector-title">{label}</h4>
            <div className="step-selector-buttons">
                {steps.map(step => (
                    <button type="button" key={step}
                        className={`step-btn ${activeSteps[type] === step ? 'active' : ''}`}
                        onClick={() => handleStepChange(type, step)}>
                        {step}
                    </button>
                ))}
            </div>
        </div>
    );

    const renderItemControl = (name) => (
        <div className="item-control" key={name}>
            <span className="item-control-name">{name}</span>
            <div className="item-control-buttons">
                <button type="button" className="adjust-btn-modal minus" onClick={() => handleAdjust(name, -1)}>-</button>
                <span className="item-control-delta">{deltas[name] || 0}</span>
                <button type="button" className="adjust-btn-modal plus" onClick={() => handleAdjust(name, 1)}>+</button>
            </div>
        </div>
    );

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content stock-up-modal-fullscreen" onClick={e => e.stopPropagation()}>
                <form onSubmit={handleSubmit}>
                    <div className="modal-header">
                        <h2>Пополнить склад</h2>
                        <button type="button" className="modal-close-btn" onClick={onClose}>&times;</button>
                    </div>
                    <div className="modal-body">
                        {error && <p className="error-message small">{error}</p>}
                        
                        <div className="step-selectors-container">
                            {renderStepSelector('kg', 'Шаг для Кофе, Сливок, Какао, Раф (кг)', STEPS.kg)}
                            {renderStepSelector('l', 'Шаг для Воды (л)', STEPS.l)}
                            {renderStepSelector('pcs', 'Шаг для Расходников (шт)', STEPS.pcs)}
                        </div>

                        <div className="item-columns-container">
                            <div className="item-column">
                                <h3>Ингредиенты</h3>
                                {INGREDIENTS.map(renderItemControl)}
                            </div>
                            <div className="column-separator"></div>
                            <div className="item-column">
                                <h3>Расходники</h3>
                                {CONSUMABLES.map(renderItemControl)}
                            </div>
                        </div>

                    </div>
                    <div className="modal-footer">
                        <button type="button" className="action-btn secondary" onClick={onClose}>Отмена</button>
                        <button type="submit" className="action-btn" disabled={isSaving}>
                            {isSaving ? 'Сохранение...' : 'Пополнить'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}