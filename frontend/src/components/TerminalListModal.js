// frontend/src/components/TerminalListModal.js
import React from 'react';
import './TerminalListModal.css';

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
        return (
            <div
                key={terminal.id}
                className={`terminal-card ${currentSelection === terminal.id ? 'selected' : ''} ${isDisabled ? 'disabled' : ''}`}
                onClick={() => handleCardClick(terminal)}
            >
                <span className={`status-indicator ${ (terminal.last_hour_online || 0) > 0 ? 'online' : 'offline'}`}></span>
                <span className="terminal-name">{terminal.comment || `Терминал #${terminal.id}`}</span>
                {isDisabled && <span className="disabled-label">(Источник)</span>}
            </div>
        );
    }

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content terminal-list-modal" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>{title}</h2>
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