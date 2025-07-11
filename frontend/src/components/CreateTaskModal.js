import React, { useState, useEffect } from 'react';
import StandNavigator from './StandDetail/StandNavigator';
import './CreateTaskModal.css';
import '../styles/auth.css'; // For .form-group etc.

export default function CreateTaskModal({ isOpen, terminals, users, onClose, onCreate }) {
    const [selectedTerminalId, setSelectedTerminalId] = useState(null);
    const [taskType, setTaskType] = useState('cleaning');
    const [assigneeId, setAssigneeId] = useState('');
    const [comment, setComment] = useState('');
    const [error, setError] = useState('');

    useEffect(() => {
        // Select the first terminal by default if it exists
        if (terminals && terminals.length > 0) {
            setSelectedTerminalId(terminals[0].id);
        }
        // Reset assignee when users list changes
        setAssigneeId('');
    }, [terminals, users]);

    const handleCreate = () => {
        if (!selectedTerminalId) {
            setError('Выберите стойку.');
            return;
        }
        if (!assigneeId) {
            setError('Выберите исполнителя.');
            return;
        }
        onCreate({
            terminal_id: selectedTerminalId,
            task_type: taskType,
            assignee_ids: [parseInt(assigneeId, 10)], // API expects an array of IDs
            comment: comment
        });
    };

    if (!isOpen) {
        return null;
    }

    return (
        <div className="modal-overlay">
            <div className="create-task-modal-content">
                <div className="modal-header">
                    <h2>Новая задача</h2>
                    <button onClick={onClose} className="close-btn">&times;</button>
                </div>
                
                <div className="modal-body">
                    {error && <p className="error-message">{error}</p>}
                    
                    <div className="form-section">
                        <label>Стойка</label>
                        <StandNavigator
                            stands={terminals}
                            currentStandId={selectedTerminalId}
                            onSelectStand={setSelectedTerminalId}
                        />
                    </div>

                    <div className="form-section">
                        <label>Тип задачи</label>
                        <div className="task-type-selector">
                            <button 
                                className={`task-type-btn ${taskType === 'cleaning' ? 'active' : ''}`}
                                onClick={() => setTaskType('cleaning')}>
                                Уборка
                            </button>
                            <button 
                                className={`task-type-btn ${taskType === 'restock' ? 'active' : ''}`}
                                onClick={() => setTaskType('restock')}>
                                Пополнение
                            </button>
                        </div>
                    </div>

                    <div className="form-group">
                        <label htmlFor="assignee-select">Исполнитель</label>
                        <select 
                            id="assignee-select"
                            value={assigneeId} 
                            onChange={(e) => setAssigneeId(e.target.value)}
                        >
                            <option value="" disabled>-- Выберите исполнителя --</option>
                            {users.map(user => (
                                <option key={user.telegram_id} value={user.telegram_id}>
                                    {user.name}{user.is_self ? ' (Вы)' : ''}
                                </option>
                            ))}
                        </select>
                    </div>

                    <div className="form-group">
                        <label htmlFor="task-comment">Комментарий</label>
                        <textarea
                            id="task-comment"
                            rows="3"
                            value={comment}
                            onChange={(e) => setComment(e.target.value)}
                            placeholder="Например: 'Срочно протереть панель!'"
                        ></textarea>
                    </div>
                </div>

                <div className="modal-footer">
                    <button className="secondary-btn" onClick={onClose}>Отмена</button>
                    <button className="action-btn" onClick={handleCreate}>Создать</button>
                </div>
            </div>
        </div>
    );
} 