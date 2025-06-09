// frontend/src/components/StockUpModal.js
import React, { useState } from 'react';
import apiClient from '../api';
import './Modals.css'; // Общие стили для модальных окон

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
            newItems[index][field] = value.replace(',', '.').replace(/[^0-9.]/g, '');
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
        const currentVal = parseFloat(newItems[index].quantity) || 0;
        newItems[index].quantity = String(currentVal + amount);
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
            let finalQuantity = parseFloat(item.quantity);
            if (!item.itemName || isNaN(finalQuantity) || finalQuantity <= 0) return null;

            // Конвертируем кг и л в граммы и мл для бэкенда
            const unit = getUnitForPlaceholder(item.itemName);
            if (unit === 'кг' || unit === 'л') {
                finalQuantity *= 1000;
            }
            return { itemName: item.itemName, quantity: finalQuantity };
        }).filter(Boolean); // Отфильтровываем null

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
            <div className="modal-content" onClick={e => e.stopPropagation()}>
                <form onSubmit={handleSubmit}>
                    <div className="modal-header">
                        <h2>Приходовать товар на склад</h2>
                        <button type="button" className="modal-close-btn" onClick={onClose}>&times;</button>
                    </div>
                    <div className="modal-body">
                        {error && <p className="error-message small">{error}</p>}
                        {items.map((item, index) => {
                            const unit = getUnitForPlaceholder(item.itemName);
                            let quickAddAmounts = [1000, 500, 100]; // Для шт
                            if (unit === 'кг') quickAddAmounts = [1, 0.1, 0.01];
                            if (unit === 'л') quickAddAmounts = [19, 5, 1];
                            
                            return (
                                <div className="stock-up-item-container" key={index}>
                                    <div className="stock-up-item-row">
                                        <select value={item.itemName} onChange={(e) => handleItemChange(index, 'itemName', e.target.value)}>
                                            {INVENTORY_ITEMS.map(name => <option key={name} value={name}>{name}</option>)}
                                        </select>
                                        <input
                                            type="text" // Используем text для гибкого ввода с запятой
                                            inputMode="decimal" // Подсказка для мобильных
                                            placeholder={`Кол-во, ${unit}`}
                                            value={item.quantity}
                                            onChange={(e) => handleItemChange(index, 'quantity', e.target.value)}
                                        />
                                        <button type="button" className="remove-item-btn" onClick={() => handleRemoveItem(index)}>&times;</button>
                                    </div>
                                    <div className="quick-add-buttons stock-up-quick-add">
                                        {quickAddAmounts.map(amount => (
                                            <button key={amount} type="button" onClick={() => handleAddQuantity(index, amount)}>+{amount}</button>
                                        ))}
                                        <button type="button" onClick={() => handleItemChange(index, 'quantity', '')}>Обнулить</button>
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