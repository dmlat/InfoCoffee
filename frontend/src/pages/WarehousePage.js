// frontend/src/pages/WarehousePage.js
import React, { useState, useEffect, useCallback } from 'react';
import apiClient from '../api';
import './WarehousePage.css';

const INVENTORY_ITEMS = ['Кофе', 'Сливки', 'Какао', 'Раф', 'Вода', 'Стаканы', 'Крышки', 'Размешиватели', 'Сахар'];

const TransferArrow = ({ onClick, disabled }) => (
    <button onClick={onClick} className="transfer-arrow-btn" disabled={disabled}>→</button>
);

export default function WarehousePage() {
    const [terminals, setTerminals] = useState([]);
    const [from, setFrom] = useState({ type: 'warehouse', terminalId: null, inventory: [] });
    const [to, setTo] = useState({ type: 'stand', terminalId: null, inventory: [] });
    
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState('');

    const fetchTerminals = useCallback(async () => {
        try {
            const response = await apiClient.get('/terminals');
            if (response.data.success) {
                const fetchedTerminals = response.data.terminals || [];
                setTerminals(fetchedTerminals);
                if (fetchedTerminals.length > 0) {
                    setTo(prev => ({ ...prev, type: 'stand', terminalId: fetchedTerminals[0].id }));
                }
            } else {
                setError('Не удалось загрузить список стоек.');
            }
        } catch (err) {
            setError('Ошибка сети при загрузке стоек.');
        }
    }, []);
    
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

    useEffect(() => {
        const loadInitialData = async () => {
            setIsLoading(true);
            await fetchTerminals();
            setIsLoading(false);
        };
        loadInitialData();
    }, [fetchTerminals]);
    
    // --- ИСПРАВЛЕНИЕ: Добавлены `from` и `to` в массив зависимостей, как просит линтер ---
    useEffect(() => {
        const updateInventories = async () => {
             if (isLoading) return;
             try {
                const [fromInventory, toInventory] = await Promise.all([
                    fetchInventory(from),
                    fetchInventory(to)
                ]);
                setFrom(prev => ({...prev, inventory: fromInventory}));
                setTo(prev => ({...prev, inventory: toInventory}));
             } catch(e) {
                setError("Ошибка загрузки остатков");
             }
        }
        updateInventories();
    }, [from, to, isLoading, fetchInventory]); // <-- Вот окончательное исправление

    const handleLocationTypeChange = (panelSetter, panelState, newType) => {
        let newTerminalId = panelState.terminalId;
        if ((newType === 'stand' || newType === 'machine')) {
            newTerminalId = panelState.terminalId && terminals.some(t => t.id === panelState.terminalId)
                ? panelState.terminalId
                : terminals[0]?.id || null;
        } else if (newType === 'warehouse') {
            newTerminalId = null;
        }
        panelSetter({ ...panelState, type: newType, terminalId: newTerminalId });
    };

    const renderPanel = (panelState, panelSetter, title) => {
        const isStandSelectorActive = panelState.type === 'stand' || panelState.type === 'machine';
        const currentTerminal = terminals.find(t => t.id === panelState.terminalId);
        
        const isFromPanel = title === 'ОТКУДА';
        const otherPanel = isFromPanel ? to : from;
        const isSelfSelection = panelState.type === otherPanel.type && panelState.terminalId === otherPanel.terminalId;

        return (
            <div className="warehouse-panel">
                <h3>{title}</h3>
                <div className="location-selector">
                    <button className={panelState.type === 'warehouse' ? 'active' : ''} 
                            onClick={() => handleLocationTypeChange(panelSetter, panelState, 'warehouse')}
                            disabled={!isFromPanel && otherPanel.type === 'warehouse'}>Склад</button>
                    <button className={panelState.type === 'stand' ? 'active' : ''} 
                            onClick={() => handleLocationTypeChange(panelSetter, panelState, 'stand')}>Стойка</button>
                    <button className={panelState.type === 'machine' ? 'active' : ''} 
                            onClick={() => handleLocationTypeChange(panelSetter, panelState, 'machine')}>Кофемашина</button>
                </div>
                 <div className={`terminal-selector ${isStandSelectorActive ? 'active' : ''}`}>
                    <button disabled={!isStandSelectorActive}>&lt;</button>
                    <span>{isStandSelectorActive ? (currentTerminal?.comment || 'Выберите стойку') : '---'}</span>
                    <button disabled={!isStandSelectorActive}>&gt;</button>
                </div>
                <div className="inventory-list">
                    {INVENTORY_ITEMS.map(itemName => {
                         const item = panelState.inventory && panelState.inventory.find(i => i.item_name === itemName);
                         const stock = item ? item.current_stock : 0;
                         return (
                            <div className="inventory-list-item" key={itemName}>
                                <span>{itemName}</span>
                                <strong>{parseFloat(stock).toLocaleString('ru-RU')}</strong>
                                 {isFromPanel && <TransferArrow onClick={() => alert(`Перемещаем ${itemName}`)} 
                                                                 disabled={isSelfSelection || stock <= 0} />}
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
        <div className="page-container warehouse-page">
            <div className="warehouse-header">
                <button className="action-btn">Приходовать товар</button>
                <p>Добавить новый товар на центральный склад</p>
            </div>
            <div className="warehouse-body">
                {renderPanel(from, setFrom, 'ОТКУДА')}
                {renderPanel(to, setTo, 'КУДА')}
            </div>
        </div>
    );
}