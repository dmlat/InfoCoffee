// frontend/src/pages/WarehousePage.js
import React, { useState, useEffect, useCallback } from 'react';
import apiClient from '../api';
import './WarehousePage.css';
import StockUpModal from '../components/StockUpModal';
import TerminalListModal from '../components/TerminalListModal';
import StandDetailModal from '../components/StandDetailModal';

// --- Константы и Хелперы ---
const ALL_ITEMS = [
    { name: 'Кофе', unit: 'кг', multiplier: 1000, type: 'consumable' },
    { name: 'Вода', unit: 'л', multiplier: 1000, type: 'consumable' },
    { name: 'Сливки', unit: 'кг', multiplier: 1000, type: 'consumable' },
    { name: 'Какао', unit: 'кг', multiplier: 1000, type: 'consumable' },
    { name: 'Раф', unit: 'кг', multiplier: 1000, type: 'consumable' },
    { name: 'Стаканы', unit: 'шт', multiplier: 1, type: 'disposable' },
    { name: 'Крышки', unit: 'шт', multiplier: 1, type: 'disposable' },
    { name: 'Размеш.', unit: 'шт', multiplier: 1, type: 'disposable' },
    { name: 'Сахар', unit: 'шт', multiplier: 1, type: 'disposable' },
    { name: 'Трубочки', unit: 'шт', multiplier: 1, type: 'disposable' },
];

const getUnitInfo = (itemName) => ALL_ITEMS.find(i => i.name === itemName) || {};
const WAREHOUSE_STATE_KEY = 'warehouse_page_state_v3';

