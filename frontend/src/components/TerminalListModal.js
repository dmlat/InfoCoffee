// frontend/src/components/TerminalListModal.js
import React from 'react';
import './TerminalListModal.css';

export default function TerminalListModal({ terminals, onSelect, onClose, currentSelection, excludeTerminalId = null }) {
    
    const onlineTerminals = terminals.filter(t => (t.last_hour_online || 0) > 0);
    const offlineTerminals = terminals.filter(t => (t.last_hour_online || 0) === 0);

    const handleCardClick = (terminal) => {
        if (terminal.id === excludeTerminalId) return; // Не даем выбрать неактивный
        onSelect(terminal);
        onClose();
    };

    const renderTerminal = (terminal) => {
        const isExcluded = terminal.id === excludeTerminalId;
        return (
            <div
                key={terminal.id}
                className={`terminal-card ${currentSelection === terminal.id ? 'selected' : ''} ${isExcluded ? 'disabled' : ''}`}
                onClick={() => handleCardClick(terminal)}
            >
                <span className={`status-indicator ${ (terminal.last_hour_online || 0) > 0 ? 'online' : 'offline'}`}></span>
                <span className="terminal-name">{terminal.comment || `Терминал #${terminal.id}`}</span>
                {isExcluded && <span className="disabled-label">(Источник)</span>}
            </div>
        );
    }

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content terminal-list-modal" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>Выберите стойку</h2>
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