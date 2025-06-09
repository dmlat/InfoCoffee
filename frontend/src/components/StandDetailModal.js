// frontend/src/components/StandDetailModal.js
import React, { useState, useEffect, useCallback } from 'react';
import apiClient from '../api';
import './StandDetailModal.css';

// --- Вспомогательные компоненты и константы ---

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

const INVENTORY_ITEMS = {
    machine: ['Кофе', 'Сливки', 'Какао', 'Раф', 'Вода'],
    stand: ['Стаканы', 'Крышки', 'Размешиватели', 'Сахар']
};

const RECIPE_INGREDIENTS_MAP = {
    'Кофе': 'coffee_grams',
    'Вода': 'water_ml',
    'Сливки': 'milk_grams',
    'Какао': 'cocoa_grams',
    'Раф': 'raf_grams'
};

// --- Основной компонент ---

export default function StandDetailModal({ terminal, onClose }) {
    const [activeTab, setActiveTab] = useState('stock');
    const [details, setDetails] = useState({ inventory: [] });
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState('');
    
    const [settings, setSettings] = useState({});
    const [isSaving, setIsSaving] = useState(false);
    const [saveStatus, setSaveStatus] = useState({ message: '', type: '' });

    const [machineItems, setMachineItems] = useState([]);
    const [recipes, setRecipes] = useState({});
    const [internalTerminalId, setInternalTerminalId] = useState(null);

    const fetchDetailsAndRecipes = useCallback(async () => {
        const vendistaId = terminal.id;
        if (!vendistaId) return;
        
        setIsLoading(true);
        setError('');
        try {
            const detailsResponse = await apiClient.get(`/terminals/vendista/${vendistaId}/details`, {
                params: { name: terminal.comment, serial_number: terminal.serial_number }
            });

            if (!detailsResponse.data.success) throw new Error(detailsResponse.data.error);

            const fetchedDetails = detailsResponse.data.details;
            const fetchedInternalId = detailsResponse.data.internalId;
            
            setDetails(fetchedDetails);
            setInternalTerminalId(fetchedInternalId);
            
            const newSettings = {};
            [...INVENTORY_ITEMS.machine, ...INVENTORY_ITEMS.stand].forEach(itemName => {
                const existingItem = fetchedDetails.inventory.find(i => i.item_name === itemName);
                newSettings[itemName] = {
                    max_stock: existingItem?.max_stock || '',
                    critical_stock: existingItem?.critical_stock || ''
                };
            });
            setSettings(newSettings);

            const itemsResponse = await apiClient.get(`/terminals/vendista/${vendistaId}/machine-items`);
            if (itemsResponse.data.success) {
                setMachineItems(itemsResponse.data.machineItems || []);
            }

            if(fetchedInternalId) {
                const recipesResponse = await apiClient.get(`/recipes/terminal/${fetchedInternalId}`);
                if (recipesResponse.data.success) {
                    const recipesMap = (recipesResponse.data.recipes || []).reduce((acc, recipe) => {
                        acc[recipe.machine_item_id] = recipe;
                        return acc;
                    }, {});
                    setRecipes(recipesMap);
                }
            }
        } catch (err) {
            setError(err.response?.data?.error || 'Ошибка сети при загрузке данных стойки.');
        } finally {
            setIsLoading(false);
        }
    }, [terminal.id, terminal.comment, terminal.serial_number]);

    useEffect(() => {
        fetchDetailsAndRecipes();
    }, [fetchDetailsAndRecipes]);

    const handleSettingsChange = (itemName, field, value) => {
        setSettings(prev => ({ ...prev, [itemName]: { ...prev[itemName], [field]: value } }));
    };

    const handleSaveSettings = async (e) => {
        e.preventDefault();
        setIsSaving(true);
        setSaveStatus({ message: '', type: '' });
        const inventorySettings = Object.entries(settings).map(([itemName, values]) => ({
            item_name: itemName,
            location: INVENTORY_ITEMS.machine.includes(itemName) ? 'machine' : 'stand',
            max_stock: values.max_stock || null,
            critical_stock: values.critical_stock || null
        }));
        try {
            const response = await apiClient.post(`/terminals/vendista/${terminal.id}/settings`, { inventorySettings });
            if (response.data.success) {
                setSaveStatus({ message: 'Настройки сохранены!', type: 'success' });
                await fetchDetailsAndRecipes();
            } else {
                setSaveStatus({ message: response.data.error || 'Ошибка.', type: 'error' });
            }
        } catch (err) {
            setSaveStatus({ message: err.response?.data?.error || 'Сетевая ошибка.', type: 'error' });
        } finally {
            setIsSaving(false);
            setTimeout(() => setSaveStatus({ message: '', type: '' }), 3000);
        }
    };
    
    const handleRecipeChange = (machineItemId, field, value) => {
        setRecipes(prev => ({
            ...prev,
            [machineItemId]: {
                ...prev[machineItemId],
                machine_item_id: machineItemId,
                [field]: value
            }
        }));
    };

    const handleSaveRecipes = async () => {
        setIsSaving(true);
        setSaveStatus({ message: '', type: '' });
        try {
            const recipesToSave = Object.values(recipes).filter(r => r.name || Object.values(RECIPE_INGREDIENTS_MAP).some(key => r[key]));
            const response = await apiClient.post('/recipes', { terminalId: internalTerminalId, recipes: recipesToSave });
            if (response.data.success) {
                setSaveStatus({ message: 'Рецепты успешно сохранены!', type: 'success' });
            } else {
                 setSaveStatus({ message: response.data.error || 'Ошибка сохранения.', type: 'error' });
            }
        } catch(err) {
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

    const renderRecipes = () => (
        <div className="modal-tab-content recipes-form">
            <p className="helper-text">Укажите названия напитков и расход в граммах/мл для автоматического учета остатков.</p>
            <div className="table-scroll-container">
                <table className="recipes-table">
                    <thead>
                        <tr>
                            <th>Кнопка</th>
                            <th>Название напитка</th>
                            {Object.keys(RECIPE_INGREDIENTS_MAP).map(ing => <th key={ing}>{ing}</th>)}
                        </tr>
                    </thead>
                    <tbody>
                        {machineItems.length > 0 ? machineItems.map(itemId => (
                            <tr key={itemId}>
                                <td className="item-id-cell">{itemId}</td>
                                <td>
                                    <input type="text" placeholder="Латте" value={recipes[itemId]?.name || ''} 
                                           onChange={e => handleRecipeChange(itemId, 'name', e.target.value)} />
                                </td>
                                {Object.entries(RECIPE_INGREDIENTS_MAP).map(([ingName, fieldName]) => (
                                    <td key={ingName}>
                                        <input type="number" placeholder="0" value={recipes[itemId]?.[fieldName] || ''}
                                               onChange={e => handleRecipeChange(itemId, fieldName, e.target.value)} />
                                    </td>
                                ))}
                            </tr>
                        )) : (
                            <tr><td colSpan={Object.keys(RECIPE_INGREDIENTS_MAP).length + 2}>Нет данных о проданных напитках. Совершите продажу, чтобы кнопки появились.</td></tr>
                        )}
                    </tbody>
                </table>
            </div>
             <div className="form-footer">
                 <button type="button" className="action-btn" onClick={handleSaveRecipes} disabled={isSaving}>
                    {isSaving ? 'Сохранение...' : 'Сохранить рецепты'}
                </button>
                {saveStatus.message && <span className={`save-status ${saveStatus.type}`}>{saveStatus.message}</span>}
            </div>
        </div>
    );
    
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
                    {isLoading && <div className="page-loading-container"><span>Загрузка деталей...</span></div>}
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