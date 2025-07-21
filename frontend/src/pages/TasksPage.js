// frontend/src/pages/TasksPage.js
import React, { useState, useEffect, useCallback, useRef, useLayoutEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import apiClient from '../api';
import { useAuth } from '../App';
import AssigneeModal from '../components/AssigneeModal';
import ConfirmModal from '../components/ConfirmModal';
import CommentTaskModal from '../components/CommentTaskModal';
import './TasksPage.css';
import '../styles/tables.css';
// import { getUser } from '../utils/user'; // УДАЛЯЕМ


const getIngredientPillClass = (ingredient) => {
    if (ingredient.critical) return 'critical';
    if (ingredient.percentage != null && ingredient.percentage < 40) return 'warning';
    return 'normal';
};


const TaskStatusIcon = ({ task }) => {
    const moscowTime = new Date();
    if (task.status === 'completed') {
        return <div className="status-icon status-icon-completed" title="Выполнена">&#10003;</div>;
    }
    const createdAt = new Date(task.created_at);
    const isOverdue = createdAt.getDate() !== moscowTime.getDate() || createdAt.getMonth() !== moscowTime.getMonth() || createdAt.getFullYear() !== moscowTime.getFullYear();

    if (isOverdue) {
        return <div className="status-icon status-icon-overdue" title="Просрочена">!</div>;
    }
    return <div className="status-icon status-icon-pending" title="В работе">...</div>;
};

const YourTasksBlock = ({ tasks, isLoading, onTaskAction, isExpanded, onToggle }) => {
    const navigate = useNavigate();

    const handleExecuteClick = (task) => {
        if (task.task_type === 'restock') {
            navigate('/dashboard/warehouse', { 
                state: { 
                    taskContext: {
                        id: task.id,
                        terminalId: task.terminal_id,
                        terminalName: task.terminal_name,
                    }
                } 
            });
        } else {
            onTaskAction(task);
        }
    };
    
    return (
        <div className="tasks-list-container">
            <div className="container-header" onClick={onToggle}>
                <h2 className="container-title">
                    <span className={`toggle-arrow ${isExpanded ? 'open' : ''}`}></span>
                    Ваши задачи
                </h2>
            </div>
            {isExpanded && (
                <div className="data-table-container">
                    <table className="data-table tasks-table">
                        <thead>
                            <tr>
                                <th>Задача</th>
                                <th>Действие</th>
                            </tr>
                        </thead>
                        <tbody>
                            {isLoading ? (
                                <tr><td colSpan="2" className="tasks-table-empty-row">Загрузка...</td></tr>
                            ) : tasks.length === 0 ? (
                                <tr><td colSpan="2" className="tasks-table-empty-row">У вас нет активных задач.</td></tr>
                            ) : tasks.map(task => {
                                const taskTypeText = task.task_type === 'restock' ? 'Пополнение' : 'Уборка';
                                return (
                                    <tr key={task.id}>
                                        <td className="task-cell">
                                            <div className="task-terminal-name">{task.terminal_name}</div>
                                            <div className="task-type-name">{taskTypeText}</div>
                                            {task.comment && <div className="task-details"><i>{task.comment}</i></div>}
                                            {task.task_type === 'restock' && task.ingredients && (
                                                <div className="task-ingredients-pills">
                                                    {(() => {
                                                        // Упрощенная логика: показываем 1-2 ингредиента с самыми низкими процентами
                                                        // независимо от критичности
                                                        const sortedIngredients = task.ingredients
                                                            .sort((a, b) => (a.percentage ?? 101) - (b.percentage ?? 101))
                                                            .slice(0, 2); // Берем только первые 2 с самыми низкими процентами
                                                        
                                                        return sortedIngredients.map(ing => (
                                                            <span key={ing.name} className={`ingredient-pill ${getIngredientPillClass(ing)}`}>
                                                                {ing.name}: {ing.percentage?.toFixed(0) ?? '??'}%
                                                            </span>
                                                        ));
                                                    })()}
                                                </div>
                                            )}
                                        </td>
                                        <td className="status-cell-centered">
                                            {task.status === 'pending' && (
                                                <button 
                                                    className="action-button complete"
                                                    onClick={() => handleExecuteClick(task)}
                                                >
                                                Выполнить
                                            </button>
                                            )}
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

const TasksLogBlock = ({ tasks, isLoading, onTaskDelete, onTaskAction, isExpanded, onToggle }) => {
    // const moscowTime = new Date(); // НЕ ИСПОЛЬЗУЕТСЯ
    
    return (
        <div className="tasks-list-container">
            <div className="container-header" onClick={onToggle}>
                <h2 className="container-title">
                    <span className={`toggle-arrow ${isExpanded ? 'open' : ''}`}></span>
                    Журнал задач
                </h2>
            </div>
            {isExpanded && (
                <>
                    <div className="status-hint">
                        <span><div className="status-icon status-icon-completed">&#10003;</div> Выполнена</span>
                        <span><div className="status-icon status-icon-pending">...</div> В работе</span>
                        <span><div className="status-icon status-icon-overdue">!</div> Просрочена</span>
                    </div>
                    <div className="data-table-container">
                        <table className="data-table tasks-table tasks-log-table">
                            <thead>
                                <tr>
                                    <th>Задача</th>
                                    <th>Статус</th>
                                    <th style={{width: '42px', textAlign: 'center'}}></th>
                                </tr>
                            </thead>
                            <tbody>
                                {isLoading ? (
                                    <tr><td colSpan="3" className="tasks-table-empty-row">Загрузка...</td></tr>
                                ) : tasks.length === 0 ? (
                                    <tr><td colSpan="3" className="tasks-table-empty-row">Активных задач нет.</td></tr>
                                ) : tasks.map(task => {
                                    const taskTypeText = task.task_type === 'restock' ? 'Пополнение' : 'Уборка';
                                    
                                    return (
                                        <tr key={task.id}>
                                            <td className="task-cell">
                                                <div className="task-terminal-name">{task.terminal_name}</div>
                                                <div className="task-type-name">{taskTypeText}</div>
                                                {task.comment && <div className="task-details"><i>{task.comment}</i></div>}
                                                <span className="task-assignee-text-small">{task.assignee_name || 'N/A'}</span>
                                            </td>
                                            <td style={{textAlign: 'center'}}>
                                                <TaskStatusIcon task={task} />
                                            </td>
                                            <td className="td-action" style={{textAlign: 'center'}}>
                                                <button onClick={(e) => {e.stopPropagation(); onTaskDelete(task.id);}} className="delete-btn" title="Удалить задачу">&times;</button>
                                            </td>
                                        </tr>
                                    )
                                })}
                            </tbody>
                        </table>
                    </div>
                </>
            )}
        </div>
    );
};

const RestockSettingsBlock = ({ restockInfo, settings, users, isLoading, onOpenModal, onOpenCommentModal, isExpanded, onToggle }) => {
    const ingredientsContainerRefs = useRef({});
    const [visibleIngredientCounts, setVisibleIngredientCounts] = useState({});
    const [expandedPills, setExpandedPills] = useState({});

    useLayoutEffect(() => {
        if (!isExpanded) return;

        const calculateVisibleCounts = (container, ingredients) => {
            const tempContainer = document.createElement('div');
            tempContainer.style.position = 'absolute';
            tempContainer.style.visibility = 'hidden';
            tempContainer.style.height = 'auto';
            tempContainer.style.width = 'auto';
            tempContainer.style.display = 'flex';
            tempContainer.style.gap = '6px';
            document.body.appendChild(tempContainer);

            const containerWidth = container.offsetWidth;
            const sortedIngredients = [...ingredients].sort((a, b) => (a.percentage ?? 101) - (b.percentage ?? 101));
            
            if (window.innerWidth < 375) {
                document.body.removeChild(tempContainer);
                return 1;
            }

            const pillWidths = sortedIngredients.map(ing => {
                const tempPill = document.createElement('span');
                tempPill.className = 'ingredient-pill';
                tempPill.innerText = `${ing.name}: ${ing.percentage?.toFixed(0) ?? '??'}%`;
                tempContainer.appendChild(tempPill);
                const width = tempPill.offsetWidth;
                tempContainer.removeChild(tempPill);
                return width;
            });
            
            const gap = 6;
            let currentWidth = 0;
            let visibleCount = 0;

            for (const width of pillWidths) {
                const requiredWidth = visibleCount === 0 ? width : width + gap;
                if (currentWidth + requiredWidth <= containerWidth) {
                    currentWidth += requiredWidth;
                    visibleCount++;
                } else {
                    break;
                }
            }
            
            document.body.removeChild(tempContainer);
            return visibleCount;
        };
        
        const observers = new Map();

        restockInfo.forEach(terminal => {
            const container = ingredientsContainerRefs.current[terminal.id];
            if (container) {
                const observer = new ResizeObserver(() => {
                    const count = calculateVisibleCounts(container, terminal.ingredients);
                    setVisibleIngredientCounts(prev => ({ ...prev, [terminal.id]: count }));
                });
                observer.observe(container);
                observers.set(terminal.id, observer);
                // Initial calculation
                const initialCount = calculateVisibleCounts(container, terminal.ingredients);
                setVisibleIngredientCounts(prev => ({ ...prev, [terminal.id]: initialCount }));
            }
        });

        return () => {
            observers.forEach(observer => observer.disconnect());
        };

    }, [isExpanded, restockInfo]);


    const navigate = useNavigate();
    const handleConfigureClick = (terminalId) => {
        navigate(`/stands/${terminalId}#settings`);
    };

    return (
        <div className="restock-settings-container">
            <div className="container-header" onClick={onToggle}>
                <h2 className="container-title">
                     <span className={`toggle-arrow ${isExpanded ? 'open' : ''}`}></span>
                    Пополнение стойки
                </h2>
            </div>
            {isExpanded && (
                <>
                    <p className="settings-hint">
                        - Настройте <span className="hint-red">критические остатки</span> и <span className="hint-yellow">Рецепты</span> в <span className="hint-blue">Стойках</span>, чтобы получать задачи на пополнение.<br/>
                        - Нажмите "<span className="hint-blue">Поставить</span>" (голубой цвет текста), чтобы <span className="hint-white-bold">вручную</span> поставить задачу исполнителю.
                    </p>
                    <div className="data-table-container">
                        <table className="data-table restock-table">
                            <thead>
                                <tr>
                                    <th>Стойка</th>
                                    <th>Действие</th>
                                </tr>
                            </thead>
                            <tbody>
                                {isLoading ? (
                                    <tr><td colSpan="2" className="tasks-table-empty-row">Загрузка...</td></tr>
                                ) : restockInfo.map((terminal, index) => {
                                    const currentSettings = settings.find(s => s.id === terminal.id);
                                    const assignedUser = users.find(u => u.telegram_id === currentSettings?.assignee_id_restock);
                                    const assigneesText = assignedUser ? (assignedUser.is_self ? 'Вы' : (assignedUser.name || '').split(' ')[0]) : 'Назначить';
                                    
                                    const sortedIngredients = [...terminal.ingredients].sort((a, b) => {
                                        const percA = a.percentage ?? 101;
                                        const percB = b.percentage ?? 101;
                                        return percA - percB;
                                    });
                                    
                                    const visibleCount = visibleIngredientCounts[terminal.id] ?? sortedIngredients.length;
                                    const hiddenCount = sortedIngredients.length - visibleCount;
                                    
                                    return (
                                        <React.Fragment key={terminal.id}>
                                            <tr className="restock-terminal-row">
                                                <td>
                                                    <div className="restock-terminal-name">{terminal.name}</div>
                                                    {currentSettings?.needs_containers_config && (
                                                        <div className="configure-notice" onClick={() => handleConfigureClick(terminal.id)}>
                                                            <span className="hint-red">Заполните контейнеры</span>
                                                            <span className="arrow-icon">&gt;</span>
                                                        </div>
                                                    )}
                                                </td>
                                                <td className="action-cell">
                                                    <button className="assignee-button" onClick={(e) => { e.stopPropagation(); onOpenModal(terminal.id, 'restock'); }}>
                                                        <span className="assignee-icon"></span>
                                                        <span>{assigneesText}</span>
                                                    </button>
                                                </td>
                                            </tr>
                                            <tr className={`restock-ingredients-row ${index === restockInfo.length - 1 ? 'last-terminal' : ''}`}>
                                                <td>
                                                    <div className="ingredients-container" ref={el => ingredientsContainerRefs.current[terminal.id] = el}>
                                                        {((expandedPills[terminal.id] || false) ? sortedIngredients : sortedIngredients.slice(0, visibleCount)).map(ing => (
                                                            <span key={ing.name} className={`ingredient-pill ${getIngredientPillClass(ing)}`}>
                                                                {ing.name}: {ing.percentage?.toFixed(0) ?? '??'}%
                                                            </span>
                                                        ))}
                                                        {hiddenCount > 0 && !expandedPills[terminal.id] && (
                                                            <span className="ingredient-pill show-more-pills" onClick={() => setExpandedPills(prev => ({ ...prev, [terminal.id]: true }))}>
                                                                ... Ещё {hiddenCount}
                                                            </span>
                                                        )}
                                                        {expandedPills[terminal.id] && (
                                                            <span className="ingredient-pill show-more-pills" onClick={() => setExpandedPills(prev => ({ ...prev, [terminal.id]: false }))}>
                                                                Свернуть
                                                            </span>
                                                        )}
                                                    </div>
                                                </td>
                                                <td className="action-cell">
                                                    <button 
                                                        className="create-task-button-inline"
                                                        onClick={(e) => { e.stopPropagation(); onOpenCommentModal(terminal.id, 'restock');}}
                                                        disabled={!currentSettings?.assignee_id_restock || currentSettings?.needs_containers_config}
                                                        title={
                                                            currentSettings?.needs_containers_config 
                                                                ? "Заполните контейнеры в настройках стойки" 
                                                                : !currentSettings?.assignee_id_restock 
                                                                    ? "Сначала назначьте исполнителя" 
                                                                    : "Создать задачу на пополнение"
                                                        }
                                                    >
                                                        Поставить
                                                    </button>
                                                </td>
                                            </tr>
                                        </React.Fragment>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </>
            )}
        </div>
    );
};

const CleaningSettingsBlock = ({ settings, users, isLoading, onSettingChange, onOpenModal, onOpenCommentModal, isExpanded, onToggle, onAutoSave }) => {
    const navigate = useNavigate();
    const handleConfigureClick = (terminalId) => {
        navigate(`/stands/${terminalId}#settings`);
    };

    return (
        <div className="cleaning-settings-container">
            <div className="container-header" onClick={onToggle}>
                <h2 className="container-title">
                     <span className={`toggle-arrow ${isExpanded ? 'open' : ''}`}></span>
                    Уборка стойки
                </h2>
            </div>
            {isExpanded && (
                <>
                    <p className="settings-hint">
                        - Настройте <span className="hint-red">частоту уборки</span> (убирать каждые X продаж) и <span className="hint-yellow">назначьте ответственного</span>.<br/>
                        - Нажмите "<span className="hint-blue">Поставить</span>", чтобы <span className="hint-white-bold">вручную</span> поставить задачу исполнителю.
                    </p>
                    <div className="data-table-container">
                        <table className="data-table cleaning-table">
                            <thead>
                                <tr>
                                    <th>Стойка</th>
                                    <th>Действие</th>
                                </tr>
                            </thead>
                            <tbody>
                                {isLoading ? (
                                    <tr><td colSpan="2" className="tasks-table-empty-row">Загрузка...</td></tr>
                                ) : settings.map((setting, index) => {
                                    const assignedUser = users.find(u => u.telegram_id === setting.assignee_id_cleaning);
                                    const assigneesText = assignedUser ? (assignedUser.is_self ? 'Вы' : (assignedUser.name || '').split(' ')[0]) : 'Назначить';
                                    
                                    return (
                                        <React.Fragment key={setting.id}>
                                            <tr className="cleaning-terminal-row">
                                                <td>
                                                    <span className="cleaning-terminal-name">{setting.name || `Терминал #${setting.id}`}</span>
                                                    {setting.needs_containers_config && (
                                                        <div className="configure-notice" onClick={() => handleConfigureClick(setting.id)}>
                                                            <span className="hint-red">Заполните контейнеры</span>
                                                            <span className="arrow-icon">&gt;</span>
                                                        </div>
                                                    )}
                                                </td>
                                                <td className="action-cell">
                                                    <button className="assignee-button" onClick={(e) => {e.stopPropagation(); onOpenModal(setting.id, 'cleaning');}}>
                                                        <span className="assignee-icon"></span>
                                                        <span>{assigneesText}</span>
                                                    </button>
                                                </td>
                                            </tr>
                                            <tr className={`cleaning-frequency-row ${index === settings.length - 1 ? 'last-terminal' : ''}`}>
                                                <td>
                                                    <div className="cleaning-frequency-controls">
                                                        <input 
                                                            type="number" 
                                                            className={`cleaning-frequency-input ${setting.cleaning_frequency == null ? 'glowing-placeholder' : ''}`}
                                                            value={setting.cleaning_frequency ?? ''}
                                                            onClick={(e) => e.stopPropagation()}
                                                            onChange={e => onSettingChange(setting.id, 'cleaning_frequency', e.target.value)}
                                                            onBlur={() => onAutoSave(setting.id)}
                                                            placeholder="100"
                                                        />
                                                        {setting.sales_since_cleaning != null && (
                                                            <div className="sales-count-display">Продаж было: <span className="hint-blue">{setting.sales_since_cleaning}</span></div>
                                                        )}
                                                    </div>
                                                </td>
                                                <td className="action-cell">
                                                    <button 
                                                        className="create-task-button-inline"
                                                        onClick={(e) => {e.stopPropagation(); onOpenCommentModal(setting.id, 'cleaning');}}
                                                        disabled={!setting.assignee_id_cleaning || setting.needs_containers_config}
                                                        title={
                                                            setting.needs_containers_config 
                                                                ? "Заполните контейнеры в настройках стойки" 
                                                                : !setting.assignee_id_cleaning 
                                                                    ? "Назначьте исполнителя" 
                                                                    : "Создать задачу на уборку"
                                                        }
                                                    >
                                                        Поставить
                                                    </button>
                                                </td>
                                            </tr>
                                        </React.Fragment>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </>
            )}
        </div>
    );
};

export default function TasksPage() {
    const { user } = useAuth();
    // const navigate = useNavigate();  // Unused in this component

    const [myTasks, setMyTasks] = useState([]);
    const [allTasks, setAllTasks] = useState([]);
    const [settings, setSettings] = useState([]);
    const [restockInfo, setRestockInfo] = useState([]);
    const [users, setUsers] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    
    const [isAssigneeModalOpen, setAssigneeModalOpen] = useState(false);
    const [isCommentModalOpen, setCommentModalOpen] = useState(false);
    const [isConfirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
    const [isConfirmCompleteOpen, setConfirmCompleteOpen] = useState(false);
    
    const [currentModalData, setCurrentModalData] = useState({ terminalId: null, type: null, taskType: 'restock' });
    const [taskToDelete, setTaskToDelete] = useState(null);
    const [taskToComplete, setTaskToComplete] = useState(null);

    const [expandedBlocks, setExpandedBlocks] = useState(() => {
        try {
            const saved = localStorage.getItem('expandedBlocks');
            return saved ? JSON.parse(saved) : {
                myTasks: true,
                log: true,
                restock: false,
                cleaning: false,
            };
        } catch (error) {
            console.error("Failed to parse expandedBlocks from localStorage:", error);
            return {
                myTasks: true,
                log: true,
                restock: false,
                cleaning: false,
            };
        }
    });

    useEffect(() => {
        localStorage.setItem('expandedBlocks', JSON.stringify(expandedBlocks));
    }, [expandedBlocks]);

    const fetchData = useCallback(async () => {
        setIsLoading(true);
        try {
            const [myTasksRes, allTasksRes, settingsRes, usersRes, restockInfoRes] = await Promise.all([
                apiClient.get('/tasks/my'),
                apiClient.get('/tasks'),
                apiClient.get('/tasks/settings'),
                apiClient.get('/access/users/list'),
                apiClient.get('/tasks/restock-info'),
            ]);

            setMyTasks(myTasksRes.data.tasks);
            setAllTasks(allTasksRes.data.tasks);
            
            const fetchedSettings = settingsRes.data.settings.map(s => ({ ...s, isChecked: false }));
            setSettings(fetchedSettings);
            
            setUsers(usersRes.data.users);
            setRestockInfo(restockInfoRes.data.restockInfo);

        } catch (error) {
            console.error("Failed to fetch data:", error);
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
        setSettings(prevSettings => 
            prevSettings.map(s => s.id === terminalId ? { ...s, [field]: value } : s)
        );
    };

    const handleAutoSaveSetting = async (terminalId) => {
        const setting = settings.find(s => s.id === terminalId);
        if (!setting) return;
        
        try {
            await apiClient.post('/tasks/settings', {
                terminal_id: setting.id,
                cleaning_frequency: setting.cleaning_frequency,
                assignee_id_cleaning: setting.assignee_id_cleaning,
                assignee_id_restock: setting.assignee_id_restock
            });
        } catch (error) {
            console.error('Failed to save settings:', error);
        }
    };

    const handleOpenModal = (terminalId, type) => {
        setCurrentModalData({ terminalId, type });
        setAssigneeModalOpen(true);
    };
    
    const handleOpenCommentModal = (terminalId, taskType) => {
        setCurrentModalData({ terminalIds: [terminalId], taskType });
        setCommentModalOpen(true);
    };

    const handleCloseModal = () => {
        setAssigneeModalOpen(false);
        setCommentModalOpen(false);
        setConfirmDeleteOpen(false);
        setConfirmCompleteOpen(false);
        setCurrentModalData({ terminalId: null, terminalIds: [], type: null, taskType: 'restock' });
        setTaskToDelete(null);
        setTaskToComplete(null);
    };

    const handleSaveAssignees = async (selectedAssigneeId) => {
        const { terminalId, type } = currentModalData;
        const field = type === 'cleaning' ? 'assignee_id_cleaning' : 'assignee_id_restock';
        
        setSettings(prev => prev.map(s => s.id === terminalId ? { ...s, [field]: selectedAssigneeId } : s));
        
        const settingToUpdate = { ...settings.find(s => s.id === terminalId), [field]: selectedAssigneeId };
        try {
            await apiClient.post('/tasks/settings', {
                terminal_id: terminalId,
                cleaning_frequency: settingToUpdate.cleaning_frequency,
                assignee_id_cleaning: settingToUpdate.assignee_id_cleaning,
                assignee_id_restock: settingToUpdate.assignee_id_restock,
            });
        } catch (error) {
            console.error("Failed to save assignee:", error);
        }
        handleCloseModal();
    };

    const handleCreateManualTask = async (comment) => {
        const { terminalIds, taskType } = currentModalData;
        
        // This logic is now handled by the backend. 
        // We just need to ensure at least one selected terminal has an assignee.
        const settingsForTerminals = settings.filter(s => terminalIds.includes(s.id));
        const tasksToCreate = settingsForTerminals
            .map(s => {
                const assigneeId = taskType === 'cleaning' ? s.assignee_id_cleaning : s.assignee_id_restock;
                if (!assigneeId) return null;
                return {
                    terminalId: s.id,
                    taskType: taskType,
                    assigneeId: assigneeId,
                    comment: comment
                };
            })
            .filter(Boolean); // Remove nulls

        if (tasksToCreate.length === 0) {
            alert('Не назначен ни один исполнитель для выбранных стоек или не выбрана ни одна стойка. Задача не будет создана.');
            handleCloseModal();
            return;
        }

        try {
            await apiClient.post('/tasks/create-manual', {
                tasks: tasksToCreate
            });
            fetchData();
        } catch (error) {
            console.error('Failed to create manual task:', error);
            alert(`Ошибка при создании задачи: ${error.response?.data?.error || error.message}`);
        }
        handleCloseModal();
    };

    const openDeleteConfirm = (taskId) => {
        setTaskToDelete(taskId);
        setConfirmDeleteOpen(true);
    };

    const closeDeleteConfirm = () => {
        setTaskToDelete(null);
        setConfirmDeleteOpen(false);
    };
    
    const handleDeleteTask = async () => {
        if (!taskToDelete) return;
        try {
            await apiClient.delete(`/tasks/${taskToDelete}`);
            fetchData();
        } catch (error) {
            console.error('Failed to delete task:', error);
            alert('Ошибка при удалении задачи.');
        }
        closeDeleteConfirm();
    };

    const executeTask = (task) => {
        setTaskToComplete(task);
        setConfirmCompleteOpen(true);
    };

    const handleCompleteTask = async (taskId, updatedStock) => {
        try {
            await apiClient.post(`/tasks/${taskId}/complete`, { updatedStock });
            fetchData();
        } catch (error) {
            console.error('Failed to complete task:', error);
            alert(`Ошибка при завершении задачи: ${error.response?.data?.error || error.message}`);
        }
        handleCloseModal();
    };

    const cleaningSettingsWithTerminals = settings.map(s => ({
        ...s,
        ...restockInfo.find(t => t.id === s.id)
    })).filter(s => s.name);
    
    // const selectedRestockTerminals = settings.filter(s => s.isChecked).map(s => s.id); // НЕ ИСПОЛЬЗUЕТСЯ
    // const selectedCleaningTerminals = settings.filter(s => s.isChecked).map(s => s.id); // НЕ ИСПОЛЬЗUЕТСЯ

    return (
        <div className="tasks-page">
            {isAssigneeModalOpen && (
                <AssigneeModal
                    users={users}
                    isOpen={isAssigneeModalOpen}
                    onClose={handleCloseModal}
                    onSave={handleSaveAssignees}
                    isMultiSelect={false}
                    preSelectedAssignees={
                        settings.find(s => s.id === currentModalData.terminalId)?.[currentModalData.type === 'cleaning' ? 'assignee_id_cleaning' : 'assignee_id_restock']
                    }
                />
            )}

            {isCommentModalOpen && (
                <CommentTaskModal
                    isOpen={isCommentModalOpen}
                    onClose={handleCloseModal}
                    onSave={handleCreateManualTask}
                />
            )}

            {isConfirmDeleteOpen && (
                <ConfirmModal
                    isOpen={isConfirmDeleteOpen}
                    onCancel={handleCloseModal}
                    onConfirm={handleDeleteTask}
                    title="Подтверждение удаления"
                    message="Вы уверены, что хотите удалить эту задачу?"
                />
            )}
            
            {isConfirmCompleteOpen && (
                 <ConfirmModal
                    isOpen={isConfirmCompleteOpen}
                    onCancel={handleCloseModal}
                    onConfirm={() => handleCompleteTask(taskToComplete.id)}
                    title="Подтверждение выполнения"
                    message={`Вы уверены, что хотите завершить задачу "${taskToComplete?.task_type === 'cleaning' ? 'Уборка' : 'Пополнение'}" для ${taskToComplete?.terminal_name}?`}
                />
            )}

            <YourTasksBlock 
                tasks={myTasks} 
                isLoading={isLoading} 
                onTaskAction={executeTask}
                isExpanded={expandedBlocks.myTasks}
                onToggle={() => toggleBlock('myTasks')}
            />

            {(user.role === 'owner' || user.role === 'admin') && (
                <>
                    <TasksLogBlock 
                        tasks={allTasks} 
                        users={users} 
                        isLoading={isLoading} 
                        onTaskDelete={openDeleteConfirm}
                        isExpanded={expandedBlocks.log}
                        onToggle={() => toggleBlock('log')}
                    />

                    <RestockSettingsBlock 
                         settings={settings}
                         restockInfo={restockInfo}
                         users={users}
                         isLoading={isLoading}
                         onOpenModal={handleOpenModal}
                         onOpenCommentModal={handleOpenCommentModal}
                         isExpanded={expandedBlocks.restock}
                         onToggle={() => toggleBlock('restock')}
                    />

                    <CleaningSettingsBlock
                         settings={cleaningSettingsWithTerminals}
                         users={users}
                         isLoading={isLoading}
                         onOpenModal={handleOpenModal}
                         onOpenCommentModal={handleOpenCommentModal}
                         onSettingChange={handleSettingChange}
                         onAutoSave={handleAutoSaveSetting}
                         isExpanded={expandedBlocks.cleaning}
                         onToggle={() => toggleBlock('cleaning')}
                    />
                </>
            )}
        </div>
    );
}