// frontend/src/pages/StandsPage.js
import React, { useState, useEffect } from 'react';
import apiClient from '../api';
import StandDetailModal from '../components/StandDetailModal';
import './StandsPage.css';

export default function StandsPage() {
    const [stands, setStands] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState('');
    const [selectedStand, setSelectedStand] = useState(null);

    useEffect(() => {
        const fetchStands = async () => {
            setIsLoading(true);
            try {
                const response = await apiClient.get('/terminals');
                if (response.data.success) {
                    setStands(response.data.terminals || []);
                } else {
                    setError(response.data.error || 'Не удалось загрузить данные');
                }
            } catch (err) {
                setError(err.response?.data?.error || 'Ошибка сети');
            } finally {
                setIsLoading(false);
            }
        };
        fetchStands();
    }, []);

    const handleStandClick = (stand) => {
        setSelectedStand(stand);
    };

    const handleCloseModal = () => {
        setSelectedStand(null);
    };

    if (isLoading) return <div className="page-loading-container"><span>Загрузка стоек...</span></div>;

    return (
        <div className="page-container stands-page">
            <h1 className="page-title">Стойки</h1>
            {error && <p className="error-message">{error}</p>}
            
            {/* ИЗМЕНЕННЫЙ ТЕКСТ */}
            <div className="page-description">
                <p>Нажмите на Стойку, чтобы:</p>
                <ul>
                    <li>Посмотреть <span className="text-highlight-blue">Остатки</span> в стойке и кофемашине</li>
                    <li>Отредактировать <span className="text-highlight-blue">Рецепты</span>: расчёт расхода ингредиентов и названия напитков</li>
                    <li>Отредактировать <span className="text-highlight-blue">Контейнеры</span>: максимальные и критические остатки в кофемашине</li>
                </ul>
            </div>

            <div className="stands-grid">
                {stands.map(stand => (
                    <div key={stand.id} className="stand-card" onClick={() => handleStandClick(stand)}>
                        <div className="stand-card-header">
                            <span className={`status-indicator ${stand.last_hour_online > 0 ? 'online' : 'offline'}`}></span>
                            <h3 className="stand-name">{stand.comment || `Терминал #${stand.id}`}</h3>
                        </div>
                        <div className="stand-details">
                            <div className="detail-item">
                                <span className="detail-label">Адрес</span>
                                <span className="detail-value">{stand.full_address || 'Не указан'}</span>
                            </div>
                        </div>
                    </div>
                ))}
            </div>

            {selectedStand && <StandDetailModal terminal={selectedStand} onClose={handleCloseModal} />}
        </div>
    );
}