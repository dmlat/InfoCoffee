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
    { name: 'Размешиватели', unit: 'шт', multiplier: 1, type: 'disposable' },
    { name: 'Сахар', unit: 'шт', multiplier: 1, type: 'disposable' },
];

const getUnitInfo = (itemName) => ALL_ITEMS.find(i => i.name === itemName) || {};

// --- Основной Компонент ---

export default function WarehousePage() {
    // --- Состояния (States) ---
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState('');
    const [terminals, setTerminals] = useState([]);
    const [selectedTerminal, setSelectedTerminal] = useState(null);
    
    const [warehouseStock, setWarehouseStock] = useState({});
    const [standStock, setStandStock] = useState({});
    const [machineData, setMachineData] = useState({});

    const [activeStepKg, setActiveStepKg] = useState('1');
    const [activeStepPcs, setActiveStepPcs] = useState('100');
    
    const [isStockUpModalOpen, setIsStockUpModalOpen] = useState(false);
    const [isTerminalModalOpen, setIsTerminalModalOpen] = useState(false);
    const [isStandDetailModalOpen, setIsStandDetailModalOpen] = useState(false);

    // --- Загрузка данных (Переработанная логика) ---
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
                    if (item.location === 'stand') stand[item.item_name] = parseFloat(item.current_stock);
                    if (item.location === 'machine') machine[item.item_name] = { 
                        current: parseFloat(item.current_stock), 
                        max: parseFloat(item.max_stock), 
                        critical: parseFloat(item.critical_stock)
                    };
                });
                setStandStock(stand);
                setMachineData(machine);
                // Сохраняем внутренний ID терминала для будущих запросов
                setSelectedTerminal(prev => ({...prev, internalId: res.data.internalId}));
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
                apiClient.get('/terminals'),
                apiClient.get('/warehouse'),
            ]);

            if (!terminalsRes.data.success) throw new Error('Не удалось загрузить стойки');
            if (warehouseRes.data.success) {
                const stockMap = (warehouseRes.data.warehouseStock || []).reduce((acc, item) => {
                    acc[item.item_name] = parseFloat(item.current_stock);
                    return acc;
                }, {});
                setWarehouseStock(stockMap);
            }

            const fetchedTerminals = terminalsRes.data.terminals || [];
            setTerminals(fetchedTerminals);
            
            if (fetchedTerminals.length > 0) {
                const initialTerminal = fetchedTerminals[0];
                setSelectedTerminal(initialTerminal);
                await fetchDataForTerminal(initialTerminal); // Сразу грузим детали для первой стойки
            }
        } catch (err) {
            setError(err.response?.data?.error || err.message || 'Ошибка загрузки данных');
        } finally {
            setIsLoading(false);
        }
    }, [fetchDataForTerminal]);

    useEffect(() => {
        fetchInitialData();
    }, [fetchInitialData]);

    // --- Обработчики действий ---

    const handleTerminalSelect = (terminal) => {
        setSelectedTerminal(terminal);
        fetchDataForTerminal(terminal);
        setIsTerminalModalOpen(false);
    };

    const handleWarehouseAdjust = async (itemName, step) => {
        try {
            const res = await apiClient.post('/api/warehouse/adjust', { item_name: itemName, quantity: step });
            if (res.data.success) {
                setWarehouseStock(prev => ({ ...prev, [itemName]: parseFloat(res.data.new_stock) }));
            }
        } catch (err) {
            console.error("Failed to adjust stock:", err);
        }
    };

    const handleTransfer = async (fromLoc, toLoc, itemName, step) => {
        if (!selectedTerminal || !selectedTerminal.internalId) {
            setError("Внутренний ID терминала не загружен. Перемещение невозможно.");
            return;
        }

        let quantity = step * getUnitInfo(itemName).multiplier;
        
        const fromPayload = {
            location: fromLoc,
            terminal_id: fromLoc === 'warehouse' ? null : selectedTerminal.internalId
        };
        const toPayload = {
            location: toLoc,
            terminal_id: toLoc === 'warehouse' ? null : selectedTerminal.internalId
        };

        if (toLoc === 'machine') {
            const itemInData = machineData[itemName];
            const maxStock = itemInData?.max || 0;
            const currentStock = itemInData?.current || 0;
            const freeSpace = maxStock - currentStock;
            if (quantity > freeSpace) {
                quantity = freeSpace;
            }
        }

        if (quantity <= 0) return;

        try {
            await apiClient.post('/api/inventory/move', { from: fromPayload, to: toPayload, item_name: itemName, quantity });
            // Перезагружаем данные для склада и выбранной стойки
            const warehouseRes = await apiClient.get('/warehouse');
            if (warehouseRes.data.success) {
                 const stockMap = (warehouseRes.data.warehouseStock || []).reduce((acc, item) => {
                    acc[item.item_name] = parseFloat(item.current_stock);
                    return acc;
                }, {});
                setWarehouseStock(stockMap);
            }
            await fetchDataForTerminal(selectedTerminal);
        } catch (err) {
            console.error("Transfer failed", err);
            setError(err.response?.data?.error || 'Ошибка при перемещении');
        }
    };
    
    // ... (остальные рендер-функции без изменений) ...

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
                <span>Склад</span>
                <span></span>
                <button className="terminal-selector-btn" onClick={() => setIsTerminalModalOpen(true)}>
                    {selectedTerminal ? selectedTerminal.comment || `Стойка #${selectedTerminal.id}` : 'Выберите стойку'}
                </button>
                <span></span>
                <span>Машина</span>
            </div>
            {ALL_ITEMS.map(item => {
                const { name, unit, type, multiplier } = item;
                const whStock = warehouseStock[name] || 0;
                const stStock = standStock[name] || 0;
                const mData = machineData[name];
                
                const step = type === 'consumable' ? parseFloat(activeStepKg) : parseFloat(activeStepPcs);
                const stepInGrams = step * multiplier;

                return (
                    <div className="inventory-row" key={name}>
                        <div className="wh-item-cell">
                            <button className="adjust-btn" onClick={() => handleWarehouseAdjust(name, -stepInGrams)} disabled={whStock < stepInGrams}>-</button>
                            <div className="item-name-group">
                                <span className="item-name">{name}</span>
                                <span className="item-unit">{unit !== 'шт' ? unit : ''}</span>
                            </div>
                            <span className="stock-cell">{(whStock / multiplier).toLocaleString('ru-RU', {maximumFractionDigits: 2})}</span>
                            <button className="adjust-btn" onClick={() => handleWarehouseAdjust(name, stepInGrams)}>+</button>
                        </div>
                        
                        <div className="transfer-arrows">
                            <button className="transfer-arrow left" onClick={() => handleTransfer('stand', 'warehouse', name, step)} disabled={!selectedTerminal || stStock < stepInGrams}>{'<'} </button>
                            <button className="transfer-arrow right" onClick={() => handleTransfer('warehouse', 'stand', name, step)} disabled={!selectedTerminal || whStock < stepInGrams}>{'>'}</button>
                        </div>

                        <span className="stock-cell">{(stStock / multiplier).toLocaleString('ru-RU', {maximumFractionDigits: 2})}</span>

                        <div className="transfer-arrows">
                           {type === 'consumable' ? (<>
                             <button className="transfer-arrow left" onClick={() => handleTransfer('machine', 'stand', name, step)} disabled={!selectedTerminal || !mData || mData.current < stepInGrams}>{'<'}</button>
                             <button className="transfer-arrow right" onClick={() => handleTransfer('stand', 'machine', name, step)} disabled={!selectedTerminal || stStock < stepInGrams}>{'>'}</button>
                           </>) : <span>-</span>}
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
                                        <span className="progress-bar-text">{mData.current} / {mData.max}</span>
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