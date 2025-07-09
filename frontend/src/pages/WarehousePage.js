// frontend/src/pages/WarehousePage.js
import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import apiClient from '../api';
import './WarehousePage.css';
import TerminalListModal from '../components/TerminalListModal';
import StandDetailModal from '../components/StandDetail/StandDetailModal';
import StandNavigator from '../components/StandDetail/StandNavigator';
import ConfirmModal from '../components/ConfirmModal';
import { ALL_ITEMS } from '../constants';
import '../components/StandDetail/StandNavigator.css';

const UNIFIED_STEPS = ['38000', '19000', '5000', '1000', '100', '10'];
const ITEMS_IN_PIECES = new Set(ALL_ITEMS.filter(i => i.unit === 'шт').map(i => i.name));
const WAREHOUSE_STATE_KEY = 'warehouse_page_state_v5';

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

const MachineProgressDisplay = ({ data, unit, onConfigureClick }) => {
    if (!data || data.max === null || data.max === undefined || data.max === 0) {
        return (
            <div className="configure-machine-notice" onClick={onConfigureClick}>
                <span>Настроить</span>
                <span className="arrow-icon">&gt;</span>
            </div>
        );
    }

    const { current, max, critical } = data;
    const percentage = max > 0 ? (current / max) * 100 : 0;
    
    let barColorClass = '';
    if (critical > 0) {
        if (current <= critical) {
            barColorClass = 'critical';
        } else if (current <= critical * 2) {
            barColorClass = 'high';
        }
    }

    const formattedCurrent = current % 1 === 0 ? Math.round(current) : current.toFixed(1);
    const formattedMax = max % 1 === 0 ? Math.round(max) : max.toFixed(1);

    return (
        <div className="machine-progress-bar-container">
            <div className={`machine-progress-fill ${barColorClass}`} style={{ width: `${Math.min(percentage, 100)}%` }} />
            {critical > 0 && <div className="machine-progress-critical-marker" style={{ left: `${(critical / max) * 100}%` }} />}
            <span className="machine-progress-text">{formattedCurrent} / {formattedMax} {unit}</span>
        </div>
    );
};

