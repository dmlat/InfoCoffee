// frontend/src/components/TerminalListModal.js
import React from 'react';
import './TerminalListModal.css';
import { ALL_ITEMS } from '../constants';

const ITEM_UNITS = ALL_ITEMS.reduce((acc, item) => {
    acc[item.name] = item.unit;
    return acc;
}, {});

export default function TerminalListModal({ terminals, onSelect, onClose, currentSelection, disabledId = null, title = "Выберите стойку" }) {
    
    const onlineTerminals = terminals.filter(t => (t.last_hour_online || 0) > 0);
    const offlineTerminals = terminals.filter(t => (t.last_hour_online || 0) === 0);

    const isTerminalDisabled = (terminal) => {
        return terminal.id === disabledId;
    };

    const handleCardClick = (terminal) => {
        if (isTerminalDisabled(terminal)) return;
        onSelect(terminal);
        onClose();
    };

    const renderTerminal = (terminal) => {
        const isDisabled = isTerminalDisabled(terminal);
        const isOnline = (terminal.last_hour_online || 0) > 0;
        const { min_stock_info } = terminal;
        
        let stockWarning = null;
        if (min_stock_info) {
            const unit = ITEM_UNITS[min_stock_info.item_name] || 'шт';
            const isPiece = unit === 'шт';
            const stockValue = parseFloat(min_stock_info.current_stock);
            const displayValue = isPiece ? Math.round(stockValue) : stockValue.toLocaleString('ru-RU', { maximumFractionDigits: 1 });
            stockWarning = `Осталось ${min_stock_info.item_name}: ${displayValue} ${unit}`;
        }
        
        return (
            <div
                key={terminal.id}
                className={`terminal-card ${currentSelection === terminal.id ? 'selected' : ''} ${isDisabled ? 'disabled' : ''}`}
                onClick={() => handleCardClick(terminal)}
            >
                <div className="terminal-info">
                    <div className="terminal-info-main">
                        <span className={`status-indicator ${isOnline ? 'online' : 'offline'}`}></span>
                        <span className="terminal-name">{terminal.comment || `Терминал #${terminal.id}`}</span>
                    </div>
                    {stockWarning && <p className="terminal-stock-warning">{stockWarning}</p>}
                </div>

                {isDisabled 
                    ? <span className="disabled-label">(Источник)</span> 
                    : <span className="arrow-icon">&gt;</span>
                }
            </div>
        );
    }

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content terminal-list-modal" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2 className="modal-title">{title}</h2>
                    <button type="button" className="modal-close-btn" onClick={onClose}>&times;</button>
                </div>
                <div className="modal-body">
                    {terminals.length === 0 ? (
                        <p className="empty-data-message">Нет доступных стоек.</p>
                    ) : (
                        <>
                            {onlineTerminals.length > 0 && (
                                <div className="terminal-list-section">
                                    {onlineTerminals.map(renderTerminal)}
                                </div>
                            )}
                            {offlineTerminals.length > 0 && (
                                <div className="terminal-list-section">
                                    {onlineTerminals.length > 0 && <hr className="section-separator" />}
                                    {offlineTerminals.map(renderTerminal)}
                                </div>
                            )}
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}