// frontend/src/pages/TasksPage.js
import React, { useState, useEffect, useCallback } from 'react';
import apiClient from '../api';
import AssigneeModal from '../components/AssigneeModal';
import ConfirmModal from '../components/ConfirmModal'; // <-- НОВЫЙ ИМПОРТ
import './TasksPage.css';
import '../styles/tables.css';

const getStatusInfo = (task, moscowTime) => {
    if (task.status === 'completed') {
        return { text: 'Выполнена', className: 'status-completed' };
    }
    const createdAt = new Date(task.created_at);
    const isOverdue = createdAt.getDate() < moscowTime.getDate() || createdAt.getMonth() < moscowTime.getMonth();

    if (isOverdue) {
        return { text: 'Просрочена', className: 'status-overdue' };
    }
    return { text: 'В работе', className: 'status-pending' };
};

export default function TasksPage() {
    const [settings, setSettings] = useState([]);
    const [users, setUsers] = useState([]);
    const [tasks, setTasks] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState('');
    
    // Состояния для модальных окон
    const [isAssigneeModalOpen, setIsAssigneeModalOpen] = useState(false);
    const [isConfirmModalOpen, setIsConfirmModalOpen] = useState(false);
    const [taskToDelete, setTaskToDelete] = useState(null);
    const [currentTargetTerminalId, setCurrentTargetTerminalId] = useState(null);

    // Состояния для отслеживания изменений и сохранения
    const [dirtySettings, setDirtySettings] = useState(new Set());
    const [isSaving, setIsSaving] = useState(false);
    const [isSettingsExpanded, setIsSettingsExpanded] = useState(true);

    const fetchData = useCallback(async () => {
        setIsLoading(true);
        setError('');
        try {
            const [settingsRes, usersRes, tasksRes] = await Promise.all([
                apiClient.get('/tasks/settings'),
                apiClient.get('/access/users/list'),
                apiClient.get('/tasks') // <-- ЗАГРУЖАЕМ ЗАДАЧИ
            ]);
            
            setSettings(settingsRes.data.success ? settingsRes.data.settings : []);
            setUsers(usersRes.data.success ? usersRes.data.users : []);
            setTasks(tasksRes.data.success ? tasksRes.data.tasks : []); // <-- УСТАНАВЛИВАЕМ ЗАДАЧИ
            setDirtySettings(new Set()); // Сбрасываем изменения при загрузке

        } catch (err) {
            setError(err.response?.data?.error || 'Ошибка загрузки данных.');
            console.error(err);
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    const handleSettingChange = (terminalId, field, value) => {
        setSettings(prev => prev.map(s => 
            s.id === terminalId ? { ...s, [field]: value } : s
        ));
        setDirtySettings(prev => new Set(prev).add(terminalId));
    };

    const handleOpenModal = (terminalId) => {
        setCurrentTargetTerminalId(terminalId);
        setIsAssigneeModalOpen(true);
    };

    const handleCloseModal = () => {
        setIsAssigneeModalOpen(false);
        setCurrentTargetTerminalId(null);
    };
    
    const handleSaveAssignees = (newAssigneeIds) => {
        if (currentTargetTerminalId) {
            handleSettingChange(currentTargetTerminalId, 'assignee_ids', newAssigneeIds);
        }
    };

    const handleSaveAllSettings = async () => {
        setIsSaving(true);
        setError('');
        
        const settingsToSave = settings.filter(s => dirtySettings.has(s.id));
        
        const savePromises = settingsToSave.map(setting => {
            const payload = {
                terminal_id: setting.id,
                cleaning_frequency: parseInt(setting.cleaning_frequency, 10) || null,
                restock_thresholds: setting.restock_thresholds || {},
                assignee_ids: setting.assignee_ids || []
            };
            return apiClient.post('/tasks/settings', payload);
        });
    
        try {
            await Promise.all(savePromises);
            setDirtySettings(new Set());
            setIsSettingsExpanded(false); // Collapse after saving
            // Успешное сохранение, можно показать уведомление
        } catch (err) {
            setError(err.response?.data?.error || 'Ошибка сохранения настроек.');
        } finally {
            setIsSaving(false);
        }
    };
    
    const openDeleteConfirm = (taskId) => {
        setTaskToDelete(taskId);
        setIsConfirmModalOpen(true);
    };

    const closeDeleteConfirm = () => {
        setTaskToDelete(null);
        setIsConfirmModalOpen(false);
    };

    const handleDeleteTask = async () => {
        if (!taskToDelete) return;
        try {
            await apiClient.delete(`/tasks/${taskToDelete}`);
            setTasks(prev => prev.filter(t => t.id !== taskToDelete));
        } catch (err) {
            setError(err.response?.data?.error || 'Ошибка удаления задачи.');
        } finally {
            closeDeleteConfirm();
        }
    };
    
    const moscowTime = new Date(); // Упрощенно, для определения просрочки
    
    // --- ВОТ ИСПРАВЛЕНИЕ ---
    const currentSelection = settings.find(s => s.id === currentTargetTerminalId);

    return (
        <>
            {isAssigneeModalOpen && (
                <AssigneeModal
                    users={users}
                    selectedTelegramIds={currentSelection?.assignee_ids || []}
                    onClose={handleCloseModal}
                    onSave={handleSaveAssignees}
                />
            )}
            {isConfirmModalOpen && (
                <ConfirmModal
                    isOpen={isConfirmModalOpen}
                    message="Вы уверены, что хотите удалить эту задачу?"
                    onConfirm={handleDeleteTask}
                    onCancel={closeDeleteConfirm}
                />
            )}
            <div className="tasks-page-layout">
                {error && <p className="error-message">{error}</p>}
                {/* Блок настроек */}
                <div className="task-settings-container">
                    <div className="container-header" onClick={() => setIsSettingsExpanded(p => !p)}>
                        <h2 className="container-title">
                             <span className={`toggle-arrow ${isSettingsExpanded ? 'open' : ''}`}></span>
                            Настройки обслуживания
                        </h2>
                        <button 
                            className="action-btn"
                            onClick={(e) => {
                                e.stopPropagation(); // Prevent container's onClick
                                handleSaveAllSettings();
                            }}
                            disabled={isSaving || dirtySettings.size === 0}
                        >
                            {isSaving ? '...' : 'Сохранить'}
                        </button>
                    </div>
                   {isSettingsExpanded && (
                    <>
                        <p className="settings-hint">
                            Настройте <span className="hint-red">критические остатки</span> в <span className="hint-blue">Стойках</span>, чтобы получать задачи на пополнение стойки. Все задачи приходят в боте.
                        </p>
                        <div className="data-table-container">
                            <table className="data-table settings-table">
                                <thead>
                                    <tr>
                                        <th>Стойка</th>
                                        <th>Уборка</th>
                                        <th>Кто</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {isLoading ? (
                                        <tr><td colSpan="3" className="page-loading-container">Загрузка...</td></tr>
                                    ) : settings.map(setting => {
                                        const assignedUsers = users.filter(u => (setting.assignee_ids || []).includes(u.telegram_id));
                                        const assigneesText = assignedUsers.map(u => u.name.split(' ')[0]).join(', ');
                                        
                                        return (
                                        <tr key={setting.id}>
                                            <td>{setting.name || `Терминал #${setting.id}`}</td>
                                            <td>
                                                <input 
                                                    type="number" 
                                                    value={setting.cleaning_frequency || ''}
                                                    onClick={(e) => e.stopPropagation()}
                                                    onChange={e => handleSettingChange(setting.id, 'cleaning_frequency', e.target.value)}
                                                />
                                            </td>
                                            <td>
                                                <button className="assignee-button" onClick={(e) => { e.stopPropagation(); handleOpenModal(setting.id); }}>
                                                    <span className="assignee-icon"></span>
                                                    <span>{assigneesText || 'Выбрать'}</span>
                                                </button>
                                            </td>
                                        </tr>
                                    )})}
                                </tbody>
                            </table>
                        </div>
                    </>
                   )}
                </div>

                {/* Блок с задачами */}
                <div className="tasks-list-container">
                     <div className="container-header">
                        <h2 className="container-title">Журнал задач</h2>
                    </div>
                    <div className="data-table-container">
                        <table className="data-table tasks-table">
                             <thead>
                                <tr>
                                    <th>Задача</th>
                                    <th>Исполнитель</th>
                                    <th>Статус</th>
                                    <th className="td-action"></th>
                                </tr>
                            </thead>
                            <tbody>
                               {isLoading ? (
                                    <tr><td colSpan="4" className="page-loading-container">Загрузка...</td></tr>
                                ) : tasks.map(task => {
                                    const statusInfo = getStatusInfo(task, moscowTime);
                                    const taskTypeText = task.task_type === 'restock' ? 'Пополнение' : 'Чистка';
                                    return (
                                    <tr key={task.id}>
                                        <td className="task-cell">
                                            <div className="task-terminal-name">{task.terminal_name}</div>
                                            <div className="task-type-name">{taskTypeText}</div>
                                        </td>
                                        <td>{task.assignees?.join(', ') || 'N/A'}</td>
                                        <td><span className={`task-status ${statusInfo.className}`}>{statusInfo.text}</span></td>
                                        <td className="td-action">
                                             <button onClick={() => openDeleteConfirm(task.id)} className="delete-btn" title="Удалить задачу">&times;</button>
                                        </td>
                                    </tr>
                                )})}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </>
    );
}