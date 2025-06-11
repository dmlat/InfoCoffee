// frontend/src/components/StandDetailModal.js
import React, { useState, useEffect, useCallback } from 'react';
import apiClient from '../api';
import { ALL_ITEMS } from '../constants';
import TerminalListModal from './TerminalListModal';
import ConfirmModal from './ConfirmModal'; // Используем существующий ConfirmModal
import './StandDetailModal.css';

// --- Вспомогательные компоненты и константы ---
const RECIPE_INGREDIENTS_MAP = {
    'Кофе': 'coffee_grams', 'Вода': 'water_ml', 'Сливки': 'milk_grams',
    'Какао': 'cocoa_grams', 'Раф': 'raf_grams'
};

// --- Основной компонент ---
export default function StandDetailModal({ terminal, onClose }) {
    const [activeTab, setActiveTab] = useState('stock');
    const [details, setDetails] = useState({ inventory: [] });
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState('');
    
    // Состояния для вкладки Настройки
    const [settings, setSettings] = useState({});
    const [initialSettings, setInitialSettings] = useState({});
    const [isSavingSettings, setIsSavingSettings] = useState(false);
    
    // Состояния для вкладки Рецепты
    const [machineItems, setMachineItems] = useState([]);
    const [recipes, setRecipes] = useState({});
    const [initialRecipes, setInitialRecipes] = useState({});
    const [isSavingRecipes, setIsSavingRecipes] = useState(false);
    
    // Состояния для модальных окон копирования
    const [isCopyModalOpen, setIsCopyModalOpen] = useState(false);
    const [allTerminals, setAllTerminals] = useState([]);
    const [confirmModalState, setConfirmModalState] = useState({ isOpen: false, message: '', onConfirm: () => {} });

    const [internalTerminalId, setInternalTerminalId] = useState(null);
    const [saveStatus, setSaveStatus] = useState({ message: '', type: '' });

    // ... (код функций normalizeNumericInput и formatNumericOutput остается) ...
    const normalizeNumericInput = (value) => value.replace(/,/g, '.').replace(/[^0-9.]/g, '');
    const formatNumericOutput = (value) => {
        const num = parseFloat(value);
        if (isNaN(num)) return '';
        if (num % 1 === 0) return String(Math.round(num));
        return String(num);
    };

    const fetchDetailsAndRecipes = useCallback(async () => {
        const vendistaId = terminal.id;
        if (!vendistaId) return;
        
        setIsLoading(true); setError('');
        try {
            const detailsResponse = await apiClient.get(`/terminals/vendista/${vendistaId}/details`, {
                params: { name: terminal.comment, serial_number: terminal.serial_number }
            });
            if (!detailsResponse.data.success) throw new Error(detailsResponse.data.error);

            const { details: fetchedDetails, internalId: fetchedInternalId } = detailsResponse.data;
            setDetails(fetchedDetails);
            setInternalTerminalId(fetchedInternalId);
            
            const newSettings = {};
            ALL_ITEMS.forEach(item => {
                const existingItem = fetchedDetails.inventory.find(i => i.item_name === item.name);
                newSettings[item.name] = {
                    max_stock: formatNumericOutput(existingItem?.max_stock),
                    critical_stock: formatNumericOutput(existingItem?.critical_stock)
                };
            });
            setSettings(newSettings);
            setInitialSettings(JSON.parse(JSON.stringify(newSettings)));

            const itemsResponse = await apiClient.get(`/terminals/vendista/${vendistaId}/machine-items`);
            if (itemsResponse.data.success) setMachineItems(itemsResponse.data.machineItems || []);

            if(fetchedInternalId) {
                const recipesResponse = await apiClient.get(`/recipes/terminal/${fetchedInternalId}`);
                if (recipesResponse.data.success) {
                    const recipesMap = (recipesResponse.data.recipes || []).reduce((acc, recipe) => {
                        acc[recipe.machine_item_id] = { ...recipe };
                        Object.keys(recipe).forEach(key => {
                            if (key.includes('_grams') || key.includes('_ml')) {
                                acc[recipe.machine_item_id][key] = formatNumericOutput(recipe[key]);
                            }
                        });
                        return acc;
                    }, {});
                    setRecipes(recipesMap);
                    setInitialRecipes(JSON.parse(JSON.stringify(recipesMap)));
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

    // ... (код handleSettingsChange, handleSaveSettings, handleRecipeChange, handleSaveRecipes без изменений) ...

    const showSaveStatus = (message, type) => {
        setSaveStatus({ message, type });
        setTimeout(() => setSaveStatus({ message: '', type: '' }), 3000);
    };

    const handleSettingsChange = (itemName, field, value) => {
        setSettings(prev => ({ ...prev, [itemName]: { ...prev[itemName], [field]: normalizeNumericInput(value) } }));
    };

    const handleSaveSettings = async (e) => {
        e.preventDefault();
        setIsSavingSettings(true);
        const inventorySettings = Object.entries(settings).map(([itemName, values]) => {
            const itemInfo = ALL_ITEMS.find(i => i.name === itemName);
            return {
                item_name: itemName,
                location: itemInfo.type === 'ingredient' ? 'machine' : 'stand',
                max_stock: values.max_stock || null,
                critical_stock: values.critical_stock || null
            }
        });

        try {
            const response = await apiClient.post(`/terminals/vendista/${terminal.id}/settings`, { inventorySettings });
            if (response.data.success) {
                showSaveStatus('Настройки сохранены!', 'success');
                setInitialSettings(JSON.parse(JSON.stringify(settings)));
            } else {
                showSaveStatus(response.data.error || 'Ошибка.', 'error');
            }
        } catch (err) {
            showSaveStatus(err.response?.data?.error || 'Сетевая ошибка.', 'error');
        } finally {
            setIsSavingSettings(false);
        }
    };
    
    const handleRecipeChange = (machineItemId, field, value) => {
        setRecipes(prev => ({
            ...prev,
            [machineItemId]: {
                ...prev[machineItemId],
                machine_item_id: machineItemId,
                [field]: field.includes('_grams') || field.includes('_ml') ? normalizeNumericInput(value) : value
            }
        }));
    };

    const handleSaveRecipes = async () => {
        setIsSavingRecipes(true);
        try {
            const recipesToSave = Object.values(recipes).filter(r => r.name || Object.values(RECIPE_INGREDIENTS_MAP).some(key => r[key]));
            const response = await apiClient.post('/recipes', { terminalId: internalTerminalId, recipes: recipesToSave });
            if (response.data.success) {
                showSaveStatus('Рецепты успешно сохранены!', 'success');
                setInitialRecipes(JSON.parse(JSON.stringify(recipes)));
            } else {
                 showSaveStatus(response.data.error || 'Ошибка сохранения.', 'error');
            }
        } catch(err) {
            showSaveStatus(err.response?.data?.error || 'Сетевая ошибка.', 'error');
        } finally {
            setIsSavingRecipes(false);
        }
    };

    // ИСПРАВЛЕНО: Интеграция ConfirmModal в логику копирования
    const handleOpenCopyModal = async () => {
        try {
            const res = await apiClient.get('/terminals');
            if (res.data.success) {
                setAllTerminals(res.data.terminals || []);
                setIsCopyModalOpen(true);
            } else {
                showSaveStatus('Не удалось загрузить список стоек.', 'error');
            }
        } catch (err) {
            showSaveStatus('Сетевая ошибка при загрузке стоек.', 'error');
        }
    };
    
    const handleSelectCopyDestination = (destinationTerminal) => {
        setIsCopyModalOpen(false); // Закрываем список терминалов
        setConfirmModalState({
            isOpen: true,
            message: `Скопировать рецепты в "${destinationTerminal.comment || `Терминал #${destinationTerminal.id}`}"? Существующие рецепты для тех же кнопок будут перезаписаны.`,
            onConfirm: () => executeCopy(destinationTerminal)
        });
    };

    const executeCopy = async (destinationTerminal) => {
        // Сначала закрываем ConfirmModal
        setConfirmModalState({ isOpen: false });

        // Выполняем запрос
        try {
            // Для копирования нужен наш внутренний ID, а не ID Vendista.
            // Нужно получить его для целевого терминала.
            const destDetailsRes = await apiClient.get(`/terminals/vendista/${destinationTerminal.id}/details`);
            if (!destDetailsRes.data.success || !destDetailsRes.data.internalId) {
                throw new Error('Не удалось получить внутренний ID целевого терминала.');
            }
            const destinationInternalId = destDetailsRes.data.internalId;

            const res = await apiClient.post('/recipes/copy', {
                sourceTerminalId: internalTerminalId,
                destinationTerminalId: destinationInternalId
            });
            showSaveStatus(res.data.message, res.data.success ? 'success' : 'error');
        } catch (err) {
            showSaveStatus(err.response?.data?.error || 'Ошибка при копировании.', 'error');
        }
    };

    const haveRecipesChanged = JSON.stringify(recipes) !== JSON.stringify(initialRecipes);
    const haveSettingsChanged = JSON.stringify(settings) !== JSON.stringify(initialSettings);

    // ... (Рендер-функции renderStock, renderRecipes, renderSettings остаются такими же, как в предыдущем ответе)
    const renderStock = () => {
        const inventoryByLocation = details.inventory.reduce((acc, item) => {
            acc[item.item_name] = item;
            return acc;
        }, {});

        const sortedItems = [...ALL_ITEMS]; 
        const waterIndex = sortedItems.findIndex(i => i.name === 'Вода');
        const rafIndex = sortedItems.findIndex(i => i.name === 'Раф');

        return (
            <div className="modal-tab-content stock-tab-content">
                <table className="stock-table">
                    <tbody>
                        {sortedItems.map((item, index) => {
                            const inventoryItem = inventoryByLocation[item.name];
                            const stockValue = parseFloat(inventoryItem?.current_stock || 0);
                            const unit = item.unit;
                            const criticalStock = parseFloat(inventoryItem?.critical_stock || 0);
                            const isCritical = stockValue > 0 && criticalStock > 0 && stockValue <= criticalStock;

                            const rowClass = isCritical ? 'critical-row' : '';

                             const row = (
                                <tr key={item.name} className={rowClass}>
                                    <td>{item.fullName || item.name}</td>
                                    <td>
                                        {stockValue.toLocaleString('ru-RU', { maximumFractionDigits: 2 })} {unit}
                                        {criticalStock > 0 && ` (крит. ${criticalStock.toLocaleString('ru-RU', { maximumFractionDigits: 2 })})`}
                                    </td>
                                </tr>
                            );

                            if (index === waterIndex || index === rafIndex) {
                                return (
                                    <React.Fragment key={`${item.name}-fragment`}>
                                        {row}
                                        <tr className="table-divider-row"><td colSpan="2"><div className="table-divider"></div></td></tr>
                                    </React.Fragment>
                                );
                            }
                            return row;
                        })}
                    </tbody>
                </table>
            </div>
        );
    };

    const renderRecipes = () => (
        <div className="modal-tab-content recipes-form">
            <p className="helper-text recipes-helper">Укажите названия напитков и расход для автоматического учета остатков.</p>
            <div className="form-footer recipes-footer">
                 <button type="button" className="action-btn" onClick={handleSaveRecipes} disabled={isSavingRecipes || !haveRecipesChanged}>
                    {isSavingRecipes ? 'Сохранение...' : 'Сохранить рецепты'}
                </button>
                 <button type="button" className="action-btn secondary" onClick={handleOpenCopyModal} disabled={isSavingRecipes}>
                    Скопировать
                </button>
                {saveStatus.message && activeTab === 'recipes' && <span className={`save-status ${saveStatus.type}`}>{saveStatus.message}</span>}
            </div>
            <div className="table-scroll-container">
                <table className="recipes-table">
                    <thead>
                        <tr>
                            <th>ID</th>
                            <th>Название</th>
                            {Object.keys(RECIPE_INGREDIENTS_MAP).map(ing => <th key={ing}>{ing}</th>)}
                        </tr>
                    </thead>
                    <tbody>
                        {machineItems.length > 0 ? machineItems.map(itemId => (
                            <tr key={itemId}>
                                <td className="item-id-cell">{itemId}</td>
                                <td>
                                    <input type="text" placeholder="-" value={recipes[itemId]?.name || ''} 
                                           onChange={e => handleRecipeChange(itemId, 'name', e.target.value)} />
                                </td>
                                {Object.entries(RECIPE_INGREDIENTS_MAP).map(([ingName, fieldName]) => (
                                    <td key={ingName}>
                                        <input type="text" inputMode="decimal" placeholder="0" value={recipes[itemId]?.[fieldName] || ''}
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
        </div>
    );
    
    const renderSettings = () => (
        <form className="modal-tab-content settings-form" onSubmit={handleSaveSettings}>
            <p className="helper-text">Задайте максимальный объем контейнеров и критические остатки для уведомлений.</p>
            <div className="settings-section">
                <h4>Контейнеры кофемашины (г / мл / шт)</h4>
                <div className="setting-item-header">
                    <span/>
                    <span className="label-max">Максимальные</span>
                    <span className="label-crit">Критические</span>
                </div>
                {ALL_ITEMS.map(item => (
                    <div className="setting-item" key={item.name}>
                        <label>{item.fullName || item.name}</label>
                        <input type="text" inputMode="decimal" placeholder="Макс." value={settings[item.name]?.max_stock || ''} onChange={e => handleSettingsChange(item.name, 'max_stock', e.target.value)} />
                        <input type="text" inputMode="decimal" placeholder="Крит." value={settings[item.name]?.critical_stock || ''} onChange={e => handleSettingsChange(item.name, 'critical_stock', e.target.value)} />
                    </div>
                ))}
            </div>
            <div className="form-footer">
                 <button type="submit" className="action-btn" disabled={isSavingSettings || !haveSettingsChanged}>
                    {isSavingSettings ? 'Сохранение...' : 'Сохранить настройки'}
                </button>
                {saveStatus.message && activeTab === 'settings' && <span className={`save-status ${saveStatus.type}`}>{saveStatus.message}</span>}
            </div>
        </form>
    );

    return (
        <>
            {/* ИСПРАВЛЕНО: рендер ConfirmModal */}
            <ConfirmModal 
                isOpen={confirmModalState.isOpen}
                message={confirmModalState.message}
                onConfirm={confirmModalState.onConfirm}
                onCancel={() => setConfirmModalState({ isOpen: false })}
            />
            <div className="modal-overlay" onClick={onClose}>
                <div className="modal-content stand-detail-modal" onClick={e => e.stopPropagation()}>
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
            {isCopyModalOpen && (
                 <TerminalListModal
                    terminals={allTerminals}
                    onSelect={handleSelectCopyDestination}
                    onClose={() => setIsCopyModalOpen(false)}
                    disabledId={terminal.id}
                    title="Копировать в..."
                />
            )}
        </>
    );
}