// frontend/src/components/TerminalListModal.js
import React from 'react';
import './TerminalListModal.css';

export default function TerminalListModal({ terminals, onSelect, onClose, currentSelection, excludeTerminalId = null }) {
    
    // Фильтруем терминалы, исключая тот, что передан в excludeTerminalId
    const filteredTerminals = terminals.filter(t => t.id !== excludeTerminalId);

    const onlineTerminals = filteredTerminals.filter(t => (t.last_hour_online || 0) > 0);
    const offlineTerminals = filteredTerminals.filter(t => (t.last_hour_online || 0) === 0);

    const handleCardClick = (terminal) => {
        onSelect(terminal);
        onClose();
    };

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content terminal-list-modal" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>Выберите стойку</h2>
                    <button type="button" className="modal-close-btn" onClick={onClose}>&times;</button>
                </div>
                <div className="modal-body">
                    {filteredTerminals.length === 0 ? (
                        <p className="empty-data-message">Нет доступных стоек для выбора.</p>
                    ) : (
                        <>
                            {onlineTerminals.length > 0 && (
                                <div className="terminal-list-section">
                                    {onlineTerminals.map(terminal => (
                                        <div
                                            key={terminal.id}
                                            className={`terminal-card ${currentSelection === terminal.id ? 'selected' : ''}`}
                                            onClick={() => handleCardClick(terminal)}
                                        >
                                            <span className="status-indicator online"></span>
                                            <span className="terminal-name">{terminal.comment || `Терминал #${terminal.id}`}</span>
                                        </div>
                                    ))}
                                </div>
                            )}
                            {offlineTerminals.length > 0 && (
                                <div className="terminal-list-section">
                                    {onlineTerminals.length > 0 && <hr className="section-separator" />}
                                    {offlineTerminals.map(terminal => (
                                        <div
                                            key={terminal.id}
                                            className={`terminal-card ${currentSelection === terminal.id ? 'selected' : ''}`}
                                            onClick={() => handleCardClick(terminal)}
                                        >
                                            <span className="status-indicator offline"></span>
                                            <span className="terminal-name">{terminal.comment || `Терминал #${terminal.id}`}</span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}