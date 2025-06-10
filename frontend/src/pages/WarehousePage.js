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
const WAREHOUSE_STATE_KEY = 'warehouse_page_state_v2';

// --- Основной Компонент ---
export default function WarehousePage() {
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
    
    const showNotification = (message, isError = false) => {
        setNotification({ message, isError });
        setTimeout(() => setNotification(''), 3500);
    };
    
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
            setTerminals(terminalsRes.data.terminals || []);

            if (warehouseRes.data.success) {
                const stockMap = (warehouseRes.data.warehouseStock || []).reduce((acc, item) => {
                    acc[item.item_name] = parseFloat(item.current_stock || 0);
                    return acc;
                }, {});
                setWarehouseStock(stockMap);
            }

            const fetchedTerminals = terminalsRes.data.terminals || [];
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
        const stateToSave = {
            selectedTerminalId: selectedTerminal ? selectedTerminal.id : null,
            activeStepKg,
            activeStepPcs,
        };
        localStorage.setItem(WAREHOUSE_STATE_KEY, JSON.stringify(stateToSave));
    }, [selectedTerminal, activeStepKg, activeStepPcs]);

    const handleTerminalSelect = (terminal) => {
        fetchDataForTerminal(terminal);
        setIsTerminalModalOpen(false);
    };

    const handleWarehouseAdjust = async (itemName, step) => {
        const { multiplier } = getUnitInfo(itemName);
        const quantity = step * multiplier;

        const originalStock = warehouseStock[itemName] || 0;
        setWarehouseStock(prev => ({ ...prev, [itemName]: originalStock + quantity }));
        setRowLoading(prev => ({ ...prev, [itemName]: true }));

        try {
            const res = await apiClient.post('/warehouse/adjust', { item_name: itemName, quantity });
            if (res.data.success) {
                setWarehouseStock(prev => ({ ...prev, [itemName]: parseFloat(res.data.new_stock) }));
            } else {
                setWarehouseStock(prev => ({ ...prev, [itemName]: originalStock }));
                showNotification(res.data.error || 'Ошибка обновления', true);
            }
        } catch (err) {
            setWarehouseStock(prev => ({ ...prev, [itemName]: originalStock }));
            showNotification(err.response?.data?.error || "Сетевая ошибка", true);
        } finally {
            setRowLoading(prev => ({ ...prev, [itemName]: false }));
        }
    };
    
    const handleTransfer = async (fromLoc, toLoc, itemName, step) => {
        const { multiplier } = getUnitInfo(itemName);
        const stepQuantity = step * multiplier;
        
        if (!selectedTerminal?.internalId) {
            showNotification("Стойка не выбрана или не имеет ID в системе.", true);
            return;
        }

        const sourceStock = fromLoc === 'warehouse' ? warehouseStock[itemName] : (fromLoc === 'stand' ? standStock[itemName] : machineData[itemName]?.current);
        if ((sourceStock || 0) <= 0) {
            showNotification(`В источнике "${itemName}" нет остатков.`, true);
            return;
        }

        let quantityToTransfer = Math.min(stepQuantity, sourceStock || 0);

        if (toLoc === 'machine') {
            const itemInData = machineData[itemName];
            const maxStock = itemInData?.max || Infinity;
            const currentStock = itemInData?.current || 0;
            const freeSpace = maxStock - currentStock;
            quantityToTransfer = Math.min(quantityToTransfer, freeSpace);
        }

        if (quantityToTransfer <= 0) {
            showNotification("Нет свободного места в машине.", true);
            return;
        }
        
        // Сохраняем оригинальные значения для отката
        const originalStates = {
            warehouse: warehouseStock,
            stand: standStock,
            machine: machineData,
        };

        // --- Оптимистичное обновление ---
        const updateState = (setter, location, amount) => {
            setter(prev => ({ ...prev, [itemName]: (prev[itemName] || 0) + amount }));
        };
        const updateMachineState = (amount) => {
            setMachineData(prev => ({...prev, [itemName]: {...(prev[itemName] || {}), current: (prev[itemName]?.current || 0) + amount}}));
        };
        
        if(fromLoc === 'warehouse') updateState(setWarehouseStock, itemName, -quantityToTransfer);
        if(fromLoc === 'stand') updateState(setStandStock, itemName, -quantityToTransfer);
        if(fromLoc === 'machine') updateMachineState(-quantityToTransfer);
        
        if(toLoc === 'warehouse') updateState(setWarehouseStock, itemName, quantityToTransfer);
        if(toLoc === 'stand') updateState(setStandStock, itemName, quantityToTransfer);
        if(toLoc === 'machine') updateMachineState(quantityToTransfer);
        // --- Конец оптимистичного обновления ---

        setRowLoading(prev => ({ ...prev, [itemName]: true }));

        try {
            const fromPayload = { location: fromLoc, terminal_id: fromLoc === 'warehouse' ? null : selectedTerminal.internalId };
            const toPayload = { location: toLoc, terminal_id: toLoc === 'warehouse' ? null : selectedTerminal.internalId };

            await apiClient.post('/inventory/move', { from: fromPayload, to: toPayload, item_name: itemName, quantity: quantityToTransfer });
            
            // Запрашиваем актуальные данные для синхронизации после успешной операции
            await Promise.all([
                apiClient.get('/warehouse').then(res => {
                    if(res.data.success) setWarehouseStock((res.data.warehouseStock || []).reduce((acc, item) => ({...acc, [item.item_name]: parseFloat(item.current_stock||0)}), {}));
                }),
                fetchDataForTerminal(selectedTerminal)
            ]);
            
        } catch (err) {
            // Откат состояния в случае ошибки
            setWarehouseStock(originalStates.warehouse);
            setStandStock(originalStates.stand);
            setMachineData(originalStates.machine);
            showNotification(err.response?.data?.error || 'Ошибка при перемещении', true);
        } finally {
             setRowLoading(prev => ({ ...prev, [itemName]: false }));
        }
    };

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
        const whStock = warehouseStock[name] || 0;
        const stStock = standStock[name] || 0;
        const mData = machineData[name];
        
        const step = type === 'consumable' ? parseFloat(activeStepKg) : parseFloat(activeStepPcs);
        const sourceForSt = whStock;
        const sourceForMc = stStock;

        return (
            <div className={`inventory-row-wrapper ${isRowLoading[name] ? 'loading' : ''}`} key={name}>
                <div className="row-item-name">
                    <div className="item-name-group">
                        <span className="item-name">{name}</span>
                        <span className="item-unit">{unit}</span>
                    </div>
                </div>
                <div className="row-locations">
                    <div className="location-cell warehouse-cell">
                        <span className="location-label">Склад</span>
                        <div className="stock-control">
                            <button className="adjust-btn" onClick={() => handleWarehouseAdjust(name, -step)} disabled={whStock < (step * multiplier)}>-</button>
                            <span className="stock-value">{(whStock / multiplier).toLocaleString('ru-RU', {maximumFractionDigits: 2})}</span>
                            <button className="adjust-btn" onClick={() => handleWarehouseAdjust(name, step)}>+</button>
                        </div>
                    </div>

                    <div className="transfer-cell">
                        <button className="transfer-arrow right" onClick={() => handleTransfer('warehouse', 'stand', name, step)} disabled={!selectedTerminal || sourceForSt < 1}>{'>'}</button>
                        <button className="transfer-arrow left" onClick={() => handleTransfer('stand', 'warehouse', name, step)} disabled={!selectedTerminal || stStock < 1}>{'<'}</button>
                    </div>

                    <div className="location-cell stand-cell">
                         <span className="location-label">Стойка</span>
                         <span className="stock-value">{(stStock / multiplier).toLocaleString('ru-RU', {maximumFractionDigits: 2})}</span>
                    </div>

                    {type === 'consumable' ? (
                        <>
                        <div className="transfer-cell">
                             <button className="transfer-arrow right" onClick={() => handleTransfer('stand', 'machine', name, step)} disabled={!selectedTerminal || sourceForMc < 1}>{'>'}</button>
                             <button className="transfer-arrow left" onClick={() => handleTransfer('machine', 'stand', name, step)} disabled={!selectedTerminal || !mData || mData.current < 1}>{'<'}</button>
                        </div>

                        <div className="location-cell machine-cell">
                            <span className="location-label">Машина</span>
                            {selectedTerminal && (!mData || typeof mData.max !== 'number' || mData.max <= 0) ? (
                                    <span className="machine-info-placeholder" onClick={() => setIsStandDetailModalOpen(true)}>
                                        Заполните остатки
                                    </span>
                                ) : (
                                    <div className="progress-bar-container">
                                        <div className="progress-bar-fill" style={{ width: `${((mData?.current || 0) / (mData?.max || 1)) * 100}%` }}></div>
                                        {(mData?.critical || 0) > 0 && <div className="progress-bar-critical-marker" style={{ left: `${((mData.critical) / (mData.max || 1)) * 100}%` }}></div>}
                                        <span className="progress-bar-text">{mData?.current || 0} / {mData?.max || '∞'}</span>
                                    </div>
                                )
                            }
                        </div>
                        </>
                    ) : <div className="disposable-placeholder"></div> }
                </div>
            </div>
        )
    }


    if (isLoading) {
        return <div className="page-loading-container"><span>Загрузка склада...</span></div>;
    }

    return (
        <>
            <div className="page-container warehouse-page">
                {error && <div className="error-message">{error}</div>}
                {notification.message && <div className={`info-notification ${notification.isError ? 'error' : ''}`}>{notification.message}</div>}
                
                <div className="warehouse-header">
                    <button className="action-btn" onClick={() => setIsStockUpModalOpen(true)}>Приходовать товар</button>
                    <button className="terminal-selector-btn" onClick={() => setIsTerminalModalOpen(true)}>
                        Стойка: {selectedTerminal ? selectedTerminal.comment || `№${selectedTerminal.id}` : 'Не выбрана'}
                    </button>
                </div>
                
                <div className="inventory-block">
                    <h3 className="inventory-block-title">Переместить остатки</h3>
                    {renderStepSelector()}
                    <div className="inventory-grid">
                        {ALL_ITEMS.map(renderInventoryRow)}
                    </div>
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
                        fetchDataForTerminal(selectedTerminal);
                    }}
                />
            )}
        </>
    );
}