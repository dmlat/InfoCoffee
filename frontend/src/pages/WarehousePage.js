// frontend/src/pages/WarehousePage.js
import React, { useState, useEffect, useCallback } from 'react';
import apiClient from '../api';
import './WarehousePage.css';
import StockUpModal from '../components/StockUpModal';
import TerminalListModal from '../components/TerminalListModal';
import QuickTransferModal from '../components/QuickTransferModal';

const MACHINE_ITEMS = ['Кофе', 'Сливки', 'Какао', 'Раф', 'Вода'];
const STAND_ITEMS = ['Стаканы', 'Крышки', 'Размеш.', 'Сахар']; // Сократили "Размешиватели"
const ABBREVIATIONS = {
    'Размешиватели': 'Размеш.'
};


const formatStock = (item_name, stock) => {
    const numStock = parseFloat(stock) || 0;
    if (MACHINE_ITEMS.includes(item_name) && item_name !== 'Вода') {
        return `${(numStock / 1000).toLocaleString('ru-RU', {maximumFractionDigits: 2})} кг`;
    }
    if (item_name === 'Вода') {
        return `${(numStock / 1000).toLocaleString('ru-RU', {maximumFractionDigits: 2})} л`;
    }
    return `${numStock.toLocaleString('ru-RU')} шт`;
};

