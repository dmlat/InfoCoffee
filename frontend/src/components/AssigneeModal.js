// frontend/src/components/AssigneeModal.js
import React, { useState, useEffect } from 'react';
import './AssigneeModal.css';

const AssigneeModal = ({ isOpen, onClose, onSave, users, isMultiSelect = true, preSelectedAssignees = [] }) => {
    const [selectedIds, setSelectedIds] = useState(new Set());

    useEffect(() => {
        // This effect now correctly handles both single (number/string) and multi-select (array) pre-selection.
        // It runs only when the modal is opened or the initial set of assignees changes.
        if (isOpen) {
            const initialSelected = isMultiSelect
                ? new Set(Array.isArray(preSelectedAssignees) ? preSelectedAssignees : [])
                : new Set(preSelectedAssignees ? [preSelectedAssignees] : []);
            setSelectedIds(initialSelected);
        }
    }, [isOpen, preSelectedAssignees, isMultiSelect]);

    const handleToggleUser = (telegramId) => {
        setSelectedIds(prev => {
            const newSelected = new Set(prev);
            if (isMultiSelect) {
                if (newSelected.has(telegramId)) {
                    newSelected.delete(telegramId);
                } else {
                    newSelected.add(telegramId);
                }
            } else {
                // For single select, clicking toggles that one user.
                // If it's already selected, unselect it. Otherwise, select it.
                if (newSelected.has(telegramId)) {
                    newSelected.clear();
                } else {
                    newSelected.clear();
                    newSelected.add(telegramId);
                }
            }
            return newSelected;
        });
    };

    const handleSave = () => {
        if (isMultiSelect) {
            onSave(Array.from(selectedIds));
        } else {
            // For single select, save the single ID or null if none is selected.
            const singleId = selectedIds.size > 0 ? selectedIds.values().next().value : null;
            onSave(singleId);
        }
        onClose();
    };

    if (!isOpen) {
        return null;
    }

    return (
        <div className="confirm-modal-overlay" onClick={onClose}>
            <div className="confirm-modal-content assignee-modal-content" onClick={e => e.stopPropagation()}>
                <h3 className="confirm-modal-title">Выберите ответственных</h3>
                <ul className="users-list">
                    {users.map(user => (
                        <li key={user.telegram_id} onClick={() => handleToggleUser(user.telegram_id)}>
                            <input
                                type="checkbox"
                                checked={selectedIds.has(user.telegram_id)}
                                readOnly
                            />
                            <span>{user.name}</span>
                        </li>
                    ))}
                </ul>
                <div className="confirm-modal-buttons">
                    <button type="button" className="confirm-modal-btn cancel" onClick={onClose}>
                        Отмена
                    </button>
                    <button type="button" className="confirm-modal-btn confirm" onClick={handleSave}>
                        Сохранить
                    </button>
                </div>
            </div>
        </div>
    );
}

export default AssigneeModal; 