import React, { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import apiClient from '../api';
import WarehousePage from './WarehousePage'; // Reusing the whole page
import './ServiceTaskPage.css';

export default function ServiceTaskPage() {
    const [searchParams] = useSearchParams();
    const taskId = searchParams.get('taskId');

    const [task, setTask] = useState(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState('');
    const [isCompleting, setIsCompleting] = useState(false);

    const fetchTask = useCallback(async () => {
        if (!taskId) {
            setError("ID задачи не найден в URL.");
            setIsLoading(false);
            return;
        }
        setIsLoading(true);
        try {
            // We fetch all tasks assigned to the user and find the one with the matching ID.
            const res = await apiClient.get('/tasks/my');
            if (res.data.success) {
                const currentTask = res.data.tasks.find(t => String(t.id) === String(taskId));
                if (currentTask) {
                    setTask(currentTask);
                } else {
                    setError("Задача не найдена или не назначена на вас.");
                }
            } else {
                throw new Error(res.data.error || "Не удалось загрузить задачу.");
            }
        } catch (err) {
            setError(err.message || "Ошибка при загрузке задачи.");
        } finally {
            setIsLoading(false);
        }
    }, [taskId]);

    useEffect(() => {
        window.Telegram?.WebApp?.ready();
        fetchTask();
    }, [fetchTask]);
    
    const handleComplete = async () => {
        setIsCompleting(true);
        try {
            const res = await apiClient.post(`/tasks/${taskId}/complete`);
            if (res.data.success) {
                // Task completed, maybe close the window or show a success message.
                window.Telegram?.WebApp?.close();
            } else {
                throw new Error(res.data.error || "Не удалось завершить задачу.");
            }
        } catch (err) {
            setError(err.message);
        } finally {
            setIsCompleting(false);
        }
    };

    if (isLoading) {
        return <div className="service-page-container"><h2>Загрузка задачи...</h2></div>;
    }

    if (error) {
        return <div className="service-page-container error-message"><h2>Ошибка</h2><p>{error}</p></div>;
    }

    if (!task) {
        return <div className="service-page-container"><h2>Задача не найдена.</h2></div>;
    }

    if (task.task_type === 'restock') {
        // As per spec, render the entire WarehousePage for restock tasks.
        return <WarehousePage />;
    }
    
    if (task.task_type === 'cleaning') {
        return (
            <div className="service-page-container">
                <div className="task-card">
                    <div className="task-header">Задача: Уборка</div>
                    <div className="task-body">
                        <p><strong>Стойка:</strong> {task.terminal_name}</p>
                        <p><strong>Дата создания:</strong> {new Date(task.created_at).toLocaleString()}</p>
                    </div>
                    <div className="task-footer">
                        <button className="complete-btn" onClick={handleComplete} disabled={isCompleting}>
                            {isCompleting ? 'Завершение...' : 'Уборка выполнена'}
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    return <div className="service-page-container"><h2>Неизвестный тип задачи.</h2></div>;
} 