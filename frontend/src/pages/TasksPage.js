// frontend/src/pages/TasksPage.js
import React, { useState, useEffect, useCallback } from 'react';
import apiClient from '../api';
import AssigneeModal from '../components/AssigneeModal';
import ConfirmModal from '../components/ConfirmModal';
import CreateTaskModal from '../components/CreateTaskModal'; // Create this component
import './TasksPage.css';
import '../styles/tables.css';

const getStatusInfo = (task, moscowTime) => {
    if (task.status === 'completed') {
        return { text: 'Выполнена', className: 'status-completed' };
    }
    const createdAt = new Date(task.created_at);
    // Простая проверка на "просроченность" - если задача создана не сегодня
    const isOverdue = createdAt.getDate() !== moscowTime.getDate() || createdAt.getMonth() !== moscowTime.getMonth() || createdAt.getFullYear() !== moscowTime.getFullYear();

    if (isOverdue) {
        return { text: 'Просрочена', className: 'status-overdue' };
    }
    return { text: 'В работе', className: 'status-pending' };
};

// --- Sub-components for each block ---

const TasksLogBlock = ({ tasks, users, isLoading, onTaskDelete, isExpanded, onToggle }) => {
    const moscowTime = new Date();

    return (
        <div className="tasks-list-container">
            <div className="container-header" onClick={onToggle}>
                <h2 className="container-title">
                    <span className={`toggle-arrow ${isExpanded ? 'open' : ''}`}></span>
                    Журнал задач
                </h2>
            </div>
            {isExpanded && (
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
                            ) : tasks.length === 0 ? (
                                <tr><td colSpan="4" className="page-loading-container">Активных задач нет.</td></tr>
                            ) : tasks.map(task => {
                                const statusInfo = getStatusInfo(task, moscowTime);
                                const taskTypeText = task.task_type === 'restock' ? 'Пополнение' : 'Уборка';
                                const detailsText = task.task_type === 'restock' ? task.details?.items : '';
                                
                                return (
                                    <tr key={task.id}>
                                        <td className="task-cell">
                                            <div className="task-terminal-name">{task.terminal_name}</div>
                                            <div className="task-type-name">{taskTypeText}</div>
                                            {detailsText && <div className="task-details">{detailsText}</div>}
                                        </td>
                                        <td>{task.assignees?.join(', ') || 'N/A'}</td>
                                        <td><span className={`task-status ${statusInfo.className}`}>{statusInfo.text}</span></td>
                                        <td className="td-action">
                                            <button onClick={(e) => {e.stopPropagation(); onTaskDelete(task.id);}} className="delete-btn" title="Удалить задачу">&times;</button>
                                        </td>
                                    </tr>
                                )
                            })}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
};

const RestockSettingsBlock = ({ restockInfo, settings, users, isLoading, onOpenModal, onSave, isExpanded, onToggle }) => {
    return (
        <div className="restock-settings-container">
            <div className="container-header" onClick={onToggle}>
                <h2 className="container-title">
                     <span className={`toggle-arrow ${isExpanded ? 'open' : ''}`}></span>
                    Пополнение стойки
                </h2>
                <button className="action-btn" onClick={(e) => {e.stopPropagation(); onSave();}} disabled={isLoading}>Сохранить</button>
            </div>
            {isExpanded && <>
                <p className="settings-hint">
                    Настройте <span className="hint-red">критические остатки</span> в <span className="hint-blue">Стойках</span>, чтобы вовремя получать задачи на пополнение.
                </p>
                <div className="data-table-container">
                    <table className="data-table restock-table">
                        <thead>
                            <tr>
                                <th>Стойка</th>
                                <th>Кто</th>
                            </tr>
                        </thead>
                        <tbody>
                            {isLoading ? (
                                <tr><td colSpan="2" className="page-loading-container">Загрузка...</td></tr>
                            ) : restockInfo.map(terminal => {
                                const currentSettings = settings.find(s => s.id === terminal.id);
                                const assignedUsers = users.filter(u => (currentSettings?.assignee_ids || []).includes(u.telegram_id));
                                const assigneesText = assignedUsers.map(u => u.is_self ? 'Вы' : (u.name || '').split(' ')[0]).join(', ');

                                let ingredientsToShow = [];
                                if (terminal.ingredients.length > 0) {
                                    const sorted = [...terminal.ingredients].sort((a,b) => (a.percentage ?? 101) - (b.percentage ?? 101));
                                    const water = terminal.ingredients.find(i => i.name === 'Вода');
                                    
                                    if (!water) {
                                        ingredientsToShow = sorted.slice(0, 2);
                                    } else {
                                        ingredientsToShow.push(water);
                                        const lowestNotWater = sorted.find(i => i.name !== 'Вода');
                                        if (lowestNotWater) {
                                            ingredientsToShow.push(lowestNotWater);
                                        }
                                    }
                                }

                                return (
                                    <React.Fragment key={terminal.id}>
                                        <tr className="terminal-name-row">
                                            <td>{terminal.name}</td>
                                            <td rowSpan="2" className="assignee-cell">
                                                <button className="assignee-button" onClick={(e) => {e.stopPropagation(); onOpenModal(terminal.id);}}>
                                                    <span className="assignee-icon"></span>
                                                    <span>{assigneesText || 'Выбрать'}</span>
                                                </button>
                                            </td>
                                        </tr>
                                        <tr className="ingredients-row">
                                            <td className="ingredients-cell">
                                                <div className="ingredients-cell-content">
                                                    {ingredientsToShow.length > 0 ? ingredientsToShow.map(ing => {
                                                        let pillClass = 'normal';
                                                        if (ing.critical) pillClass = 'critical';
                                                        else if (ing.percentage < 50) pillClass = 'warning';
                                                        return (
                                                            <span key={ing.name} className={`ingredient-pill ${pillClass}`}>
                                                                {ing.name}: {ing.percentage?.toFixed(0) ?? '??'}%
                                                            </span>
                                                        )
                                                    }) : <span style={{fontSize: '0.9em', color: '#a0b0c8'}}>Нет данных</span>}
                                                </div>
                                            </td>
                                        </tr>
                                    </React.Fragment>
                                )
                            })}
                        </tbody>
                    </table>
                </div>
            </>}
        </div>
    )
};

const CleaningSettingsBlock = ({ settings, users, isLoading, onSettingChange, onOpenModal, onSave, isExpanded, onToggle }) => {
    return (
        <div className="cleaning-settings-container">
            <div className="container-header" onClick={onToggle}>
                <h2 className="container-title">
                    <span className={`toggle-arrow ${isExpanded ? 'open' : ''}`}></span>
                    Частота уборки
                </h2>
                <button className="action-btn" onClick={(e) => { e.stopPropagation(); onSave();}} disabled={isLoading}>Сохранить</button>
            </div>
            {isExpanded && (
                <div className="data-table-container">
                    <table className="data-table cleaning-table">
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
                                const assigneesText = assignedUsers.map(u => u.is_self ? 'Вы' : (u.name || '').split(' ')[0]).join(', ');
                                
                                return (
                                <tr key={setting.id}>
                                    <td>{setting.name || `Терминал #${setting.id}`}</td>
                                    <td>
                                        <input 
                                            type="number" 
                                            value={setting.cleaning_frequency || ''}
                                            onClick={(e) => e.stopPropagation()}
                                            onChange={e => onSettingChange(setting.id, 'cleaning_frequency', e.target.value)}
                                        />
                                    </td>
                                    <td>
                                        <button className="assignee-button" onClick={(e) => { e.stopPropagation(); onOpenModal(setting.id);}}>
                                            <span className="assignee-icon"></span>
                                            <span>{assigneesText || 'Выбрать'}</span>
                                        </button>
                                    </td>
                                </tr>
                            )})}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
};


export default function TasksPage() {
    const [settings, setSettings] = useState([]);
    const [restockInfo, setRestockInfo] = useState([]);
    const [users, setUsers] = useState([]);
    const [tasks, setTasks] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState('');
    
    // Modals state
    const [isAssigneeModalOpen, setIsAssigneeModalOpen] = useState(false);
    const [isConfirmModalOpen, setIsConfirmModalOpen] = useState(false);
    const [isCreateModalOpen, setCreateModalOpen] = useState(false); // New modal state
    const [taskToDelete, setTaskToDelete] = useState(null);
    const [currentTargetTerminalId, setCurrentTargetTerminalId] = useState(null);

    // State for collapsible blocks
    const [expandedBlocks, setExpandedBlocks] = useState({
        log: true,
        restock: true,
        cleaning: true,
    });

    // State for tracking changes
    const [dirtySettings, setDirtySettings] = useState(new Set());
    const [isSaving, setIsSaving] = useState(false);

    const fetchData = useCallback(async () => {
        setIsLoading(true);
        setError('');
        try {
            const [settingsRes, usersRes, tasksRes, restockInfoRes] = await Promise.all([
                apiClient.get('/tasks/settings'),
                apiClient.get('/access/users/list'),
                apiClient.get('/tasks'),
                apiClient.get('/tasks/restock-info')
            ]);
            
            setSettings(settingsRes.data.success ? settingsRes.data.settings : []);
            setUsers(usersRes.data.success ? usersRes.data.users : []);
            setTasks(tasksRes.data.success ? tasksRes.data.tasks : []);
            setRestockInfo(restockInfoRes.data.success ? restockInfoRes.data.restockInfo : []);
            
            setDirtySettings(new Set());

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

    const toggleBlock = (blockName) => {
        setExpandedBlocks(prev => ({ ...prev, [blockName]: !prev[blockName] }));
    };

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
                assignee_ids: setting.assignee_ids || []
            };
            return apiClient.post('/tasks/settings', payload);
        });
    
        try {
            await Promise.all(savePromises);
            setDirtySettings(new Set());
            // Optionally show success notification
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

    const handleCreateTask = async (taskData) => {
        try {
            await apiClient.post('/tasks/create-manual', taskData);
            setCreateModalOpen(false);
            fetchData(); // Refresh tasks list
        } catch (err) {
            // Error is displayed inside the modal, but we can also set a page-level error
            setError(err.response?.data?.error || 'Ошибка создания задачи.');
        }
    };
    
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
            {isCreateModalOpen && (
                <CreateTaskModal
                    isOpen={isCreateModalOpen}
                    terminals={settings}
                    users={users}
                    onClose={() => setCreateModalOpen(false)}
                    onCreate={handleCreateTask}
                    // Pass a potential error message to the modal
                />
            )}
            <div className="tasks-page-layout">
                {error && <p className="error-message">{error}</p>}

                <div className="manual-task-container">
                    <button className="action-btn-filled" onClick={() => setCreateModalOpen(true)}>Поставить задачу</button>
                </div>
                
                <TasksLogBlock 
                    tasks={tasks}
                    users={users}
                    isLoading={isLoading}
                    onTaskDelete={openDeleteConfirm}
                    isExpanded={expandedBlocks.log}
                    onToggle={() => toggleBlock('log')}
                />
                
                <RestockSettingsBlock 
                    restockInfo={restockInfo}
                    settings={settings}
                    users={users}
                    isLoading={isSaving || isLoading}
                    onOpenModal={handleOpenModal}
                    onSave={handleSaveAllSettings}
                    isExpanded={expandedBlocks.restock}
                    onToggle={() => toggleBlock('restock')}
                />

                <CleaningSettingsBlock
                    settings={settings}
                    users={users}
                    isLoading={isSaving || isLoading}
                    onSettingChange={handleSettingChange}
                    onOpenModal={handleOpenModal}
                    onSave={handleSaveAllSettings}
                    isExpanded={expandedBlocks.cleaning}
                    onToggle={() => toggleBlock('cleaning')}
                />
            </div>
        </>
    );
}