// frontend/src/pages/StandsPage.js
import React, { useState, useEffect, useCallback } from 'react';
import apiClient from '../api';
// Вот корректный путь после перемещения файла модального окна
import StandDetailModal from '../components/StandDetail/StandDetailModal'; 
import './StandsPage.css';
import { ALL_ITEMS } from '../constants';

const ITEM_UNITS = ALL_ITEMS.reduce((acc, item) => {
    acc[item.name] = item.unit;
    return acc;
}, {});

const formatStock = (stockInfo, category) => {
    if (!stockInfo || !stockInfo[category]) return null;
    
    const { item_name, current_stock, critical_stock } = stockInfo[category];
    const unit = ITEM_UNITS[item_name] || '';
    const currentValue = parseFloat(current_stock);
    const criticalValue = parseFloat(critical_stock);
    
    let valueClassName = '';
    if (criticalValue > 0) {
        if (currentValue <= criticalValue) {
            valueClassName = 'stock-low';
        } else if (currentValue >= criticalValue * 2) {
            valueClassName = 'stock-high';
        }
    }
    
    const displayValue = Math.round(currentValue).toLocaleString('ru-RU');

    return (
        <React.Fragment>
            {item_name}: <span className={valueClassName}>{displayValue}</span>{unit}
        </React.Fragment>
    );
};

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
                <div className="stands-grid">
                    {terminals.length === 0 && !isLoading ? (
                        <div className="empty-data-message">Стойки не найдены.</div>
                    ) : (
                        terminals.map(terminal => {
                            const isOnline = (terminal.last_hour_online || 0) > 0;
                            const { stock_summary, needs_containers_config, needs_recipes_config } = terminal;
                            
                            const stockParts = [
                                formatStock(stock_summary, 'water'),
                                formatStock(stock_summary, 'grams'),
                                formatStock(stock_summary, 'pieces')
                            ].filter(Boolean);

                            const stockWarning = stockParts.map((part, index) => (
                                <React.Fragment key={index}>
                                    {part}
                                    {index < stockParts.length - 1 && ' | '}
                                </React.Fragment>
                            ));
                            
                            let configWarning = null;
                            if (needs_containers_config || needs_recipes_config) {
                                const messages = [];
                                if (needs_containers_config) messages.push('Контейнеры');
                                if (needs_recipes_config) messages.push('Рецепты');
                                configWarning = `Заполните: ${messages.join(' и ')}`;
                            }
                            
                            const isPending = needs_containers_config || needs_recipes_config;

                            return (
                                <div key={terminal.id} className="stand-card" onClick={() => setSelectedTerminal(terminal)}>
                                    <div className="stand-info">
                                        <div className="stand-info-main">
                                            <span className={`status-indicator ${isOnline ? 'online' : 'offline'}`}></span>
                                            <h3 className="stand-name">{terminal.comment || `Терминал #${terminal.id}`}</h3>
                                        </div>
                                        {configWarning && <p className="stand-config-warning pending-red">{configWarning}</p>}
                                        {stockParts.length > 0 && <p className="stand-stock-warning">{stockWarning}</p>}
                                    </div>
                                    <div className={`stand-details-arrow ${isPending ? 'pending-red' : 'pending-blue'}`}>
                                        &gt;
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
                    allTerminals={terminals}
                    onTerminalChange={handleTerminalChange}
                    onClose={handleCloseModal}
                />
            )}
        </>
    );
}