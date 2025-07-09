// frontend/src/components/AssigneeModal.js
import React, { useState, useEffect } from 'react';
import './AssigneeModal.css';

export default function AssigneeModal({ users, selectedTelegramIds = [], onClose, onSave, title = "Выберите ответственных" }) {
    const [selectedIds, setSelectedIds] = useState(new Set(selectedTelegramIds));

    useEffect(() => {
        setSelectedIds(new Set(selectedTelegramIds));
    }, [selectedTelegramIds]);

    const handleToggle = (telegramId) => {
        setSelectedIds(prev => {
            const newSet = new Set(prev);
            if (newSet.has(telegramId)) {
                newSet.delete(telegramId);
            } else {
                newSet.add(telegramId);
            }
            return newSet;
        });
    };

    const handleSave = () => {
        onSave(Array.from(selectedIds));
        onClose();
    };

    return (
        <div className="confirm-modal-overlay" onClick={onClose}>
            <div className="confirm-modal-content assignee-modal-content" onClick={e => e.stopPropagation()}>
                <h3 className="confirm-modal-title">{title}</h3>
                <ul className="users-list">
                    {users.map(user => (
                        <li key={user.telegram_id} onClick={() => handleToggle(user.telegram_id)}>
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