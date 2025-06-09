// frontend/src/components/StockUpModal.js
import React, { useState } from 'react';
import apiClient from '../api';
import './Modals.css'; // Общие стили для модальных окон

const INVENTORY_ITEMS = ['Кофе', 'Сливки', 'Какао', 'Раф', 'Вода', 'Стаканы', 'Крышки', 'Размешиватели', 'Сахар'];

export default function StockUpModal({ onClose, onSuccess }) {
    const [items, setItems] = useState([{ itemName: 'Кофе', quantity: '' }]);
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState('');

    const handleItemChange = (index, field, value) => {
        const newItems = [...items];
        newItems[index][field] = value;
        setItems(newItems);
    };

    const handleAddItem = () => {
        setItems([...items, { itemName: 'Кофе', quantity: '' }]);
    };

    const handleRemoveItem = (index) => {
        const newItems = items.filter((_, i) => i !== index);
        setItems(newItems);
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setIsSaving(true);
        setError('');
        
        const itemsToStockUp = items.filter(item => item.itemName && parseFloat(item.quantity) > 0);
        if (itemsToStockUp.length === 0) {
            setError('Добавьте хотя бы один товар с количеством больше нуля.');
            setIsSaving(false);
            return;
        }

        try {
            const response = await apiClient.post('/warehouse/stock-up', { items: itemsToStockUp });
            if (response.data.success) {
                onSuccess(); // Вызываем колбэк для обновления данных на основной странице
                onClose();     // Закрываем окно
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
                        {items.map((item, index) => (
                            <div className="stock-up-item-row" key={index}>
                                <select value={item.itemName} onChange={(e) => handleItemChange(index, 'itemName', e.target.value)}>
                                    {INVENTORY_ITEMS.map(name => <option key={name} value={name}>{name}</option>)}
                                </select>
                                <input
                                    type="number"
                                    placeholder="Кол-во"
                                    value={item.quantity}
                                    onChange={(e) => handleItemChange(index, 'quantity', e.target.value)}
                                />
                                <button type="button" className="remove-item-btn" onClick={() => handleRemoveItem(index)}>&ndash;</button>
                            </div>
                        ))}
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