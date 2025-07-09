// frontend/src/components/CopySettingsModal.js
import React, { useState } from 'react';
import './CopySettingsModal.css';
import './ModalFrame.css'; // Используем общую раму

export default function CopySettingsModal({ terminals, sourceTerminalId, onClose, onSave, title = "Копировать настройки в..." }) {
    const [selectedIds, setSelectedIds] = useState(new Set());

    const handleToggle = (terminalId) => {
        setSelectedIds(prev => {
            const newSet = new Set(prev);
            if (newSet.has(terminalId)) {
                newSet.delete(terminalId);
            } else {
                newSet.add(terminalId);
            }
            return newSet;
        });
    };
    
    const allSelectableTerminals = terminals.filter(t => t.id !== sourceTerminalId);

    const handleSelectAll = () => {
        const allSelectableIds = allSelectableTerminals.map(t => t.id);

        if (selectedIds.size === allSelectableIds.length) {
            setSelectedIds(new Set());
        } else {
            setSelectedIds(new Set(allSelectableIds));
        }
    };
    
    const handleSave = () => {
        onSave(Array.from(selectedIds));
        onClose();
    };

    const renderTerminal = (terminal) => {
        const isSelected = selectedIds.has(terminal.id);

        return (
            <div
                key={terminal.id}
                className={`terminal-card-copy ${isSelected ? 'selected' : ''}`}
                onClick={() => handleToggle(terminal.id)}
            >
                <div className="status-and-name">
                    <span className={`status-indicator ${ (terminal.last_hour_online || 0) > 0 ? 'online' : 'offline'}`}></span>
                    <span className="terminal-name">{terminal.comment || `Терминал #${terminal.id}`}</span>
                </div>
                <div className="selection-control">
                    <div className={`tick-box ${isSelected ? 'checked' : ''}`} />
                </div>
            </div>
        );
    }
    
    const isSaveDisabled = selectedIds.size === 0;

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content copy-settings-modal" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2 className="modal-title">{title}</h2>
                    <button type="button" className="modal-close-btn" onClick={onClose}>&times;</button>
                </div>
                <div className="modal-body">
                    <div className="terminal-list-container">
                        {allSelectableTerminals.length > 0 ? (
                           allSelectableTerminals.map(renderTerminal)
                        ) : (
                            <p className="empty-data-message">Нет других стоек для копирования.</p>
                        )}
                    </div>
                </div>
                <div className="modal-footer-copy">
                    <button 
                        className="action-btn secondary full-width"
                        onClick={handleSelectAll}
                        disabled={allSelectableTerminals.length === 0}
                    >
                        {selectedIds.size === allSelectableTerminals.length ? 'Снять выделение' : 'Выбрать все'}
                    </button>
                    <button 
                        className="action-btn full-width"
                        onClick={handleSave}
                        disabled={isSaveDisabled}
                    >
                        {isSaveDisabled ? 'Копировать' : `Копировать (${selectedIds.size})`}
                    </button>
                </div>
            </div>
        </div>
    );
}