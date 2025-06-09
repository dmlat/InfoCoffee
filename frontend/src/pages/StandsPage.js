// frontend/src/pages/StandsPage.js
import React, { useState, useEffect, useCallback } from 'react';
import apiClient from '../api';
import './StandsPage.css';
import '../styles/common.css'; // Для общих стилей

const formatTime = (isoString) => {
    if (!isoString) return 'никогда';
    const date = new Date(isoString);
    const now = new Date();
    const diffSeconds = Math.round((now - date) / 1000);

    if (diffSeconds < 60) return `${diffSeconds} сек. назад`;
    if (diffSeconds < 3600) return `${Math.floor(diffSeconds / 60)} мин. назад`;
    
    // Форматирование даты
    return date.toLocaleString('ru-RU', {
        day: '2-digit',
        month: '2-digit',
        year: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    });
};


export default function StandsPage() {
    const [terminals, setTerminals] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState('');

    const fetchTerminals = useCallback(async () => {
        setIsLoading(true);
        setError('');
        try {
            const response = await apiClient.get('/terminals');
            if (response.data.success) {
                setTerminals(response.data.terminals || []);
            } else {
                setError(response.data.error || 'Не удалось загрузить список стоек.');
            }
        } catch (err) {
            setError(err.response?.data?.error || 'Ошибка сети при загрузке стоек.');
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchTerminals();
    }, [fetchTerminals]);

    if (isLoading) {
        return <div className="page-loading-container"><span>Загрузка стоек...</span></div>;
    }
    
    if (error) {
        return <div className="error-message">{error}</div>;
    }

    return (
        <div className="page-container stands-page">
            <div className="stands-list-container">
                {terminals.length === 0 ? (
                    <div className="empty-data-message">Стойки не найдены.</div>
                ) : (
                    terminals.map(terminal => {
                        // Статус онлайн определяется по наличию ненулевого времени онлайн за последний час
                        const isOnline = (terminal.last_hour_online || 0) > 0;
                        return (
                            <div key={terminal.id} className="stand-card">
                                <div className="stand-card-header">
                                    <span className={`status-indicator ${isOnline ? 'online' : 'offline'}`}></span>
                                    <h3 className="stand-name">{terminal.comment || `Терминал #${terminal.id}`}</h3>
                                </div>
                                <div className="stand-card-body">
                                    <p>S/N: {terminal.serial_number || 'не указан'}</p>
                                    <p>Последний выход на связь: {formatTime(terminal.last_online_time)}</p>
                                </div>
                                <div className="stand-card-footer">
                                    <button className="action-btn" onClick={() => alert(`Открываем детали для ${terminal.comment}`)}>
                                        Подробнее
                                    </button>
                                </div>
                            </div>
                        )
                    })
                )}
            </div>
        </div>
    );
}