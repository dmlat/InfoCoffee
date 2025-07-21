// frontend/src/pages/StandsPage.js
import React, { useState, useEffect, useCallback } from 'react';
import apiClient from '../api';
// Вот корректный путь после перемещения файла модального окна
import StandDetailModal from '../components/StandDetail/StandDetailModal'; 
import './StandsPage.css';
import { ALL_ITEMS } from '../constants';
import { useLocation } from 'react-router-dom'; // Импортируем useLocation

const ITEM_UNITS = ALL_ITEMS.reduce((acc, item) => {
    acc[item.name] = item.unit;
    return acc;
}, {});

const formatStock = (machineInventory) => {
    if (!machineInventory || machineInventory.length === 0) return [];

    const formattedItems = machineInventory.map(item => {
        const current = parseFloat(item.current_stock || 0);
        const max = parseFloat(item.max_stock || 0);
        const critical = parseFloat(item.critical_stock || 0);
        const unit = ITEM_UNITS[item.item_name] || 'г'; // Default to 'г' if unit not found

        if (max <= 0) return null; // Skip items without max capacity configured

        const percentage = (current / max) * 100;
        let valueClassName = '';
        if (critical > 0) {
            if (current <= critical) {
                valueClassName = 'critical'; // Was stock-low
            } else if (current <= critical * 2) {
                valueClassName = 'warning'; // Was stock-mid
            } else {
                valueClassName = 'normal'; // Was stock-high
            }
        } else {
            // If critical_stock is not defined or 0, we assume 'green' by default if not low or mid.
            // This is a design choice, adjust if needed based on UX requirements.
            valueClassName = 'normal'; // Was stock-high
        }

        return {
            name: item.item_name,
            percentage: percentage,
            value: `${Math.round(percentage)}%`,
            className: valueClassName,
            unit: unit
        };
    }).filter(Boolean);

    // Sort by percentage (ascending), Water first
    formattedItems.sort((a, b) => {
        if (a.name === 'Вода') return -1;
        if (b.name === 'Вода') return 1;
        return a.percentage - b.percentage;
    });

    const waterItem = formattedItems.find(item => item.name === 'Вода');
    let top7Items = formattedItems.filter(item => item.name !== 'Вода').slice(0, 7);

    if (waterItem) {
        top7Items = [waterItem, ...top7Items];
    }

    // Take up to 8 items (Water + top 7 least filled)
    return top7Items.slice(0, 8).map(item => ({
        label: item.name.length > 6 ? item.name.substring(0, 6) + '.' : item.name,
        value: item.value,
        className: item.className
    }));
};

export default function StandsPage({ user }) {
    const location = useLocation(); // Получаем location
    const [terminals, setTerminals] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState('');
    const [selectedTerminal, setSelectedTerminal] = useState(null);
    const [isMobileView, setIsMobileView] = useState(window.innerWidth < 425);

    useEffect(() => {
        const handleResize = () => {
            setIsMobileView(window.innerWidth < 425);
        };
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

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
        // Проверяем, что location.state существует и предназначен для этой страницы
        if (location.state && (location.state.terminalId || location.state.stand)) {
            const standToOpen = terminals.find(s => s.id === location.state.terminalId || s.id === location.state.stand?.id);
            if (standToOpen) {
                setSelectedTerminal(standToOpen);
            }
        }
    }, [location.state, terminals]);

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
                            const isOnline = terminal.is_online;
                            const { needs_containers_config, needs_recipes_config, machine_inventory } = terminal;
                            
                            const stockParts = formatStock(machine_inventory);

                            // const stockWarning = stockParts.map((part, index) => (
                            //     <React.Fragment key={index}>
                            //         {part.label}: <span className={part.className}>{part.value}</span>
                            //         {index < stockParts.length - 1 && ' | '}
                            //     </React.Fragment>
                            // ));

                            const firstRowItems = isMobileView
                                ? [stockParts.find(part => part.label === 'Вода'), ...stockParts.filter(part => part.label !== 'Вода').slice(0, 2)].filter(Boolean)
                                : stockParts.slice(0, 4);

                            const secondRowItems = isMobileView
                                ? [] // No second row for mobile view with 3 items
                                : stockParts.slice(4, 8);

                            const allItemsForMobile = isMobileView ? firstRowItems : []; // Combine all items for single row on mobile

                            const renderStockRow = (items) => (
                                <div className="stand-stock-pills-container">
                                    {items.map((part, index) => (
                                        <span key={index} className={`ingredient-pill ${part.className}`}>
                                            {part.label}: {part.value}
                                        </span>
                                    ))}
                                </div>
                            );

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
                                            <h3 className="stand-name">{terminal.name || `Терминал #${terminal.id}`}</h3>
                                        </div>
                                        {configWarning && <p className="stand-config-warning pending-red">{configWarning}</p>}
                                        {isMobileView ? (
                                            allItemsForMobile.length > 0 && renderStockRow(allItemsForMobile)
                                        ) : (
                                            <>
                                                {firstRowItems.length > 0 && renderStockRow(firstRowItems)}
                                                {secondRowItems.length > 0 && renderStockRow(secondRowItems)}
                                            </>
                                        )}
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