// --- Основной Компонент ---
export default function WarehousePage() {
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState('');
    const [notification, setNotification] = useState({ message: '', isError: false });
    const [terminals, setTerminals] = useState([]);
    const [selectedTerminal, setSelectedTerminal] = useState(null);
    const [warehouseStock, setWarehouseStock] = useState({});
    const [standStock, setStandStock] = useState({});
    const [machineData, setMachineData] = useState({});
    const [isRowLoading, setRowLoading] = useState({});
    const [activeStepKg, setActiveStepKg] = useState('1');
    const [activeStepPcs, setActiveStepPcs] = useState('100');
    const [isStockUpModalOpen, setIsStockUpModalOpen] = useState(false);
    const [isTerminalModalOpen, setIsTerminalModalOpen] = useState(false);
    const [isStandDetailModalOpen, setIsStandDetailModalOpen] = useState(false);
    
    const showNotification = (message, isError = false) => {
        setNotification({ message, isError });
        setTimeout(() => setNotification({ message: '', isError: false }), 3500);
    };
    
    const fetchDataForTerminal = useCallback(async (terminal) => {
        if (!terminal?.id) {
            setStandStock({});
            setMachineData({});
            return;
        }
        try {
            const res = await apiClient.get(`/terminals/vendista/${terminal.id}/details`);
            if (res.data.success) {
                const inventory = res.data.details?.inventory || [];
                const newStandStock = {};
                const newMachineData = {};
                
                inventory.forEach(item => {
                    const stockValue = parseFloat(item.current_stock || 0);
                    if (item.location === 'stand') {
                        newStandStock[item.item_name] = {
                            current: stockValue,
                            max: parseFloat(item.max_stock || 0),
                            critical: parseFloat(item.critical_stock || 0)
                        };
                    } else if (item.location === 'machine') {
                        newMachineData[item.item_name] = { 
                            current: stockValue, 
                            max: parseFloat(item.max_stock || 0), 
                            critical: parseFloat(item.critical_stock || 0)
                        };
                    }
                });
                setStandStock(newStandStock);
                setMachineData(newMachineData);
                // Обновляем терминал, сохраняя предыдущие данные и добавляя internalId
                setSelectedTerminal(prev => ({...prev, ...terminal, internalId: res.data.internalId}));
            }
        } catch (err) {
            setError(`Ошибка загрузки деталей для ${terminal.comment}`);
        }
    }, []);

    const fetchInitialData = useCallback(async () => {
        setIsLoading(true);
        setError('');
        try {
            const [terminalsRes, warehouseRes] = await Promise.all([
                apiClient.get('/terminals'),
                apiClient.get('/warehouse'),
            ]);

            if (!terminalsRes.data.success) throw new Error('Не удалось загрузить стойки');
            const fetchedTerminals = terminalsRes.data.terminals || [];
            setTerminals(fetchedTerminals);

            if (warehouseRes.data.success) {
                setWarehouseStock((warehouseRes.data.warehouseStock || []).reduce((acc, item) => ({...acc, [item.item_name]: parseFloat(item.current_stock || 0)}), {}));
            }

            const savedState = JSON.parse(localStorage.getItem(WAREHOUSE_STATE_KEY));
            let initialTerminal = null;
            if (savedState?.selectedTerminalId) {
                initialTerminal = fetchedTerminals.find(t => t.id === savedState.selectedTerminalId);
            }
            if (!initialTerminal && fetchedTerminals.length > 0) {
                initialTerminal = fetchedTerminals[0];
            }

            if (initialTerminal) {
                await fetchDataForTerminal(initialTerminal);
            }
        } catch (err) {
            setError(err.response?.data?.error || err.message || 'Ошибка загрузки данных');
        } finally {
            setIsLoading(false);
        }
    }, [fetchDataForTerminal]);

    useEffect(() => {
        const savedState = JSON.parse(localStorage.getItem(WAREHOUSE_STATE_KEY));
        if (savedState) {
            setActiveStepKg(savedState.activeStepKg || '1');
            setActiveStepPcs(savedState.activeStepPcs || '100');
        }
        fetchInitialData();
    }, [fetchInitialData]);

    useEffect(() => {
        if (!isLoading) { // Сохраняем только после начальной загрузки
            const stateToSave = {
                selectedTerminalId: selectedTerminal ? selectedTerminal.id : null,
                activeStepKg,
                activeStepPcs,
            };
            localStorage.setItem(WAREHOUSE_STATE_KEY, JSON.stringify(stateToSave));
        }
    }, [selectedTerminal, activeStepKg, activeStepPcs, isLoading]);

    const handleTerminalSelect = (terminal) => {
        fetchDataForTerminal(terminal);
        setIsTerminalModalOpen(false);
    };

    const handleTransfer = async (fromLoc, toLoc, itemName, step) => {
        if (!selectedTerminal?.internalId) {
            showNotification("Стойка не выбрана.", true);
            return;
        }

        const { multiplier } = getUnitInfo(itemName);
        const stepQuantity = step * multiplier;

        let sourceStock = 0;
        if (fromLoc === 'warehouse') sourceStock = warehouseStock[itemName] || 0;
        else if (fromLoc === 'stand') sourceStock = standStock[itemName]?.current || 0;
        else if (fromLoc === 'machine') sourceStock = machineData[itemName]?.current || 0;
        
        if (sourceStock <= 0) return;

        let quantityToTransfer = Math.min(stepQuantity, sourceStock);

        if (toLoc === 'machine' || toLoc === 'stand') {
            const targetData = toLoc === 'machine' ? machineData[itemName] : standStock[itemName];
            const maxStock = targetData?.max || Infinity;
            if (maxStock > 0) {
                const currentStock = targetData?.current || 0;
                const freeSpace = maxStock - currentStock;
                quantityToTransfer = Math.min(quantityToTransfer, freeSpace);
            }
        }
        
        if (quantityToTransfer <= 0) {
             showNotification("Нет свободного места.", true);
             return;
        }

        setRowLoading(prev => ({ ...prev, [itemName]: true }));

        try {
            const fromPayload = { location: fromLoc, terminal_id: fromLoc === 'warehouse' ? null : selectedTerminal.internalId };
            const toPayload = { location: toLoc, terminal_id: toLoc === 'warehouse' ? null : selectedTerminal.internalId };
            const response = await apiClient.post('/inventory/move', { from: fromPayload, to: toPayload, item_name: itemName, quantity: quantityToTransfer });
            
            if (response.data.success) {
                // Прямое обновление состояния из ответа сервера - самый надежный способ
                await fetchInitialData(); // Полная перезагрузка для гарантии консистентности
            } else {
                showNotification(response.data.error || 'Ошибка перемещения', true);
            }
        } catch (err) {
            showNotification(err.response?.data?.error || 'Сетевая ошибка', true);
        } finally {
            setRowLoading(prev => ({ ...prev, [itemName]: false }));
        }
    };
    
    // ... render функции
    const renderStepSelector = () => (
        <div className="step-selector-container">
            <div className="step-group">
                <span className="step-label">Шаг, кг/л:</span>
                <div className="step-buttons">
                    {['10', '5', '1', '0.1', '0.01'].map(step => (
                        <button key={step} className={`step-btn ${activeStepKg === step ? 'active' : ''}`} onClick={() => setActiveStepKg(step)}>{step}</button>
                    ))}
                </div>
            </div>
            <div className="step-group">
                <span className="step-label">Шаг, шт:</span>
                <div className="step-buttons">
                    {['1000', '500', '100', '10', '1'].map(step => (
                        <button key={step} className={`step-btn ${activeStepPcs === step ? 'active' : ''}`} onClick={() => setActiveStepPcs(step)}>{step}</button>
                    ))}
                </div>
            </div>
        </div>
    );

    const renderInventoryRow = (item) => {
        const { name, unit, type, multiplier } = item;
        const step = type === 'consumable' ? parseFloat(activeStepKg) : parseFloat(activeStepPcs);
        
        const whValue = (warehouseStock[name] || 0) / multiplier;
        const stData = standStock[name];
        const mcData = machineData[name];

        return(
            <div className={`inventory-flat-row ${isRowLoading[name] ? 'loading' : ''}`} key={name}>
                <div className="flat-row-item-name">
                    <span>{name}</span>, {unit}
                </div>
                {/* Склад */}
                <div className="flat-row-cell">{whValue.toLocaleString('ru-RU', {maximumFractionDigits: 2})}</div>
                <div className="flat-row-separator"></div>

                {/* Перемещение на стойку */}
                <div className="flat-row-transfer">
                    <button className="transfer-arrow left" onClick={() => handleTransfer('stand', 'warehouse', name, step)} disabled={!stData || stData.current < 1}>{'<'}</button>
                    <button className="transfer-arrow right" onClick={() => handleTransfer('warehouse', 'stand', name, step)} disabled={warehouseStock[name] < 1}>{'>'}</button>
                </div>
                <div className="flat-row-separator"></div>

                {/* Стойка */}
                <div className="flat-row-cell progress-cell">
                    {stData && stData.max > 0 ? (
                        <div className="progress-bar-container">
                            <div className="progress-bar-fill" style={{ width: `${(stData.current / stData.max) * 100}%` }}></div>
                            {stData.critical > 0 && <div className="progress-bar-critical-marker" style={{ left: `${(stData.critical / stData.max) * 100}%` }}></div>}
                            <span className="progress-bar-text">{stData.current} / {stData.max}</span>
                        </div>
                    ) : ( <span className="value-placeholder" onClick={() => setIsStandDetailModalOpen(true)}>{stData ? stData.current : 'N/A'}</span> )}
                </div>
                <div className="flat-row-separator"></div>
                
                {/* Перемещение в машину */}
                {type === 'consumable' ? (
                    <>
                    <div className="flat-row-transfer">
                        <button className="transfer-arrow left" onClick={() => handleTransfer('machine', 'stand', name, step)} disabled={!mcData || mcData.current < 1}>{'<'}</button>
                        <button className="transfer-arrow right" onClick={() => handleTransfer('stand', 'machine', name, step)} disabled={!stData || stData.current < 1}>{'>'}</button>
                    </div>
                    <div className="flat-row-separator"></div>

                    {/* Машина */}
                    <div className="flat-row-cell progress-cell">
                         {mcData && mcData.max > 0 ? (
                            <div className="progress-bar-container">
                                <div className="progress-bar-fill" style={{ width: `${(mcData.current / mcData.max) * 100}%` }}></div>
                                {mcData.critical > 0 && <div className="progress-bar-critical-marker" style={{ left: `${(mcData.critical / mcData.max) * 100}%` }}></div>}
                                <span className="progress-bar-text">{mcData.current} / {mcData.max}</span>
                            </div>
                        ) : ( <span className="value-placeholder" onClick={() => setIsStandDetailModalOpen(true)}>N/A</span> )}
                    </div>
                    </>
                ) : <div className="disposable-placeholder"></div>}
            </div>
        );
    };

    if (isLoading) return <div className="page-loading-container"><span>Загрузка склада...</span></div>;

    return (
        <>
            <div className="page-container warehouse-page">
                {error && <div className="error-message">{error}</div>}
                {notification.message && <div className={`info-notification ${notification.isError ? 'error' : ''}`}>{notification.message}</div>}
                
                <div className="warehouse-top-panel">
                    <button className="action-btn stock-up-btn" onClick={() => setIsStockUpModalOpen(true)}>Приходовать товар</button>
                    <span className="stock-up-label">Пополнить склад</span>
                </div>
                <div className="warehouse-top-panel stand-selector-panel">
                    <span className="stand-selector-label">Выберите стойку для пополнения:</span>
                    <button className="terminal-selector-btn" onClick={() => setIsTerminalModalOpen(true)}>
                        {selectedTerminal ? selectedTerminal.comment || `Стойка #${selectedTerminal.id}` : 'Не выбрана'}
                    </button>
                </div>
                
                <div className="inventory-block">
                    <h3 className="inventory-block-title">Переместить остатки</h3>
                    {renderStepSelector()}
                    <div className="inventory-flat-grid">
                        <div className="flat-grid-header">
                            <div className="flat-row-item-name">Название</div>
                            <div className="flat-row-cell">Склад</div>
                            <div className="flat-row-separator"></div>
                            <div className="flat-row-transfer"></div>
                            <div className="flat-row-separator"></div>
                            <div className="flat-row-cell">Стойка</div>
                            <div className="flat-row-separator"></div>
                            <div className="flat-row-transfer"></div>
                            <div className="flat-row-separator"></div>
                            <div className="flat-row-cell">Машина</div>
                        </div>
                         {ALL_ITEMS.map(renderInventoryRow)}
                    </div>
                </div>
            </div>

            {isStockUpModalOpen && <StockUpModal onClose={() => setIsStockUpModalOpen(false)} onSuccess={fetchInitialData} />}
            {isTerminalModalOpen && <TerminalListModal terminals={terminals} onClose={() => setIsTerminalModalOpen(false)} onSelect={handleTerminalSelect} currentSelection={selectedTerminal?.id} />}
            {isStandDetailModalOpen && selectedTerminal && <StandDetailModal terminal={selectedTerminal} onClose={() => { setIsStandDetailModalOpen(false); fetchDataForTerminal(selectedTerminal); }} />}
        </>
    );
}