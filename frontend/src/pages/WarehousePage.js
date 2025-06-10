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
];

const getUnitInfo = (itemName) => ALL_ITEMS.find(i => i.name === itemName) || {};

const WAREHOUSE_STATE_KEY = 'warehouse_page_state';

// --- Основной Компонент ---

export default function WarehousePage() {
    // --- Состояния (States) ---
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState('');
    const [notification, setNotification] = useState('');

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
    
    // --- Уведомления ---
    const showNotification = (message) => {
        setNotification(message);
        setTimeout(() => setNotification(''), 3000);
    };
    
    // --- Загрузка данных ---
    const fetchDataForTerminal = useCallback(async (terminal) => {
        if (!terminal) {
            setStandStock({});
            setMachineData({});
            return;
        }
        try {
            const res = await apiClient.get(`/terminals/vendista/${terminal.id}/details`);
            if (res.data.success) {
                const inventory = res.data.details?.inventory || [];
                const stand = {};
                const machine = {};
                inventory.forEach(item => {
                    if (item.location === 'stand') stand[item.item_name] = parseFloat(item.current_stock || 0);
                    if (item.location === 'machine') machine[item.item_name] = { 
                        current: parseFloat(item.current_stock || 0), 
                        max: parseFloat(item.max_stock || 0), 
                        critical: parseFloat(item.critical_stock || 0)
                    };
                });
                setStandStock(stand);
                setMachineData(machine);
                // Обновляем терминал, добавляя internalId
                setSelectedTerminal(prev => ({...prev, ...terminal, internalId: res.data.internalId}));
            }
        } catch (err) {
            setError(`Ошибка загрузки деталей для стойки ${terminal.comment}`);
        }
    }, []);

    const fetchInitialData = useCallback(async () => {
        setIsLoading(true);
        setError('');
        try {
            const [terminalsRes, warehouseRes] = await Promise.all([
                apiClient.get('/terminals'), // Запрос к нашему бэкенду, который берет данные из нашей БД
                apiClient.get('/warehouse'),
            ]);

            if (!terminalsRes.data.success) throw new Error('Не удалось загрузить стойки');
            if (warehouseRes.data.success) {
                const stockMap = (warehouseRes.data.warehouseStock || []).reduce((acc, item) => {
                    acc[item.item_name] = parseFloat(item.current_stock || 0);
                    return acc;
                }, {});
                setWarehouseStock(stockMap);
            }

            const fetchedTerminals = terminalsRes.data.terminals || [];
            setTerminals(fetchedTerminals);
            
            const savedState = JSON.parse(localStorage.getItem(WAREHOUSE_STATE_KEY));
            let initialTerminal = null;

            if (savedState?.selectedTerminalId) {
                initialTerminal = fetchedTerminals.find(t => t.id === savedState.selectedTerminalId) || fetchedTerminals[0];
            } else {
                initialTerminal = fetchedTerminals[0];
            }

            if (initialTerminal) {
                setSelectedTerminal(initialTerminal);
                await fetchDataForTerminal(initialTerminal);
            }
        } catch (err) {
            setError(err.response?.data?.error || err.message || 'Ошибка загрузки данных');
        } finally {
            setIsLoading(false);
        }
    }, [fetchDataForTerminal]);

    // --- Эффекты (useEffect) ---
    useEffect(() => {
        const savedState = JSON.parse(localStorage.getItem(WAREHOUSE_STATE_KEY));
        if (savedState) {
            setActiveStepKg(savedState.activeStepKg || '1');
            setActiveStepPcs(savedState.activeStepPcs || '100');
        }
        fetchInitialData();
    }, [fetchInitialData]);

    useEffect(() => {
        const stateToSave = {
            selectedTerminalId: selectedTerminal ? selectedTerminal.id : null,
            activeStepKg,
            activeStepPcs,
        };
        localStorage.setItem(WAREHOUSE_STATE_KEY, JSON.stringify(stateToSave));
    }, [selectedTerminal, activeStepKg, activeStepPcs]);

    // --- Обработчики действий ---

    const handleTerminalSelect = (terminal) => {
        setSelectedTerminal(terminal);
        fetchDataForTerminal(terminal);
        setIsTerminalModalOpen(false);
    };

    const handleWarehouseAdjust = async (itemName, step) => {
        const { multiplier } = getUnitInfo(itemName);
        const quantity = step * multiplier;
        const currentStock = warehouseStock[itemName] || 0;

        // Оптимистичное обновление
        setWarehouseStock(prev => ({ ...prev, [itemName]: currentStock + quantity }));
        setRowLoading(prev => ({ ...prev, [itemName]: true }));

        try {
            const res = await apiClient.post('/warehouse/adjust', { item_name: itemName, quantity });
            if (res.data.success) {
                setWarehouseStock(prev => ({ ...prev, [itemName]: parseFloat(res.data.new_stock) }));
            } else {
                // Откат в случае ошибки
                setWarehouseStock(prev => ({ ...prev, [itemName]: currentStock }));
                showNotification(res.data.error || 'Ошибка обновления');
            }
        } catch (err) {
            setWarehouseStock(prev => ({ ...prev, [itemName]: currentStock }));
            showNotification(err.response?.data?.error || "Сетевая ошибка");
        } finally {
            setRowLoading(prev => ({ ...prev, [itemName]: false }));
        }
    };
    
    const handleTransfer = async (from, to, itemName, step) => {
        const { multiplier } = getUnitInfo(itemName);
        const transferQuantity = step * multiplier;

        if (!selectedTerminal || !selectedTerminal.internalId) {
            showNotification("Внутренний ID терминала не загружен. Перемещение невозможно.");
            return;
        }

        const fromPayload = { location: from.loc, terminal_id: from.loc === 'warehouse' ? null : selectedTerminal.internalId };
        const toPayload = { location: to.loc, terminal_id: to.loc === 'warehouse' ? null : selectedTerminal.internalId };

        let optimisticState = {
            warehouse: { ...warehouseStock },
            stand: { ...standStock },
            machine: { ...machineData }
        };

        const currentFromStock = optimisticState[from.type][itemName] || 0;
        if (currentFromStock < transferQuantity) {
            showNotification(`Недостаточно "${itemName}" в источнике.`);
            return;
        }
        
        let actualTransferQuantity = transferQuantity;

        if (to.loc === 'machine') {
            const itemInData = machineData[itemName];
            const maxStock = itemInData?.max || Infinity;
            const currentStock = itemInData?.current || 0;
            const freeSpace = maxStock - currentStock;
            if (transferQuantity > freeSpace) {
                actualTransferQuantity = freeSpace;
            }
        }

        if (actualTransferQuantity <= 0) return;

        // Оптимистичное обновление
        optimisticState[from.type][itemName] = (optimisticState[from.type][itemName] || 0) - actualTransferQuantity;
        optimisticState[to.type][itemName] = (optimisticState[to.type][itemName] || 0) + actualTransferQuantity;
        
        // Для машины обновляем сложный объект
        if (to.loc === 'machine' || from.loc === 'machine') {
             setMachineData(prev => ({
                ...prev,
                [itemName]: {
                    ...prev[itemName],
                    current: from.loc === 'machine' ? prev[itemName].current - actualTransferQuantity : prev[itemName].current + actualTransferQuantity
                }
            }));
             setStandStock(prev => ({ ...prev, [itemName]: from.loc === 'stand' ? prev[itemName] - actualTransferQuantity : prev[itemName] + actualTransferQuantity }));
        } else {
            setWarehouseStock(optimisticState.warehouse);
            setStandStock(optimisticState.stand);
        }

        setRowLoading(prev => ({ ...prev, [itemName]: true }));

        try {
            await apiClient.post('/inventory/move', { from: fromPayload, to: toPayload, item_name: itemName, quantity: actualTransferQuantity });
            // Перезагружаем данные для склада и выбранной стойки для синхронизации
            const [whRes, termRes] = await Promise.all([
                 apiClient.get('/warehouse'),
                 apiClient.get(`/terminals/vendista/${selectedTerminal.id}/details`)
            ]);
            if (whRes.data.success) setWarehouseStock((whRes.data.warehouseStock || []).reduce((acc, item) => ({...acc, [item.item_name]: parseFloat(item.current_stock||0)}), {}));
            if (termRes.data.success) {
                const inv = termRes.data.details?.inventory || [];
                setStandStock(inv.filter(i => i.location === 'stand').reduce((acc, i) => ({...acc, [i.item_name]: parseFloat(i.current_stock||0)}), {}));
                setMachineData(inv.filter(i => i.location === 'machine').reduce((acc, i) => ({...acc, [i.item_name]: {current: parseFloat(i.current_stock||0), max: parseFloat(i.max_stock||0), critical: parseFloat(i.critical_stock||0)}}), {}));
            }

        } catch (err) {
            // Откат состояния
            setWarehouseStock(warehouseStock);
            setStandStock(standStock);
            setMachineData(machineData);
            showNotification(err.response?.data?.error || 'Ошибка при перемещении');
        } finally {
             setRowLoading(prev => ({ ...prev, [itemName]: false }));
        }
    };

    const renderStepSelector = () => (
        <div className="step-selector-container">
            <div className="step-selector">
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
        </div>
    );

    const renderInventoryGrid = () => (
        <div className="inventory-grid">
            <div className="grid-header">
                <span className="col-wh">Склад</span>
                <span className="col-transfer"></span>
                <button className="terminal-selector-btn" onClick={() => setIsTerminalModalOpen(true)}>
                    {selectedTerminal ? selectedTerminal.comment || `Стойка #${selectedTerminal.id}` : 'Выберите стойку'}
                </button>
                <span className="col-transfer"></span>
                <span className="col-machine">Машина</span>
            </div>
            {ALL_ITEMS.map(item => {
                const { name, unit, type, multiplier } = item;
                const whStock = warehouseStock[name] || 0;
                const stStock = standStock[name] || 0;
                const mData = machineData[name];
                
                const step = type === 'consumable' ? parseFloat(activeStepKg) : parseFloat(activeStepPcs);
                
                return (
                    <div className={`inventory-row ${isRowLoading[name] ? 'loading' : ''}`} key={name}>
                        <div className="wh-item-cell">
                            <button className="adjust-btn" onClick={() => handleWarehouseAdjust(name, -step)} disabled={whStock < (step * multiplier)}>-</button>
                            <div className="item-name-group">
                                <span className="item-name">{name}</span>
                                <span className="item-unit">{unit}</span>
                            </div>
                            <span className="stock-cell">{(whStock / multiplier).toLocaleString('ru-RU', {maximumFractionDigits: 2})}</span>
                            <button className="adjust-btn" onClick={() => handleWarehouseAdjust(name, step)}>+</button>
                        </div>
                        
                        <div className="transfer-arrows">
                            <button className="transfer-arrow left" onClick={() => handleTransfer({loc: 'stand', type: 'stand'}, {loc: 'warehouse', type: 'warehouse'}, name, step)} disabled={!selectedTerminal || stStock < (step * multiplier)}>{'<'}</button>
                            <button className="transfer-arrow right" onClick={() => handleTransfer({loc: 'warehouse', type: 'warehouse'}, {loc: 'stand', type: 'stand'}, name, step)} disabled={!selectedTerminal || whStock < (step * multiplier)}>{'>'}</button>
                        </div>

                        <span className="stock-cell">{(stStock / multiplier).toLocaleString('ru-RU', {maximumFractionDigits: 2})}</span>

                        <div className="transfer-arrows">
                           {type === 'consumable' ? (<>
                             <button className="transfer-arrow left" onClick={() => handleTransfer({loc: 'machine', type: 'machine'}, {loc: 'stand', type: 'stand'}, name, step)} disabled={!selectedTerminal || !mData || mData.current < (step * multiplier)}>{'<'}</button>
                             <button className="transfer-arrow right" onClick={() => handleTransfer({loc: 'stand', type: 'stand'}, {loc: 'machine', type: 'machine'}, name, step)} disabled={!selectedTerminal || stStock < (step * multiplier)}>{'>'}</button>
                           </>) : <span className="no-transfer-placeholder">-</span>}
                        </div>

                        <div className="machine-cell">
                            {type === 'consumable' && selectedTerminal && (
                                !mData || !mData.max ? (
                                    <span className="machine-info-placeholder" onClick={() => setIsStandDetailModalOpen(true)}>
                                        Заполните остатки
                                    </span>
                                ) : (
                                    <div className="progress-bar-container">
                                        <div className="progress-bar-fill" style={{ width: `${(mData.current / mData.max) * 100}%` }}></div>
                                        {mData.critical > 0 && <div className="progress-bar-critical-marker" style={{ left: `${(mData.critical / mData.max) * 100}%` }}></div>}
                                        <span className="progress-bar-text">{mData.current} / {mData.max} г</span>
                                    </div>
                                )
                            )}
                        </div>
                    </div>
                )
            })}
        </div>
    );

    if (isLoading) {
        return <div className="page-loading-container"><span>Загрузка склада...</span></div>;
    }

    return (
        <>
            <div className="page-container warehouse-page">
                {error && <div className="error-message">{error}</div>}
                {notification && <div className="info-notification">{notification}</div>}
                
                <div className="warehouse-header">
                    <div className="warehouse-header-content">
                        <button className="action-btn" onClick={() => setIsStockUpModalOpen(true)}>Приходовать товар</button>
                        <span className="header-hint">Пополнить центральный склад</span>
                    </div>
                </div>
                
                <div className="inventory-block">
                    <h3 className="inventory-block-title">Переместить остатки</h3>
                    {renderStepSelector()}
                    {renderInventoryGrid()}
                </div>

            </div>

            {isStockUpModalOpen && <StockUpModal onClose={() => setIsStockUpModalOpen(false)} onSuccess={fetchInitialData} />}
            
            {isTerminalModalOpen && (
                <TerminalListModal 
                    terminals={terminals}
                    onClose={() => setIsTerminalModalOpen(false)}
                    onSelect={handleTerminalSelect}
                    currentSelection={selectedTerminal?.id}
                />
            )}

            {isStandDetailModalOpen && selectedTerminal && (
                <StandDetailModal
                    terminal={selectedTerminal}
                    onClose={() => {
                        setIsStandDetailModalOpen(false);
                        fetchDataForTerminal(selectedTerminal); // Обновляем данные только для активной стойки
                    }}
                />
            )}
        </>
    );
}