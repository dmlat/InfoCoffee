// frontend/src/components/TerminalListModal.js
import React from 'react';
import './TerminalListModal.css';
import { ALL_ITEMS } from '../constants';

const ITEM_UNITS = ALL_ITEMS.reduce((acc, item) => {
    acc[item.name] = item.unit;
    return acc;
}, {});

export default function TerminalListModal({ terminals, onSelect, onClose, currentSelection, disabledId = null, title = "Выберите стойку" }) {
    
    const onlineTerminals = terminals.filter(t => t.is_online);
    const offlineTerminals = terminals.filter(t => !t.is_online);

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
        const isOnline = terminal.is_online;
        
        return (
            <div
                key={terminal.id}
                className={`terminal-card ${currentSelection === terminal.id ? 'selected' : ''} ${isDisabled ? 'disabled' : ''}`}
                onClick={() => handleCardClick(terminal)}
            >
                <div className="terminal-info">
                    <div className="terminal-info-main">
                        <span className={`status-indicator ${isOnline ? 'online' : 'offline'}`}></span>
                        <span className="terminal-name">{terminal.name || `Терминал #${terminal.id}`}</span>
                    </div>
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