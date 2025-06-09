// frontend/src/components/StandDetailModal.js
import React, { useState, useEffect } from 'react';
import apiClient from '../api';
import './StandDetailModal.css';

// Список всех возможных позиций для инвентаря
const INVENTORY_ITEMS = {
    machine: ['Кофе', 'Сливки', 'Какао', 'Раф', 'Вода'],
    stand: ['Стаканы', 'Крышки', 'Размешиватели', 'Сахар']
};

const ProgressBar = ({ value, max }) => {
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
    const [details, setDetails] = useState({ inventory: [] });
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState('');
    
    // --- НОВОЕ: Состояние для формы настроек ---
    const [settings, setSettings] = useState({});
    const [isSaving, setIsSaving] = useState(false);
    const [saveStatus, setSaveStatus] = useState({ message: '', type: '' });


    const fetchDetails = async () => {
        const vendistaId = terminal.id;
        if (!vendistaId) return;
        
        setIsLoading(true);
        setError('');
        try {
            const response = await apiClient.get(`/terminals/vendista/${vendistaId}/details`, {
                params: { name: terminal.comment, serial_number: terminal.serial_number }
            });

            if (response.data.success) {
                const fetchedDetails = response.data.details;
                setDetails(fetchedDetails);
                
                // --- НОВОЕ: Заполняем состояние формы настроек из полученных данных ---
                const newSettings = {};
                const allItems = [...INVENTORY_ITEMS.machine, ...INVENTORY_ITEMS.stand];
                allItems.forEach(itemName => {
                    const existingItem = fetchedDetails.inventory.find(i => i.item_name === itemName);
                    newSettings[itemName] = {
                        max_stock: existingItem?.max_stock || '',
                        critical_stock: existingItem?.critical_stock || ''
                    };
                });
                setSettings(newSettings);

            } else {
                setError(response.data.error || 'Не удалось загрузить данные.');
            }
        } catch (err) {
            setError(err.response?.data?.error || 'Ошибка сети при загрузке деталей стойки.');
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchDetails();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [terminal.id]);

    const handleSettingsChange = (itemName, field, value) => {
        setSettings(prev => ({
            ...prev,
            [itemName]: {
                ...prev[itemName],
                [field]: value
            }
        }));
    };

    const handleSaveSettings = async (e) => {
        e.preventDefault();
        setIsSaving(true);
        setSaveStatus({ message: '', type: '' });

        const inventorySettings = Object.entries(settings).map(([itemName, values]) => {
            const location = INVENTORY_ITEMS.machine.includes(itemName) ? 'machine' : 'stand';
            return {
                item_name: itemName,
                location,
                max_stock: values.max_stock || null,
                critical_stock: values.critical_stock || null
            }
        });

        try {
            const response = await apiClient.post(`/terminals/vendista/${terminal.id}/settings`, { inventorySettings });
            if (response.data.success) {
                setSaveStatus({ message: 'Настройки успешно сохранены!', type: 'success' });
                // Обновляем данные на вкладке Остатки
                fetchDetails(); 
            } else {
                setSaveStatus({ message: response.data.error || 'Ошибка сохранения.', type: 'error' });
            }
        } catch (err) {
            setSaveStatus({ message: err.response?.data?.error || 'Сетевая ошибка.', type: 'error' });
        } finally {
            setIsSaving(false);
            setTimeout(() => setSaveStatus({ message: '', type: '' }), 3000);
        }
    };


    const renderStock = () => {
        if (details.inventory.length === 0) {
            return (
                 <div className="modal-tab-content placeholder-text">
                    <p>Остатки для этой стойки еще не настроены.</p>
                    <p>Перейдите на вкладку "Настройки", чтобы задать параметры контейнеров и запасов.</p>
                </div>
            )
        }
        const machineItems = details.inventory.filter(i => i.location === 'machine');
        const standItems = details.inventory.filter(i => i.location === 'stand');
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

    const renderSettings = () => (
        <form className="modal-tab-content settings-form" onSubmit={handleSaveSettings}>
            <p className="helper-text">Задайте максимальный объем контейнеров и критические остатки для своевременных уведомлений.</p>
            
            <div className="settings-section">
                <h4>Контейнеры кофемашины (г/мл)</h4>
                {INVENTORY_ITEMS.machine.map(itemName => (
                    <div className="setting-item" key={itemName}>
                        <label>{itemName}</label>
                        <div className="setting-inputs">
                            <input type="number" placeholder="Макс." value={settings[itemName]?.max_stock || ''} onChange={e => handleSettingsChange(itemName, 'max_stock', e.target.value)} />
                            <input type="number" placeholder="Крит." value={settings[itemName]?.critical_stock || ''} onChange={e => handleSettingsChange(itemName, 'critical_stock', e.target.value)} />
                        </div>
                    </div>
                ))}
            </div>

            <div className="settings-section">
                <h4>Расходники в стойке (шт)</h4>
                 {INVENTORY_ITEMS.stand.map(itemName => (
                    <div className="setting-item" key={itemName}>
                        <label>{itemName}</label>
                        <div className="setting-inputs">
                            <input type="number" placeholder="Крит." value={settings[itemName]?.critical_stock || ''} onChange={e => handleSettingsChange(itemName, 'critical_stock', e.target.value)} />
                        </div>
                    </div>
                ))}
            </div>
            
            <div className="form-footer">
                 <button type="submit" className="action-btn" disabled={isSaving}>
                    {isSaving ? 'Сохранение...' : 'Сохранить настройки'}
                </button>
                {saveStatus.message && <span className={`save-status ${saveStatus.type}`}>{saveStatus.message}</span>}
            </div>
        </form>
    );

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