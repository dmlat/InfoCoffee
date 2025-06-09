// frontend/src/components/StockUpModal.js
import React, { useState } from 'react';
import apiClient from '../api';
import './Modals.css'; // Общие стили для оверлея, хедера и футера
import './StockUpModal.css'; // Новые стили для контента этого модального окна

const INVENTORY_ITEMS = ['Кофе', 'Сливки', 'Какао', 'Раф', 'Вода', 'Стаканы', 'Крышки', 'Размешиватели', 'Сахар'];
const WEIGHT_ITEMS = ['Кофе', 'Сливки', 'Какао', 'Раф'];

const getUnitForPlaceholder = (itemName) => {
    if (WEIGHT_ITEMS.includes(itemName)) return 'кг';
    if (itemName === 'Вода') return 'л';
    return 'шт';
};

export default function StockUpModal({ onClose, onSuccess }) {
    const [items, setItems] = useState([{ itemName: 'Кофе', quantity: '' }]);
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState('');

    const handleItemChange = (index, field, value) => {
        const newItems = [...items];
        if (field === 'quantity') {
            newItems[index][field] = value.replace(/[^0-9,.]/g, '');
        } else {
            newItems[index][field] = value;
        }
        setItems(newItems);
    };

    const handleAddItem = () => {
        const nextItem = INVENTORY_ITEMS.find(invItem => !items.some(i => i.itemName === invItem)) || 'Кофе';
        setItems([...items, { itemName: nextItem, quantity: '' }]);
    };
    
    const handleAddQuantity = (index, amount) => {
        const newItems = [...items];
        const currentItem = newItems[index];
        const currentVal = parseFloat(String(currentItem.quantity).replace(',', '.')) || 0;
        const unit = getUnitForPlaceholder(currentItem.itemName);
        
        const precision = (unit === 'кг' || unit === 'л') ? 3 : 0;
        
        let newVal = (currentVal + amount);
        
        newItems[index].quantity = String(parseFloat(newVal.toFixed(precision)));
        
        setItems(newItems);
    };

    const handleRemoveItem = (index) => {
        const newItems = items.filter((_, i) => i !== index);
        setItems(newItems);
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setIsSaving(true);
        setError('');
        
        const itemsToStockUp = items.map(item => {
            const normalizedQuantity = String(item.quantity).replace(',', '.');
            let finalQuantity = parseFloat(normalizedQuantity);
            if (!item.itemName || isNaN(finalQuantity) || finalQuantity <= 0) return null;

            return { item_name: item.itemName, quantity: finalQuantity };
        }).filter(Boolean);

        if (itemsToStockUp.length === 0) {
            setError('Добавьте хотя бы один товар с количеством больше нуля.');
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

    return (
        <div className="modal-overlay" onClick={onClose}>
            {/* Добавляем специфичный класс к modal-content */}
            <div className="modal-content stock-up-modal" onClick={e => e.stopPropagation()}>
                <form onSubmit={handleSubmit}>
                    <div className="modal-header">
                        <h2>Приходовать товар на склад</h2>
                        <button type="button" className="modal-close-btn" onClick={onClose}>&times;</button>
                    </div>
                    <div className="modal-body">
                        {error && <p className="error-message small">{error}</p>}
                        {items.map((item, index) => {
                            const unit = getUnitForPlaceholder(item.itemName);
                            let quickAddAmounts = [1000, 500, 100, 10];
                            if (unit === 'кг') quickAddAmounts = [1, 0.5, 0.1, 0.01];
                            if (unit === 'л') quickAddAmounts = [19, 5, 1, 0.5];
                            
                            return (
                                <div className="stock-up-item-container" key={index}>
                                    <div className="stock-up-item-row">
                                        <select value={item.itemName} onChange={(e) => handleItemChange(index, 'itemName', e.target.value)}>
                                            {INVENTORY_ITEMS.map(name => <option key={name} value={name}>{name}</option>)}
                                        </select>
                                        <input
                                            type="text"
                                            inputMode="decimal"
                                            placeholder={`Кол-во, ${unit}`}
                                            value={item.quantity}
                                            onChange={(e) => handleItemChange(index, 'quantity', e.target.value)}
                                        />
                                        <button type="button" className="remove-item-btn" onClick={() => handleRemoveItem(index)} title="Удалить строку">&times;</button>
                                    </div>
                                    <div className="stock-up-quick-add">
                                        {quickAddAmounts.map(amount => (
                                            <button key={amount} type="button" onClick={() => handleAddQuantity(index, amount)}>+{amount} {unit}</button>
                                        ))}
                                    </div>
                                </div>
                            );
                        })}
                        <button type="button" className="add-item-btn" onClick={handleAddItem}>+ Добавить позицию</button>
                    </div>
                    <div className="modal-footer">
                        <button type="button" className="action-btn secondary" onClick={onClose}>Отмена</button>
                        <button type="submit" className="action-btn" disabled={isSaving}>
                            {isSaving ? 'Сохранение...' : 'Сохранить'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}