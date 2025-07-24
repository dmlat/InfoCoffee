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

// New hook for ingredient pill visibility logic
const useIngredientPillVisibility = (dataItems, isExpanded, idKey = 'id') => {
    const ingredientsContainerRefs = useRef({});
    const [visibleIngredientCounts, setVisibleIngredientCounts] = useState({});
    const [expandedPills, setExpandedPills] = useState({});

    const calculateVisibleCounts = useCallback((container, ingredients) => {
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
    }, []);

    useLayoutEffect(() => {
        if (!isExpanded || !dataItems || dataItems.length === 0) return;

        const observers = new Map();

        dataItems.forEach(item => {
            const container = ingredientsContainerRefs.current[item[idKey]];
            if (container) {
                const observer = new ResizeObserver(() => {
                    const count = calculateVisibleCounts(container, item.ingredients);
                    setVisibleIngredientCounts(prev => ({ ...prev, [item[idKey]]: count }));
                });
                observer.observe(container);
                observers.set(item[idKey], observer);
                // Initial calculation
                const initialCount = calculateVisibleCounts(container, item.ingredients);
                setVisibleIngredientCounts(prev => ({ ...prev, [item[idKey]]: initialCount }));
            }
        });

        return () => {
            observers.forEach(observer => observer.disconnect());
        };

    }, [isExpanded, dataItems, calculateVisibleCounts, idKey]);

    return { ingredientsContainerRefs, visibleIngredientCounts, expandedPills, setExpandedPills };
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
    const { ingredientsContainerRefs, visibleIngredientCounts, expandedPills, setExpandedPills } = useIngredientPillVisibility(tasks, isExpanded, 'id');

    const handleExecuteClick = (task) => {
        // All tasks are now 'restock'
        navigate('/dashboard/warehouse', { 
            state: { 
                taskContext: {
                    id: task.id,
                    terminalId: task.terminal_id,
                    terminalName: task.terminal_name,
                }
            } 
        });
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
                                const taskTypeText = 'Пополнение';
                                return (
                                    <tr key={task.id}>
                                        <td className="task-cell">
                                            <div className="task-terminal-name">{task.terminal_name}</div>
                                            <div className="task-type-name">{taskTypeText}</div>
                                            {task.comment && <div className="task-details"><i>{task.comment}</i></div>}
                                            {task.task_type === 'restock' && task.ingredients && (
                                                <div className="task-ingredients-pills" ref={el => ingredientsContainerRefs.current[task.id] = el}>
                                                    {(() => {
                                                        const sortedIngredients = task.ingredients
                                                            .sort((a, b) => (a.percentage ?? 101) - (b.percentage ?? 101));
                                                        
                                                        const visibleCount = visibleIngredientCounts[task.id] ?? sortedIngredients.length; // Use dynamically calculated count
                                                        const hiddenCount = sortedIngredients.length - visibleCount;

                                                        return (
                                                            <>
                                                                {((expandedPills[task.id] || false) ? sortedIngredients : sortedIngredients.slice(0, visibleCount)).map(ing => (
                                                                    <span key={ing.name} className={`ingredient-pill ${getIngredientPillClass(ing)}`}>
                                                                        {ing.name}: {ing.percentage?.toFixed(0) ?? '??'}%
                                                                    </span>
                                                                ))}
                                                                {hiddenCount > 0 && !expandedPills[task.id] && (
                                                                    <span className="ingredient-pill show-more-pills" onClick={() => setExpandedPills(prev => ({ ...prev, [task.id]: true }))}>
                                                                        ... Ещё {hiddenCount}
                                                                    </span>
                                                                )}
                                                                {expandedPills[task.id] && (
                                                                    <span className="ingredient-pill show-more-pills" onClick={() => setExpandedPills(prev => ({ ...prev, [task.id]: false }))}>
                                                                        Свернуть
                                                                    </span>
                                                                )}
                                                            </>
                                                        );
                                                    })()}
                                                </div>
                                            )}
                                        </td>
                                        <td className="status-cell-centered">
                                            {task.status === 'pending' && (
                                                <button 
                                                    className="action-button complete create-task-button-inline"
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
                                    const taskTypeText = 'Пополнение';
                                    
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
    const { ingredientsContainerRefs, visibleIngredientCounts, expandedPills, setExpandedPills } = useIngredientPillVisibility(restockInfo, isExpanded);

    const navigate = useNavigate();
    const handleConfigureClick = (terminalId) => {
        navigate(`/dashboard/stands/${terminalId}`, { state: { targetTab: 'settings' } });
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
                        - Нажмите "<span className="hint-blue">Поставить</span>", чтобы <span className="hint-white-bold">вручную</span> поставить задачу исполнителю.
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
                                                    {currentSettings?.sales_since_cleaning != null && (
                                                        <div className="sales-count-display">Продаж было: <span className="hint-blue">{currentSettings.sales_since_cleaning}</span></div>
                                                    )}
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
                restock: true, // Set to true by default now
            };
        } catch (error) {
            console.error("Failed to parse expandedBlocks from localStorage:", error);
            return {
                myTasks: true,
                log: true,
                restock: true, // Set to true by default now
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

    const handleAutoSaveSetting = async (terminalId) => {
        const setting = settings.find(s => s.id === terminalId);
        if (!setting) return;
        
        try {
            await apiClient.post('/tasks/settings', {
                terminal_id: setting.id,
                assignee_id_restock: setting.assignee_id_restock
            });
        } catch (error) {
            console.error('Failed to save settings:', error);
        }
    };

    const handleOpenModal = (terminalId) => { // type is removed, it's always 'restock'
        setCurrentModalData({ terminalId, type: 'restock' });
        setAssigneeModalOpen(true);
    };
    
    const handleOpenCommentModal = (terminalId) => { // taskType is removed
        setCurrentModalData({ terminalIds: [terminalId], taskType: 'restock' });
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
        const { terminalId } = currentModalData;
        const field = 'assignee_id_restock';
        
        setSettings(prev => prev.map(s => s.id === terminalId ? { ...s, [field]: selectedAssigneeId } : s));
        
        const settingToUpdate = { ...settings.find(s => s.id === terminalId), [field]: selectedAssigneeId };
        try {
            await apiClient.post('/tasks/settings', {
                terminal_id: terminalId,
                assignee_id_restock: settingToUpdate.assignee_id_restock,
            });
        } catch (error) {
            console.error("Failed to save assignee:", error);
        }
        handleCloseModal();
    };

    const handleCreateManualTask = async (comment) => {
        const { terminalIds } = currentModalData; // taskType removed
        
        // This logic is now handled by the backend. 
        // We just need to ensure at least one selected terminal has an assignee.
        const settingsForTerminals = settings.filter(s => terminalIds.includes(s.id));
        const tasksToCreate = settingsForTerminals
            .map(s => {
                const assigneeId = s.assignee_id_restock;
                if (!assigneeId) return null;
                return {
                    terminalId: s.id,
                    taskType: 'restock', // Always restock
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
                        settings.find(s => s.id === currentModalData.terminalId)?.assignee_id_restock
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
                    message={`Вы уверены, что хотите завершить задачу "Пополнение" для ${taskToComplete?.terminal_name}?`}
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

                    {/* CleaningSettingsBlock has been removed */}
                </>
            )}
        </div>
    );
}