// frontend/src/pages/StandsPage.js
import React, { useState, useEffect, useCallback } from 'react';
import apiClient from '../api';
import './StandsPage.css';
import '../styles/common.css'; // Для общих стилей

// Функция форматирования времени убрана, так как больше не используется

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
                        const isOnline = (terminal.last_hour_online || 0) > 0;
                        return (
                            <div key={terminal.id} className="stand-card">
                                <div className="stand-card-header">
                                    <div className="stand-info">
                                        <span className={`status-indicator ${isOnline ? 'online' : 'offline'}`}></span>
                                        <h3 className="stand-name">{terminal.comment || `Терминал #${terminal.id}`}</h3>
                                    </div>
                                    <button className="details-btn" onClick={() => alert(`Открываем детали для ${terminal.comment}`)}>
                                        Подробнее
                                    </button>
                                </div>
                                {/* Блоки body и footer удалены для компактности */}
                            </div>
                        )
                    })
                )}
            </div>
        </div>
    );
}