// --- Основной Компонент ---
export default function WarehousePage() {
    const navigate = useNavigate();
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState('');
    const [notification, setNotification] = useState({ message: '', isError: false });
    const [terminals, setTerminals] = useState([]);
    const [selectedTerminal, setSelectedTerminal] = useState(null);
    const [warehouseStock, setWarehouseStock] = useState({});
    const [standStock, setStandStock] = useState({});
    const [machineData, setMachineData] = useState({});
    const [isRowLoading, setRowLoading] = useState({});
    const [activeStep, setActiveStep] = useState('1000');
    const [transferMode, setTransferMode] = useState('stand');
    const [isStandDetailModalOpen, setIsStandDetailModalOpen] = useState(false);
    
    // УДАЛЯЕМ состояние, связанное со старым режимом пополнения склада
    // const [stockUpDeltas, setStockUpDeltas] = useState({});
    // const [isDirty, setIsDirty] = useState(false);
    // const [showConfirm, setShowConfirm] = useState(false);
    
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
                    const stockValue = Math.round(parseFloat(item.current_stock || 0));
                    const itemData = {
                        current: stockValue,
                        max: Math.round(parseFloat(item.max_stock || 0)),
                        critical: Math.round(parseFloat(item.critical_stock || 0))
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
                setWarehouseStock((warehouseRes.data.warehouseStock || []).reduce((acc, item) => ({...acc, [item.item_name]: Math.round(parseFloat(item.current_stock || 0))}), {}));
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
    }, [fetchDataForTerminal]);

    useEffect(() => {
        const savedState = JSON.parse(localStorage.getItem(WAREHOUSE_STATE_KEY));
        if (savedState) {
            setActiveStep(savedState.activeStep || '1000');
            setTransferMode(savedState.transferMode || 'stand');
        }
        fetchInitialData();
    }, [fetchInitialData]);

    useEffect(() => {
        if (!isLoading) {
            const stateToSave = {
                selectedTerminalId: selectedTerminal ? selectedTerminal.id : null,
                activeStep,
                transferMode,
            };
            localStorage.setItem(WAREHOUSE_STATE_KEY, JSON.stringify(stateToSave));
        }
    }, [selectedTerminal, activeStep, transferMode, isLoading]);

    // useEffect(() => {
    //     const hasChanges = Object.values(stockUpDeltas).some(q => q > 0);
    //     setIsDirty(hasChanges);
    // }, [stockUpDeltas]);
    
    const handleStockUpAdjust = (itemName, increment) => {
        const step = parseFloat(activeStep);
        setRowLoading(prev => ({ ...prev, [itemName]: true }));
        setWarehouseStock(prev => {
            const currentDelta = prev[itemName] || 0;
            const newDelta = Math.max(0, currentDelta + (step * increment));
            const finalValue = ITEMS_IN_PIECES.has(itemName) ? Math.round(newDelta) : parseFloat(newDelta.toFixed(3));
            return { ...prev, [itemName]: finalValue };
        });
        setRowLoading(prev => ({ ...prev, [itemName]: false }));
    };

    const handleStockUpSubmit = async (e) => {
        if (e) e.preventDefault();
        // ... (логика отправки, скопированная из StockUpModal)
    };

    const handleWarehouseAdjust = async (itemName, increment) => {
        const step = parseFloat(activeStep);
        const currentStock = warehouseStock[itemName] || 0;

        // ИСПРАВЛЕНИЕ: Если списываем, то не больше, чем есть на складе
        const quantity = increment < 0 ? -Math.min(step, currentStock) : step;

        if (quantity === 0) return; // Если нечего менять, выходим

        setRowLoading(prev => ({ ...prev, [itemName]: true }));
        try {
            const response = await apiClient.post('/warehouse/adjust', { item_name: itemName, quantity });
            if (response.data.success) {
                setWarehouseStock(prev => ({ ...prev, [itemName]: response.data.new_stock }));
            } else {
                showNotification(response.data.error || 'Ошибка изменения остатка', true);
            }
        } catch (err) {
            showNotification(err.response?.data?.error || 'Сетевая ошибка', true);
        } finally {
            setRowLoading(prev => ({ ...prev, [itemName]: false }));
        }
    };

    const handleTerminalSelect = (terminal) => {
        fetchDataForTerminal(terminal);
        setIsStandDetailModalOpen(false);
    };

    const handleTransfer = async (fromLoc, toLoc, itemName, step) => {
        if (!selectedTerminal?.internalId) {
            showNotification("Стойка не выбрана.", true);
            return;
        }

        const stepQuantity = step; // Шаг уже в базовых единицах (г, мл, шт)

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
             const reason = sourceStock <= 0 ? "Нет в наличии." : "Нет свободного места.";
             showNotification(reason, true);
             return;
        }

        setRowLoading(prev => ({ ...prev, [itemName]: true }));

        try {
            const fromPayload = { location: fromLoc, terminal_id: fromLoc === 'warehouse' ? null : selectedTerminal.internalId };
            const toPayload = { location: toLoc, terminal_id: toLoc === 'warehouse' ? null : selectedTerminal.internalId };
            const response = await apiClient.post('/inventory/move', { from: fromPayload, to: toPayload, item_name: itemName, quantity: quantityToTransfer });
            
            if (response.data.success && response.data.updatedStock) {
                const { from, to } = response.data.updatedStock;

                // Округляем до целых, чтобы избежать ошибок с плавающей точкой
                const newFromStock = Math.round(parseFloat(from.new_stock));
                const newToStock = Math.round(parseFloat(to.new_stock));

                if (from.location === 'warehouse') {
                    setWarehouseStock(prev => ({ ...prev, [itemName]: newFromStock }));
                } else if (from.location === 'stand') {
                    setStandStock(prev => ({ ...prev, [itemName]: { ...(prev[itemName] || {}), current: newFromStock } }));
                } else if (from.location === 'machine') {
                    setMachineData(prev => ({ ...prev, [itemName]: { ...(prev[itemName] || {}), current: newFromStock } }));
                }

                if (to.location === 'warehouse') {
                    setWarehouseStock(prev => ({ ...prev, [itemName]: newToStock }));
                } else if (to.location === 'stand') {
                    setStandStock(prev => ({ ...prev, [itemName]: { ...(prev[itemName] || {}), current: newToStock } }));
                } else if (to.location === 'machine') {
                    setMachineData(prev => ({ ...prev, [itemName]: { ...(prev[itemName] || {}), current: newToStock } }));
                }
                
            } else {
                showNotification(response.data.error || 'Ошибка перемещения', true);
            }
        } catch (err) {
            showNotification(err.response?.data?.error || 'Сетевая ошибка', true);
        } finally {
            setRowLoading(prev => ({ ...prev, [itemName]: false }));
        }
    };
    
    const renderStepSelector = () => (
        <div className="step-selectors-container">
            <div className="panel-header">
                {/* ИЗМЕНЕНИЕ: h4 заменен на div, удален специфичный класс */}
                <div>2. Шаг (единицы*)</div>
                <p className="steps-header-note">* - гр / мл / шт</p>
            </div>
            <div className="step-selector-buttons">
                {UNIFIED_STEPS.map(step => (
                    <button type="button" key={step}
                        className={`control-btn step-btn ${activeStep === step ? 'active' : ''}`}
                        onClick={() => setActiveStep(step)}>
                        {parseInt(step, 10).toLocaleString('ru-RU')}
                    </button>
                ))}
            </div>
        </div>
    );

    const renderTable = () => {
        if (transferMode === 'stand') {
            return (
                <div className="inventory-table mode-stand">
                    <div className="inventory-header">
                        <div className="item-name-cell">Название</div>
                        <div className="unit-cell">Ед.</div>
                        <div className="stock-cell">Склад</div>
                        <div className="arrow-cell"></div>
                        <div className="arrow-cell"></div>
                        <div className="stock-cell">Стойка</div>
                    </div>
                    {ALL_ITEMS.map(item => renderStandRow(item))}
                </div>
            );
        }

        if (transferMode === 'machine') {
            return (
                <div className="inventory-table mode-machine">
                    <div className="inventory-header">
                        <div className="header-merged-stock">Кол-во в стойке</div>
                        <div className="header-merged-container">Контейнер</div>
                    </div>
                    {ALL_ITEMS.map(item => renderMachineRow(item))}
                </div>
            );
        }
        return null;
    };
    
    const renderStandRow = (item) => {
        const { name, unit } = item;
        const step = parseFloat(activeStep);
        const whValue = warehouseStock[name] || 0;
        const stData = standStock[name];
        const stValue = stData?.current || 0;
        const isPiece = unit === 'шт';
        const displayUnit = { 'г': 'кг', 'мл': 'л', 'шт': 'шт' }[unit] || unit;
        const formatValue = (val) => (isPiece ? val : val / 1000).toLocaleString('ru-RU', { maximumFractionDigits: 2 });
        
        return (
            <React.Fragment key={name}>
                <div className={`inventory-row`}>
                    <div className={`item-name-cell ${isRowLoading[name] ? 'loading-cell' : ''}`}>{name}</div>
                    <div className={`unit-cell ${isRowLoading[name] ? 'loading-cell' : ''}`}>{displayUnit}</div>
                    <div className={`stock-cell ${whValue === 0 ? 'zero-stock' : ''} ${isRowLoading[name] ? 'loading-cell' : ''}`}>{formatValue(whValue)}</div>
                    <div className={`arrow-cell ${isRowLoading[name] ? 'loading-cell' : ''}`}>
                        <button className="transfer-arrow left" onClick={() => handleTransfer('stand', 'warehouse', name, step)} disabled={stValue <= 0}>&lt;</button>
                    </div>
                    <div className={`arrow-cell ${isRowLoading[name] ? 'loading-cell' : ''}`}>
                        <button className="transfer-arrow right" onClick={() => handleTransfer('warehouse', 'stand', name, step)} disabled={whValue <= 0}>&gt;</button>
                    </div>
                    <div className={`stock-cell ${stValue === 0 ? 'zero-stock' : ''} ${isRowLoading[name] ? 'loading-cell' : ''}`}>{formatValue(stValue)}</div>
                </div>
            </React.Fragment>
        );
    };

    const renderMachineRow = (item) => {
        const { name, unit } = item;
        const step = parseFloat(activeStep);
        const stData = standStock[name];
        const stValue = stData?.current || 0;
        const mcData = machineData[name];
        const mcValue = mcData?.current || 0;
        
        return (
            <React.Fragment key={name}>
                <div className={`inventory-row`}>
                    <div className={`item-name-cell ${isRowLoading[name] ? 'loading-cell' : ''}`}>{name}</div>
                    <div className={`stock-cell ${stValue === 0 ? 'zero-stock' : ''} ${isRowLoading[name] ? 'loading-cell' : ''}`}>
                        {stValue.toLocaleString('ru-RU')} {unit}
                    </div>
                    <div className={`arrow-cell ${isRowLoading[name] ? 'loading-cell' : ''}`}>
                        <button className="transfer-arrow left" onClick={() => handleTransfer('machine', 'stand', name, step)} disabled={mcValue <= 0}>&lt;</button>
                    </div>
                    <div className={`arrow-cell ${isRowLoading[name] ? 'loading-cell' : ''}`}>
                        <button className="transfer-arrow right" onClick={() => handleTransfer('stand', 'machine', name, step)} disabled={stValue <= 0}>&gt;</button>
                    </div>
                    <div className={`machine-cell ${isRowLoading[name] ? 'loading-cell' : ''}`}>
                        <MachineProgressDisplay data={mcData} unit={unit} onConfigureClick={handleOpenConfigure} />
                    </div>
                </div>
            </React.Fragment>
        );
    };

    const handleOpenConfigure = () => {
        if (selectedTerminal) {
            navigate('#settings');
            setIsStandDetailModalOpen(true);
        }
    };

    const renderWarehouseMode = () => (
        <div className="warehouse-mode-table">
            {/* Шапка удалена */}
            {ALL_ITEMS.map(item => {
                const whValue = warehouseStock[item.name] || 0;
                const isKgOrL = ['г', 'мл'].includes(item.unit);
                const displayValue = isKgOrL ? whValue / 1000 : whValue;
                const displayUnit = isKgOrL ? (item.unit === 'г' ? 'кг' : 'л') : item.unit;

                return (
                    <div className={`inventory-row ${isRowLoading[item.name] ? 'loading-cell-row' : ''}`} key={item.name}>
                        <div className="item-name-cell">{item.name}</div>
                        <div className="adjust-cell">
                            <button className="adjust-btn minus" onClick={() => handleWarehouseAdjust(item.name, -1)} disabled={whValue <= 0}>-</button>
                        </div>
                        <div className="stock-cell">
                            {displayValue.toLocaleString('ru-RU', { maximumFractionDigits: 3 })} <span className="unit-label">{displayUnit}</span>
                        </div>
                        <div className="adjust-cell">
                            <button className="adjust-btn plus" onClick={() => handleWarehouseAdjust(item.name, 1)}>+</button>
                        </div>
                    </div>
                )
            })}
        </div>
    );
    
    const renderActiveModeView = () => {
        if (transferMode === 'warehouse') return renderWarehouseMode();
        return renderTable();
    };

    if (isLoading) return <div className="page-loading-container"><span>Загрузка склада...</span></div>;

    return (
        <>
            {/* ConfirmModal больше не нужен */}
            <div className="page-container warehouse-page">
                {error && <div className="error-message">{error}</div>}
                
                {/* 1. Возвращаем переключатель режимов */}
                <div className="mode-selector-container">
                    <div className="panel-header">
                         {/* ИЗМЕНЕНИЕ: h4 заменен на div, удален специфичный класс */}
                         <div>1. Выберите, какой инвентарь пополнить</div>
                    </div>
                    <div className="mode-selector-buttons">
                        <button className={`control-btn ${transferMode === 'warehouse' ? 'active' : ''}`} onClick={() => setTransferMode('warehouse')}>Склад</button>
                        <button className={`control-btn ${transferMode === 'stand' ? 'active' : ''}`} onClick={() => setTransferMode('stand')}>Стойка</button>
                        <button className={`control-btn ${transferMode === 'machine' ? 'active' : ''}`} onClick={() => setTransferMode('machine')}>Кофемашина</button>
                    </div>
                </div>

                {/* 2. Блок выбора шага теперь здесь, под переключателем и для всех режимов */}
                {renderStepSelector()}

                {transferMode !== 'warehouse' && (
                    <div className="warehouse-top-panel stand-selector-panel">
                        {selectedTerminal && terminals.length > 0 ? (
                            <StandNavigator
                                terminal={selectedTerminal}
                                allTerminals={terminals}
                                onTerminalChange={handleTerminalSelect}
                                onNameClick={() => setIsStandDetailModalOpen(true)}
                            />
                        ) : (
                            <div className="stand-navigator-placeholder" onClick={() => setIsStandDetailModalOpen(true)}>
                                <span>{terminals.length === 0 ? 'Нет доступных стоек' : 'Нажмите, чтобы выбрать'}</span>
                            </div>
                        )}
                    </div>
                )}
                
                <div className="inventory-block">
                    {renderActiveModeView()}
                </div>
            </div>
            {isStandDetailModalOpen && selectedTerminal && <StandDetailModal terminal={selectedTerminal} allTerminals={terminals} onTerminalChange={handleTerminalSelect} onClose={() => { setIsStandDetailModalOpen(false); navigate('#'); fetchDataForTerminal(selectedTerminal); }} />}
        </>
    );
}