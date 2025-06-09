// frontend/src/pages/WarehousePage.js
import React, { useState, useEffect, useCallback } from 'react';
import apiClient from '../api';
import './WarehousePage.css';
import StockUpModal from '../components/StockUpModal';
import InventoryTransferModal from '../components/InventoryTransferModal';

const INVENTORY_ITEMS = ['Кофе', 'Сливки', 'Какао', 'Раф', 'Вода', 'Стаканы', 'Крышки', 'Размешиватели', 'Сахар'];

const TransferArrow = ({ onClick, disabled }) => (
    <button onClick={onClick} className="transfer-arrow-btn" disabled={disabled} title="Переместить">
        →
    </button>
);

export default function WarehousePage() {
    const [terminals, setTerminals] = useState([]);
    const [from, setFrom] = useState({ type: 'warehouse', terminalId: null, inventory: [] });
    const [to, setTo] = useState({ type: 'stand', terminalId: null, inventory: [] });
    
    const [fromIndex, setFromIndex] = useState(0);
    const [toIndex, setToIndex] = useState(0);
    
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState('');

    const [isStockUpModalOpen, setIsStockUpModalOpen] = useState(false);
    const [moveRequest, setMoveRequest] = useState(null);

    const fetchInventory = useCallback(async (location) => {
        if (!location) return [];
        try {
            if (location.type === 'warehouse') {
                const res = await apiClient.get('/warehouse');
                return res.data.warehouseStock || [];
            }
            if (location.terminalId && (location.type === 'stand' || location.type === 'machine')) {
                const res = await apiClient.get(`/terminals/vendista/${location.terminalId}/details`);
                return (res.data.details?.inventory || []).filter(item => item.location === location.type);
            }
        } catch(err) {
            console.error(`Failed to fetch inventory for`, location, err);
            setError(`Ошибка загрузки данных для ${location.type}.`);
        }
        return [];
    }, []);

    const loadAndSetInitialData = useCallback(async () => {
        setIsLoading(true);
        setError('');
        try {
            const terminalsResponse = await apiClient.get('/terminals');
            if (!terminalsResponse.data.success) throw new Error('Не удалось загрузить список стоек.');
            const fetchedTerminals = terminalsResponse.data.terminals || [];
            setTerminals(fetchedTerminals);

            const initialFrom = { type: 'warehouse', terminalId: null };
            const initialTo = { type: 'stand', terminalId: fetchedTerminals[0]?.id || null };
            
            const [fromInventory, toInventory] = await Promise.all([
                fetchInventory(initialFrom),
                fetchInventory(initialTo)
            ]);

            setFrom({ ...initialFrom, inventory: fromInventory });
            setTo({ ...initialTo, inventory: toInventory });

        } catch (err) {
            setError(err.message || 'Ошибка сети при загрузке данных.');
        } finally {
            setIsLoading(false);
        }
    }, [fetchInventory]);

    useEffect(() => {
        loadAndSetInitialData();
    }, [loadAndSetInitialData]);

    const handleLocationChange = async (panel, newType) => {
        const panelSetter = panel === 'from' ? setFrom : setTo;
        const panelState = panel === 'from' ? from : to;
        const setIndex = panel === 'from' ? setFromIndex : setToIndex;
        
        let newTerminalId = panelState.terminalId;
        if ((newType === 'stand' || newType === 'machine')) {
            newTerminalId = terminals[0]?.id || null;
            setIndex(0);
        } else if (newType === 'warehouse') {
            newTerminalId = null;
        }
        const newState = { ...panelState, type: newType, terminalId: newTerminalId };
        const inventory = await fetchInventory(newState);
        panelSetter({ ...newState, inventory });
    };

    const handleTerminalChange = async (panel, direction) => {
        if (!terminals || terminals.length < 2) return;
        const index = panel === 'from' ? fromIndex : toIndex;
        const setIndex = panel === 'from' ? setFromIndex : setToIndex;
        const panelSetter = panel === 'from' ? setFrom : setTo;
        const panelState = panel === 'from' ? from : to;

        const newIndex = (index + direction + terminals.length) % terminals.length;
        setIndex(newIndex);
        const newTerminalId = terminals[newIndex].id;
        const newState = { ...panelState, terminalId: newTerminalId };
        const inventory = await fetchInventory(newState);
        panelSetter({ ...newState, inventory });
    };

    const renderPanel = (panel, panelState, setIndex, title) => {
        const isStandSelectorActive = panelState.type === 'stand' || panelState.type === 'machine';
        const currentTerminal = terminals.find(t => t.id === panelState.terminalId);

        return (
            <div className="location-panel">
                <h4>{title}</h4>
                <div className="location-selector">
                    <button className={panelState.type === 'warehouse' ? 'active' : ''} onClick={() => handleLocationChange(panel, 'warehouse')}>Склад</button>
                    <button className={panelState.type === 'stand' ? 'active' : ''} onClick={() => handleLocationChange(panel, 'stand')}>Стойка</button>
                    <button className={panelState.type === 'machine' ? 'active' : ''} onClick={() => handleLocationChange(panel, 'machine')}>Машина</button>
                </div>
                <div className={`terminal-selector ${isStandSelectorActive ? 'active' : ''}`}>
                    <button onClick={() => handleTerminalChange(panel, -1)} disabled={!isStandSelectorActive || terminals.length < 2}>‹</button>
                    <span>{isStandSelectorActive ? (currentTerminal?.comment || 'Нет стоек') : '—'}</span>
                    <button onClick={() => handleTerminalChange(panel, 1)} disabled={!isStandSelectorActive || terminals.length < 2}>›</button>
                </div>
            </div>
        );
    };
    
    const handleMoveClick = (item_name, currentStock) => {
        const isSelfSelection = from.type !== 'warehouse' && from.type === to.type && from.terminalId === to.terminalId;
        if(isSelfSelection || currentStock <= 0) return;

        setMoveRequest({
            item_name,
            currentStock,
            from: { ...from, terminalName: terminals.find(t=>t.id === from.terminalId)?.comment },
            to: { ...to, terminalName: terminals.find(t=>t.id === to.terminalId)?.comment }
        });
    }

    if (isLoading) return <div className="page-loading-container">Загрузка...</div>;
    if (error) return <div className="error-message">{error}</div>;

    return (
        <>
            <div className="page-container warehouse-page">
                <div className="warehouse-header">
                    <button className="action-btn" onClick={() => setIsStockUpModalOpen(true)}>Приходовать товар</button>
                </div>

                <div className="warehouse-transfer-container">
                    {renderPanel('from', from, setFromIndex, 'ОТКУДА')}
                    <div className="transfer-arrow-visual">→</div>
                    {renderPanel('to', to, setToIndex, 'КУДА')}
                </div>
                
                <div className="inventory-view-container">
                    <h3>Остатки в источнике ({from.type === 'warehouse' ? 'Склад' : terminals.find(t=>t.id===from.terminalId)?.comment || 'Стойка'})</h3>
                    <div className="inventory-list">
                       {INVENTORY_ITEMS.map(itemName => {
                         const item = from.inventory.find(i => i.item_name === itemName);
                         const stock = item ? item.current_stock : 0;
                         return (
                            <div className="inventory-list-item" key={`from-${itemName}`}>
                                <span className="item-name">{itemName}</span>
                                <div className="item-stock">
                                    <strong>{parseFloat(stock).toLocaleString('ru-RU')}</strong>
                                    <TransferArrow onClick={() => handleMoveClick(itemName, stock)} disabled={stock <= 0} />
                                </div>
                            </div>
                         )
                       })}
                    </div>
                </div>
            </div>

            {isStockUpModalOpen && <StockUpModal onClose={() => setIsStockUpModalOpen(false)} onSuccess={loadAndSetInitialData} />}
            {moveRequest && <InventoryTransferModal moveRequest={moveRequest} onClose={() => setMoveRequest(null)} onSuccess={loadAndSetInitialData} />}
        </>
    );
}