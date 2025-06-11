// frontend/src/pages/WarehousePage.js
import React, { useState, useEffect, useCallback } from 'react';
import apiClient from '../api';
import './WarehousePage.css';
import StockUpModal from '../components/StockUpModal';
import TerminalListModal from '../components/TerminalListModal';
import StandDetailModal from '../components/StandDetailModal';
import { ALL_ITEMS } from '../constants';

// --- Вспомогательные компоненты ---
const ProgressBar = ({ current, max, critical }) => {
    const percentage = max > 0 ? (current / max) * 100 : 0;
    let barColorClass = 'normal';
    if (percentage < 25) barColorClass = 'low';
    if (percentage < 10) barColorClass = 'critical';

    return (
        <div className="progress-bar-container">
            <div className={`progress-bar-fill ${barColorClass}`} style={{ width: `${Math.min(percentage, 100)}%` }}></div>
            {critical > 0 && max > 0 && <div className="progress-bar-critical-marker" style={{ left: `${(critical / max) * 100}%` }}></div>}
            <span className="progress-bar-text">{current.toLocaleString('ru-RU')} / {max.toLocaleString('ru-RU')}</span>
        </div>
    );
};


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
            setSelectedTerminal(null);
            return;
        }

        setSelectedTerminal(terminal); // Оптимистичное обновление
        
        try {
            const res = await apiClient.get(`/terminals/vendista/${terminal.id}/details`);
            if (res.data.success) {
                const inventory = res.data.details?.inventory || [];
                const newStandStock = {};
                const newMachineData = {};
                
                inventory.forEach(item => {
                    const stockValue = parseFloat(item.current_stock || 0);
                    const itemData = {
                        current: stockValue,
                        max: parseFloat(item.max_stock || 0),
                        critical: parseFloat(item.critical_stock || 0)
                    };
                    if (item.location === 'stand') newStandStock[item.item_name] = itemData;
                    else if (item.location === 'machine') newMachineData[item.item_name] = itemData;
                });

                setStandStock(newStandStock);
                setMachineData(newMachineData);
                setSelectedTerminal(prev => ({...prev, ...terminal, internalId: res.data.internalId}));
            }
        } catch (err) {
            setError(`Ошибка загрузки деталей для ${terminal.comment}`);
        }
    }, []);

    const fetchInitialData = useCallback(async (terminalToSelect = null) => {
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

            let terminalForDetails = terminalToSelect;
            if (!terminalForDetails) {
                const savedState = JSON.parse(localStorage.getItem(WAREHOUSE_STATE_KEY));
                if (savedState?.selectedTerminalId) {
                    terminalForDetails = fetchedTerminals.find(t => t.id === savedState.selectedTerminalId);
                }
            }
            if (!terminalForDetails && fetchedTerminals.length > 0) {
                terminalForDetails = fetchedTerminals[0];
            }
            
            if (terminalForDetails) {
                await fetchDataForTerminal(terminalForDetails);
            } else {
                 setStandStock({});
                 setMachineData({});
                 setSelectedTerminal(null);
            }

        } catch (err) {
            setError(err.response?.data?.error || err.message || 'Ошибка загрузки данных');
        } finally {
            setIsLoading(false);
        }
    }, [fetchDataForTerminal]); // <-- ИСПРАВЛЕНО: добавлена зависимость

    useEffect(() => {
        const savedState = JSON.parse(localStorage.getItem(WAREHOUSE_STATE_KEY));
        if (savedState) {
            setActiveStepKg(savedState.activeStepKg || '1');
            setActiveStepPcs(savedState.activeStepPcs || '100');
        }
        fetchInitialData();
    }, [fetchInitialData]);

    useEffect(() => {
        if (!isLoading) {
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

        const { multiplier } = ALL_ITEMS.find(i => i.name === itemName) || {};
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
                await fetchInitialData(selectedTerminal);
            } else {
                showNotification(response.data.error || 'Ошибка перемещения', true);
            }
        } catch (err) {
            showNotification(err.response?.data?.error || 'Сетевая ошибка', true);
        } finally {
            setRowLoading(prev => ({ ...prev, [itemName]: false }));
        }
    };
    
    // ... остальной код компонента без изменений ...
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
        const step = type === 'ingredient' ? parseFloat(activeStepKg) : parseFloat(activeStepPcs);
        
        const whValue = (warehouseStock[name] || 0) / multiplier;
        const stData = standStock[name];
        const mcData = machineData[name];

        const canFillMachine = stData && stData.current > 0;
        const machineHasStock = mcData && mcData.current > 0;
        const canFillStand = warehouseStock[name] > 0;
        const standHasStock = stData && stData.current > 0;

        return (
            <div className={`inventory-item-wrapper ${isRowLoading[name] ? 'loading' : ''}`} key={name}>
                <div className="inventory-row-main">
                    <div className="item-name-cell">{name}, {unit}</div>
                    <div className="stock-cell">{whValue.toLocaleString('ru-RU', {maximumFractionDigits: 2})}</div>
                    <div className="transfer-cell">
                        <button className="transfer-arrow left" onClick={() => handleTransfer('stand', 'warehouse', name, step)} disabled={!standHasStock}>{'<'}</button>
                        <button className="transfer-arrow right" onClick={() => handleTransfer('warehouse', 'stand', name, step)} disabled={!canFillStand}>{'>'}</button>
                    </div>
                    <div className="stock-cell">
                        {stData ? stData.current.toLocaleString('ru-RU') : '—'}
                    </div>
                </div>

                {type === 'ingredient' && (
                    <div className="inventory-row-machine">
                        <button className="adjust-btn-machine minus" onClick={() => handleTransfer('machine', 'stand', name, step)} disabled={!machineHasStock}>-</button>
                        <div className="progress-cell-machine">
                        {mcData && mcData.max > 0 ? (
                           <ProgressBar current={mcData.current} max={mcData.max} critical={mcData.critical} />
                        ) : (
                           <span className="placeholder-machine" onClick={() => setIsStandDetailModalOpen(true)}>Настройте остатки в машине →</span>
                        )}
                        </div>
                        <button className="adjust-btn-machine plus" onClick={() => handleTransfer('stand', 'machine', name, step)} disabled={!canFillMachine}>+</button>
                    </div>
                )}
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
                    <div className="inventory-grid">
                        <div className="inventory-grid-header">
                            <div>Название</div>
                            <div>Склад</div>
                            <div/>
                            <div>Стойка</div>
                        </div>
                         {ALL_ITEMS.map(renderInventoryRow)}
                    </div>
                </div>
            </div>

            {isStockUpModalOpen && <StockUpModal onClose={() => setIsStockUpModalOpen(false)} onSuccess={() => fetchInitialData(selectedTerminal)} />}
            {isTerminalModalOpen && <TerminalListModal terminals={terminals} onClose={() => setIsTerminalModalOpen(false)} onSelect={handleTerminalSelect} currentSelection={selectedTerminal?.id} />}
            {isStandDetailModalOpen && selectedTerminal && <StandDetailModal terminal={selectedTerminal} onClose={() => { setIsStandDetailModalOpen(false); fetchDataForTerminal(selectedTerminal); }} />}
        </>
    );
}