// frontend/src/components/StandDetailModal.js
import React, { useState, useEffect } from 'react';
import apiClient from '../api'; // Теперь будет использоваться
import './StandDetailModal.css';

const ProgressBar = ({ value, max }) => {
    // Проверка, что value и max - валидные числа
    const numericValue = parseFloat(value) || 0;
    const numericMax = parseFloat(max) || 0;
    
    const percentage = numericMax > 0 ? (numericValue / numericMax) * 100 : 0;
    let barColorClass = 'normal';
    if (percentage < 25) barColorClass = 'low';
    if (percentage < 10) barColorClass = 'critical';

    return (
        <div className="progress-bar-container">
            <div className={`progress-bar-fill ${barColorClass}`} style={{ width: `${Math.min(percentage, 100)}%` }}></div>
        </div>
    );
};

export default function StandDetailModal({ terminal, onClose }) {
    const [activeTab, setActiveTab] = useState('stock');
    const [details, setDetails] = useState({ inventory: [], recipes: [], settings: {} });
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState('');

    useEffect(() => {
        const vendistaId = terminal.id;
        if (!vendistaId) return;

        const fetchDetails = async () => {
            setIsLoading(true);
            setError('');
            try {
                // Используем реальный API-вызов
                const response = await apiClient.get(`/terminals/vendista/${vendistaId}/details`, {
                    // Передаем name и serial_number в query, чтобы бэкенд мог создать запись при необходимости
                    params: {
                        name: terminal.comment,
                        serial_number: terminal.serial_number
                    }
                });

                if (response.data.success) {
                    setDetails(response.data.details);
                } else {
                    setError(response.data.error || 'Не удалось загрузить данные.');
                }
                
            } catch (err) {
                setError(err.response?.data?.error || 'Ошибка сети при загрузке деталей стойки.');
            } finally {
                setIsLoading(false);
            }
        };

        fetchDetails();
    }, [terminal.id, terminal.comment, terminal.serial_number]);

    const renderStock = () => {
        const machineItems = details.inventory.filter(i => i.location === 'machine');
        const standItems = details.inventory.filter(i => i.location === 'stand');
        
        // Отображаем сообщение, если остатки еще не настроены
        if (details.inventory.length === 0) {
            return (
                 <div className="modal-tab-content placeholder-text">
                    <p>Остатки для этой стойки еще не настроены.</p>
                    <p>Перейдите на вкладку "Настройки", чтобы задать параметры контейнеров и запасов.</p>
                </div>
            )
        }

        return (
            <div className="modal-tab-content">
                <div className="inventory-section">
                    <h4>Контейнеры кофемашины</h4>
                    {machineItems.length > 0 ? machineItems.map(item => (
                        <div key={item.item_name} className="inventory-item">
                            <span className="item-name">{item.item_name}</span>
                            <div className="item-details">
                                <ProgressBar value={item.current_stock} max={item.max_stock} />
                                <span className="item-stock-label">
                                    {parseFloat(item.current_stock) || 0} / {parseFloat(item.max_stock) || 0} г
                                </span>
                            </div>
                        </div>
                    )) : <p className="placeholder-text-small">Нет данных по остаткам в кофемашине.</p>}
                </div>
                <div className="inventory-section">
                    <h4>Запасы в стойке</h4>
                     {standItems.length > 0 ? standItems.map(item => (
                        <div key={item.item_name} className="inventory-item">
                            <span className="item-name">{item.item_name}</span>
                            <div className="item-details simple">
                               <span>Остаток: <strong>{parseFloat(item.current_stock) || 0} шт.</strong></span>
                               (Крит: {parseFloat(item.critical_stock) || 0} шт.)
                            </div>
                        </div>
                    )) : <p className="placeholder-text-small">Нет данных по запасам в стойке.</p>}
                </div>
            </div>
        );
    };

    const renderRecipes = () => <div className="modal-tab-content"><p><i>Раздел "Рецепты" в разработке.</i></p></div>;
    const renderSettings = () => <div className="modal-tab-content"><p><i>Раздел "Настройки" в разработке.</i></p></div>;

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>{terminal.comment || `Терминал #${terminal.id}`}</h2>
                    <button className="modal-close-btn" onClick={onClose}>&times;</button>
                </div>
                <div className="modal-body">
                    <div className="modal-tabs">
                        <button onClick={() => setActiveTab('stock')} className={activeTab === 'stock' ? 'active' : ''}>Остатки</button>
                        <button onClick={() => setActiveTab('recipes')} className={activeTab === 'recipes' ? 'active' : ''}>Рецепты</button>
                        <button onClick={() => setActiveTab('settings')} className={activeTab === 'settings' ? 'active' : ''}>Настройки</button>
                    </div>
                    {isLoading && <p style={{textAlign: 'center', padding: '20px'}}>Загрузка деталей...</p>}
                    {error && <p className="error-message">{error}</p>}
                    {!isLoading && !error && (
                        <>
                            {activeTab === 'stock' && renderStock()}
                            {activeTab === 'recipes' && renderRecipes()}
                            {activeTab === 'settings' && renderSettings()}
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}