export default function WarehousePage() {
    const [terminals, setTerminals] = useState([]);
    const [from, setFrom] = useState({ type: 'warehouse', terminalId: null, terminalName: 'Склад', inventory: [] });
    const [to, setTo] = useState({ type: 'stand', terminalId: null, terminalName: '', inventory: [] });
    
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState('');

    const [isStockUpModalOpen, setIsStockUpModalOpen] = useState(false);
    const [terminalModal, setTerminalModal] = useState({ isOpen: false, panel: null });
    const [quickTransferModal, setQuickTransferModal] = useState({ isOpen: false, request: null });

    const fetchInventory = useCallback(async (location) => {
        if (!location) return [];
        try {
            if (location.type === 'warehouse') {
                const res = await apiClient.get('/warehouse');
                return res.data.success ? res.data.warehouseStock || [] : [];
            }
            if (location.terminalId && (location.type === 'stand' || location.type === 'machine')) {
                const res = await apiClient.get(`/terminals/vendista/${location.terminalId}/details`);
                const inventory = res.data.success ? res.data.details?.inventory || [] : [];
                return inventory.filter(item => item.location === location.type);
            }
        } catch(err) {
            console.error(`Failed to fetch inventory for`, location, err);
            setError(`Ошибка загрузки данных.`);
        }
        return [];
    }, []);

    const updatePanel = useCallback(async (panelSetter, panelState) => {
        const inventory = await fetchInventory(panelState);
        panelSetter(prev => ({ ...prev, ...panelState, inventory }));
    }, [fetchInventory]);
    
    useEffect(() => {
        const loadInitialData = async () => {
            setIsLoading(true);
            setError('');
            try {
                const terminalsResponse = await apiClient.get('/terminals');
                if (!terminalsResponse.data.success) throw new Error('Не удалось загрузить список стоек.');
                
                const fetchedTerminals = terminalsResponse.data.terminals || [];
                setTerminals(fetchedTerminals);

                const initialFrom = { type: 'warehouse', terminalId: null, terminalName: 'Склад' };
                let initialTo = { type: 'stand', terminalId: null, terminalName: 'Выберите стойку' };

                if (fetchedTerminals.length > 0) {
                    initialTo = { 
                        type: 'stand', 
                        terminalId: fetchedTerminals[0]?.id, 
                        terminalName: fetchedTerminals[0]?.comment || `Стойка #${fetchedTerminals[0]?.id}`
                    };
                }


                const [fromInventory, toInventory] = await Promise.all([
                    fetchInventory(initialFrom),
                    fetchInventory(initialTo)
                ]);

                setFrom({ ...initialFrom, inventory: fromInventory });
                setTo({ ...initialTo, inventory: toInventory });

            } catch (err) {
                setError(err.response?.data?.error || err.message || 'Ошибка сети при загрузке данных.');
            } finally {
                setIsLoading(false);
            }
        };
        loadInitialData();
    }, [fetchInventory]);

    const handleLocationTypeChange = (panel, newType) => {
        const panelSetter = panel === 'from' ? setFrom : setTo;
        let newTerminalId = null;
        let newTerminalName = '';

        if (newType === 'warehouse') {
            newTerminalName = 'Склад';
        } else if (terminals.length > 0) {
            const oppositePanelState = panel === 'from' ? to : from;
            let defaultTerminal = terminals.find(t => t.id !== oppositePanelState.terminalId) || terminals[0];
            
            if (isInvalidMove({type: newType, terminalId: defaultTerminal.id }, oppositePanelState)) {
                 defaultTerminal = terminals.find(t => t.id !== oppositePanelState.terminalId && t.id !== defaultTerminal.id) || defaultTerminal;
            }

            newTerminalId = defaultTerminal.id;
            newTerminalName = defaultTerminal.comment;
        } else {
            newTerminalName = 'Нет доступных стоек';
        }
        
        updatePanel(panelSetter, { type: newType, terminalId: newTerminalId, terminalName: newTerminalName });
    };
    
    const handleTerminalSelect = (terminal) => {
        if (!terminalModal.panel) return;
        const panelSetter = terminalModal.panel === 'from' ? setFrom : setTo;
        const currentPanelState = terminalModal.panel === 'from' ? from : to;
        updatePanel(panelSetter, { type: currentPanelState.type, terminalId: terminal.id, terminalName: terminal.comment });
    };

    const handleSuccessAction = useCallback(() => {
        updatePanel(setFrom, from);
        updatePanel(setTo, to);
    }, [from, to, updatePanel]);
    
    const isInvalidMove = (source, destination) => {
        if (!source || !destination) return true;
        return source.type === destination.type && source.terminalId === destination.terminalId;
    };

    const renderLocationSelector = (panel) => {
        const state = panel === 'from' ? from : to;
        const oppositeState = panel === 'from' ? to : from;
        const panelTitle = panel === 'from' ? '1. Укажите откуда' : '2. Укажите, куда';

        return (
             <div className="location-panel">
                <h4 className="transfer-panel-header">{panelTitle}</h4>
                <div className="location-buttons-horizontal">
                    <button 
                        className={state.type === 'warehouse' ? 'active' : ''} 
                        onClick={() => handleLocationTypeChange(panel, 'warehouse')}
                        disabled={oppositeState.type === 'warehouse'}
                    >Склад</button>
                    <button className={state.type === 'stand' ? 'active' : ''} onClick={() => handleLocationTypeChange(panel, 'stand')}>Стойка</button>
                    <button className={state.type === 'machine' ? 'active' : ''} onClick={() => handleLocationTypeChange(panel, 'machine')}>Машина</button>
                </div>
                <div 
                    className={`terminal-display ${state.type === 'warehouse' ? 'disabled' : ''}`} 
                    onClick={() => state.type !== 'warehouse' && setTerminalModal({ isOpen: true, panel })}
                >
                    {state.type === 'warehouse' ? 'Центральный склад' : (state.terminalName || 'Выберите стойку')}
                </div>
            </div>
        );
    };

    const renderInventoryRow = (itemName) => {
        const fromItem = from.inventory.find(i => i.item_name === itemName) || { current_stock: 0 };
        const toItem = to.inventory.find(i => i.item_name === itemName) || { current_stock: 0 };
        
        const openModal = (direction) => {
            const source = direction === 'to' ? from : to;
            const destination = direction === 'to' ? to : from;
            
            if (isInvalidMove(source, destination)) return;

            setQuickTransferModal({ 
                isOpen: true,
                request: { 
                    item_name: itemName, 
                    currentStock: source.inventory.find(i=>i.item_name === itemName)?.current_stock || 0, 
                    from: source, 
                    to: destination 
                }
            });
        };

        const displayName = ABBREVIATIONS[itemName] || itemName;

        return (
            <div className="inventory-row" key={itemName}>
                <span className="inv-item-name">{displayName}</span>
                <span className="inv-item-stock">{formatStock(itemName, fromItem.current_stock)}</span>
                <div className="inv-item-arrows">
                    <button className="arrow-left" onClick={() => openModal('from')} disabled={toItem.current_stock <= 0 || isInvalidMove(to, from)}>{'<'}</button>
                    <button className="arrow-right" onClick={() => openModal('to')} disabled={fromItem.current_stock <= 0 || isInvalidMove(from, to)}>{'>'}</button>
                </div>
                <span className="inv-item-stock">{formatStock(itemName, toItem.current_stock)}</span>
                <span className="inv-item-name-right">{displayName}</span>
            </div>
        );
    };

    const getPanelDisplayName = (panelState) => {
        if (panelState.type === 'warehouse') return 'Склад';
        return panelState.terminalName || 'Не выбрано';
    };


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
                        <span className="header-hint">Пополнить склад</span>
                    </div>
                </div>
                
                <div className="warehouse-block-container">
                    <h3 className="block-title">Переместить остатки</h3>
                    <div className="warehouse-transfer-container">
                        {renderLocationSelector('from')}
                        <div className="transfer-divider"></div>
                        {renderLocationSelector('to')}
                    </div>
                </div>
                
                <div className="warehouse-block-container">
                    <h3 className="block-title">3. Выберите, что переместить</h3>
                     <div className="inventory-grid-header">
                        <span>{getPanelDisplayName(from)}</span>
                        <span>{getPanelDisplayName(to)}</span>
                    </div>
                    <div className="inventory-grid">
                        <div className="inventory-section">
                            {MACHINE_ITEMS.map(renderInventoryRow)}
                        </div>
                        <hr className="inventory-separator" />
                        <div className="inventory-section">
                            {STAND_ITEMS.map(renderInventoryRow)}
                        </div>
                    </div>
                </div>
            </div>

            {isStockUpModalOpen && <StockUpModal onClose={() => setIsStockUpModalOpen(false)} onSuccess={handleSuccessAction} />}
            
            {terminalModal.isOpen && (
                <TerminalListModal 
                    terminals={terminals}
                    onClose={() => setTerminalModal({ isOpen: false, panel: null })}
                    onSelect={handleTerminalSelect}
                    currentSelection={terminalModal.panel === 'from' ? from.terminalId : to.terminalId}
                    excludeLocation={terminalModal.panel === 'to' ? from : null}
                />
            )}

            {quickTransferModal.isOpen && (
                <QuickTransferModal 
                    moveRequest={quickTransferModal.request}
                    onClose={() => setQuickTransferModal({ isOpen: false, request: null })}
                    onSuccess={handleSuccessAction}
                />
            )}
        </>
    );
}