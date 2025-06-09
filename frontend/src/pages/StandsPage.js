// frontend/src/pages/StandsPage.js
import React, { useState, useEffect, useCallback } from 'react';
import apiClient from '../api';
import StandDetailModal from '../components/StandDetailModal';
import './StandsPage.css';
import '../styles/common.css';

export default function StandsPage() {
    const [terminals, setTerminals] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState('');
    const [selectedTerminal, setSelectedTerminal] = useState(null);

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

    useEffect(() => {
        if (selectedTerminal) {
            document.body.style.overflow = 'hidden';
        } else {
            document.body.style.overflow = 'auto';
        }
        return () => { document.body.style.overflow = 'auto'; };
    }, [selectedTerminal]);

    if (isLoading) {
        return <div className="page-loading-container"><span>Загрузка стоек...</span></div>;
    }

    if (error) {
        return <div className="error-message">{error}</div>;
    }

    return (
        <>
            <div className="page-container stands-page">
                <div className="stands-page-header">
                    <p>Нажмите на Стойку, чтобы отредактировать:</p>
                    <ul>
                        <li><b>Рецепты:</b> расчёт расхода ингредиентов и названия напитков</li>
                        <li><b>Остатки:</b> максимальные и критические остатки в контейнерах</li>
                        <li><b>Частота обслуживания:</b> уведомления об обслуживании каждые N продаж</li>
                    </ul>
                </div>

                <div className="stands-list-container">
                    {terminals.length === 0 ? (
                        <div className="empty-data-message">Стойки не найдены.</div>
                    ) : (
                        terminals.map(terminal => {
                            const isOnline = (terminal.last_hour_online || 0) > 0;
                            return (
                                <div key={terminal.id} className="stand-card" onClick={() => setSelectedTerminal(terminal)}>
                                    <div className="stand-info">
                                        <span className={`status-indicator ${isOnline ? 'online' : 'offline'}`}></span>
                                        <h3 className="stand-name">{terminal.comment || `Терминал #${terminal.id}`}</h3>
                                    </div>
                                    <div className="stand-details-arrow">
                                        →
                                    </div>
                                </div>
                            )
                        })
                    )}
                </div>
            </div>

            {selectedTerminal && (
                <StandDetailModal
                    terminal={selectedTerminal}
                    onClose={() => setSelectedTerminal(null)}
                />
            )}
        </>
    );
}