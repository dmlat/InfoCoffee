// frontend/src/pages/StandsPage.js
import React, { useState, useEffect, useCallback } from 'react';
import apiClient from '../api';
import StandDetailModal from '../components/StandDetail/StandDetailModal'; // ИЗМЕНЕН ПУТЬ
import './StandsPage.css';

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

    const handleCloseModal = () => {
        setSelectedTerminal(null);
        fetchTerminals();
    };
    
    // Функция для смены терминала из модального окна
    const handleTerminalChange = (newTerminal) => {
        setSelectedTerminal(newTerminal);
    };

    if (isLoading) {
        return <div className="page-loading-container"><span>Загрузка стоек...</span></div>;
    }

    if (error) {
        return <div className="error-message">{error}</div>;
    }

    return (
        <>
            <div className="page-container stands-page">
                <div className="page-description">
                    <p>Нажмите на Стойку, чтобы:</p>
                    <ul>
                        <li>Посмотреть <span className="text-highlight-blue">Остатки</span> в стойке и кофемашине</li>
                        <li>Отредактировать <span className="text-highlight-blue">Рецепты</span>: расчёт расхода ингредиентов и названия напитков</li>
                        <li>Отредактировать <span className="text-highlight-blue">Контейнеры</span>: максимальные и критические остатки в кофемашине</li>
                    </ul>
                </div>

                <div className="stands-grid">
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
                    allTerminals={terminals} // Передаем весь список
                    onTerminalChange={handleTerminalChange} // Передаем функцию смены
                    onClose={handleCloseModal}
                />
            )}
        </>
    );
}