// frontend/src/pages/WarehousePage.js
import React, { useState, useEffect, useCallback } from 'react';
import apiClient from '../api';
import './WarehousePage.css';
import StockUpModal from '../components/StockUpModal';
import InventoryTransferModal from '../components/InventoryTransferModal';

const INVENTORY_ITEMS = ['Кофе', 'Сливки', 'Какао', 'Раф', 'Вода', 'Стаканы', 'Крышки', 'Размешиватели', 'Сахар'];

const TransferArrow = ({ onClick, disabled }) => (
    <button onClick={onClick} className="transfer-arrow-btn" disabled={disabled}>→</button>
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

    // --- ИЗМЕНЕНИЕ: Упрощенная функция загрузки инвентаря ---
    const fetchInventory = useCallback(async (location) => {
        if (!location) return [];
        if (location.type === 'warehouse') {
            const res = await apiClient.get('/warehouse');
            return res.data.warehouseStock || [];
        }
        if (location.terminalId && (location.type === 'stand' || location.type === 'machine')) {
             const res = await apiClient.get(`/terminals/vendista/${location.terminalId}/details`);
             return (res.data.details?.inventory || []).filter(item => item.location === location.type);
        }
        return [];
    }, []);

    // --- ИЗМЕНЕНИЕ: Основная функция загрузки и обновления данных ---
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

    // --- ИЗМЕНЕНИЕ: Только один useEffect для первоначальной загрузки ---
    useEffect(() => {
        loadAndSetInitialData();
    }, [loadAndSetInitialData]);

    const handleLocationTypeChange = async (panelSetter, panelState, newType, setIndex) => {
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

    const handleTerminalChange = async (panelSetter, setIndex, currentIndex, direction) => {
        if (!terminals || terminals.length < 2) return;
        const newIndex = (currentIndex + direction + terminals.length) % terminals.length;
        setIndex(newIndex);
        const newTerminalId = terminals[newIndex].id;
        const newState = {...(panelSetter === setFrom ? from : to), terminalId: newTerminalId};
        const inventory = await fetchInventory(newState);
        panelSetter({...newState, inventory});
    };
    
    const handleSuccessAction = () => {
        // Просто перезагружаем все данные после успешного действия
        loadAndSetInitialData();
    };

    const renderPanel = (panelState, panelSetter, index, setIndex, title) => {
        const isStandSelectorActive = panelState.type === 'stand' || panelState.type === 'machine';
        const currentTerminal = terminals.find(t => t.id === panelState.terminalId);
        
        const isFromPanel = title === 'ОТКУДА';
        const otherPanel = isFromPanel ? to : from;
        
        return (
            <div className="warehouse-panel">
                <h3>{title}</h3>
                <div className="location-selector">
                    <button className={panelState.type === 'warehouse' ? 'active' : ''} onClick={() => handleLocationTypeChange(panelSetter, panelState, 'warehouse', setIndex)} disabled={!isFromPanel && otherPanel.type === 'warehouse'}>Склад</button>
                    <button className={panelState.type === 'stand' ? 'active' : ''} onClick={() => handleLocationTypeChange(panelSetter, panelState, 'stand', setIndex)}>Стойка</button>
                    <button className={panelState.type === 'machine' ? 'active' : ''} onClick={() => handleLocationTypeChange(panelSetter, panelState, 'machine', setIndex)}>Кофемашина</button>
                </div>
                 <div className={`terminal-selector ${isStandSelectorActive ? 'active' : ''}`}>
                    <button onClick={() => handleTerminalChange(panelSetter, setIndex, index, -1)} disabled={!isStandSelectorActive || terminals.length < 2}>&lt;</button>
                    <span>{isStandSelectorActive ? (currentTerminal?.comment || 'Нет стоек') : '---'}</span>
                    <button onClick={() => handleTerminalChange(panelSetter, setIndex, index, 1)} disabled={!isStandSelectorActive || terminals.length < 2}>&gt;</button>
                </div>
                <div className="inventory-list">
                    {INVENTORY_ITEMS.map(itemName => {
                         const item = panelState.inventory && panelState.inventory.find(i => i.item_name === itemName);
                         const stock = item ? item.current_stock : 0;
                         const isSelfSelection = panelState.type !== 'warehouse' && panelState.type === otherPanel.type && panelState.terminalId === otherPanel.terminalId;
                         return (
                            <div className="inventory-list-item" key={itemName}>
                                <span>{itemName}</span>
                                <strong>{parseFloat(stock).toLocaleString('ru-RU')}</strong>
                                 {isFromPanel && <TransferArrow onClick={() => setMoveRequest({ item_name: itemName, currentStock: stock, from: { ...from, terminalName: terminals.find(t=>t.id === from.terminalId)?.comment }, to: { ...to, terminalName: terminals.find(t=>t.id === to.terminalId)?.comment } })} disabled={isSelfSelection || stock <= 0} />}
                            </div>
                         )
                    })}
                </div>
            </div>
        )
    }

    if (isLoading) return <div className="page-loading-container">Загрузка...</div>;
    if (error) return <div className="error-message">{error}</div>;

    return (
        <>
            <div className="page-container warehouse-page">
                <div className="warehouse-header">
                    <button className="action-btn" onClick={() => setIsStockUpModalOpen(true)}>Приходовать товар</button>
                    <p>Добавить новый товар на центральный склад</p>
                </div>
                <div className="warehouse-body">
                    {renderPanel(from, setFrom, fromIndex, setFromIndex, 'ОТКУДА')}
                    {renderPanel(to, setTo, toIndex, setToIndex, 'КУДА')}
                </div>
            </div>

            {isStockUpModalOpen && <StockUpModal onClose={() => setIsStockUpModalOpen(false)} onSuccess={handleSuccessAction} />}
            {moveRequest && <InventoryTransferModal moveRequest={moveRequest} onClose={() => setMoveRequest(null)} onSuccess={handleSuccessAction} />}
        </>
    );
}