// frontend/src/pages/StandsPage.js
import React, { useState, useEffect, useCallback, useRef, useLayoutEffect } from 'react';
import apiClient from '../api';
// Вот корректный путь после перемещения файла модального окна
import StandDetailModal from '../components/StandDetail/StandDetailModal'; 
import './StandsPage.css';
import { ALL_ITEMS } from '../constants';
import { useLocation, useParams, useNavigate } from 'react-router-dom'; // Импортируем useLocation

const ITEM_UNITS = ALL_ITEMS.reduce((acc, item) => {
    acc[item.name] = item.unit;
    return acc;
}, {});

// Self-contained hook for pill visibility logic, inspired by TasksPage
const usePillVisibility = (terminals) => {
    const refs = useRef({});
    const [visibleCounts, setVisibleCounts] = useState({});
    const [expanded, setExpanded] = useState({});

    const calculateVisibleCount = useCallback((container, items) => {
        if (!container || !items || items.length === 0) return items.length;

        const containerWidth = container.offsetWidth;
        const gap = 6;
        let currentWidth = 0;
        let count = 0;
        
        const tempPill = document.createElement('span');
        tempPill.style.visibility = 'hidden';
        tempPill.style.position = 'absolute';
        tempPill.className = 'ingredient-pill'; // Base class for sizing
        document.body.appendChild(tempPill);

        for (let i = 0; i < items.length; i++) {
            tempPill.innerText = `${items[i].label}: ${items[i].value}`;
            const pillWidth = tempPill.offsetWidth;
            
            if (currentWidth + pillWidth + (i > 0 ? gap : 0) <= containerWidth) {
                currentWidth += pillWidth + (i > 0 ? gap : 0);
                count++;
            } else {
                break;
            }
        }
        document.body.removeChild(tempPill);

        // Ensure at least one pill is visible if there are any
        return count > 0 ? count : (items.length > 0 ? 1 : 0);
    }, []);

    useLayoutEffect(() => {
        const observers = new Map();
        
        terminals.forEach(terminal => {
            const element = refs.current[terminal.id];
            if (element) {
                const observer = new ResizeObserver(() => {
                    const items = formatStock(terminal.machine_inventory);
                    setVisibleCounts(prev => ({ ...prev, [terminal.id]: calculateVisibleCount(element, items) }));
                });
                observer.observe(element);
                observers.set(terminal.id, observer);
                // Initial calculation
                const items = formatStock(terminal.machine_inventory);
                setVisibleCounts(prev => ({ ...prev, [terminal.id]: calculateVisibleCount(element, items) }));
            }
        });

        return () => observers.forEach(o => o.disconnect());
    }, [terminals, calculateVisibleCount]);

    const setRef = (element, id) => {
        if (element) {
            refs.current[id] = element;
        } else {
            delete refs.current[id];
        }
    };

    return { setRef, visibleCounts, expanded, setExpanded };
};


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
            unit: unit,
            label: item.item_name.length > 6 ? item.item_name.substring(0, 6) + '.' : item.item_name,
        };
    }).filter(Boolean);

    // Sort by percentage (ascending), Water first
    formattedItems.sort((a, b) => {
        if (a.name === 'Вода') return -1;
        if (b.name === 'Вода') return 1;
        return a.percentage - b.percentage;
    });
    
    return formattedItems;
};

export default function StandsPage({ user }) {
    const location = useLocation(); // Получаем location
    const { terminalId } = useParams(); // Get terminalId from URL params
    const navigate = useNavigate(); // Add navigate
    const [terminals, setTerminals] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState('');
    const [selectedTerminal, setSelectedTerminal] = useState(null);
    const { setRef, visibleCounts, expanded, setExpanded } = usePillVisibility(terminals);

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
        const observers = new Map();
        terminals.forEach(terminal => {
            const element = document.getElementById(`pills-container-${terminal.id}`);
            if (element) {
                const observer = new ResizeObserver(() => {
                    const items = formatStock(terminal.machine_inventory);
                    const count = visibleCounts[terminal.id] || items.length; // fallback
                    const newCount = calculateVisibleCount(element, items);
                    if (count !== newCount) {
                       setRef(element, terminal.id);
                    }
                });
                observer.observe(element);
                observers.set(terminal.id, observer);
            }
        });
        return () => observers.forEach(o => o.disconnect());
    }, [terminals, setRef, visibleCounts]);


    useEffect(() => {
        // Open modal based on URL parameter or location state
        const idFromParam = terminalId;
        const idFromState = location.state?.terminalId || location.state?.stand?.id;
        const finalTerminalId = idFromParam || idFromState;

        if (finalTerminalId && terminals.length > 0) {
            const standToOpen = terminals.find(s => s.id.toString() === finalTerminalId.toString());
            if (standToOpen) {
                setSelectedTerminal(standToOpen);
            }
        }
    }, [terminalId, location.state, terminals]);

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
        navigate('/dashboard/stands', { replace: true }); // Clear URL parameter
        fetchTerminals();
    };

    const handleTerminalChange = (newTerminal) => {
        setSelectedTerminal(newTerminal);
    };
    
     const calculateVisibleCount = useCallback((container, items) => {
        if (!container || !items || items.length === 0) return 0;
        
        const containerWidth = container.offsetWidth;
        const gap = 6;
        let currentWidth = 0;
        let count = 0;

        const tempPill = document.createElement('span');
        tempPill.style.visibility = 'hidden';
        tempPill.style.position = 'absolute';
        document.body.appendChild(tempPill);

        for (let i = 0; i < items.length; i++) {
            tempPill.className = `ingredient-pill ${items[i].className}`;
            tempPill.innerText = `${items[i].label}: ${items[i].value}`;
            const pillWidth = tempPill.offsetWidth;
            
            if (currentWidth + pillWidth + (i > 0 ? gap : 0) <= containerWidth) {
                currentWidth += pillWidth + (i > 0 ? gap : 0);
                count++;
            } else {
                break;
            }
        }
        document.body.removeChild(tempPill);
        return count;
    }, []);


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
                            const visibleCount = visibleCounts[terminal.id] ?? stockParts.length;
                            const hiddenCount = stockParts.length - visibleCount;
                            const isPillsExpanded = expanded[terminal.id] || false;

                            const renderStockRow = (items) => (
                                <div
                                    className="stand-stock-pills-container"
                                    ref={(el) => setRef(el, terminal.id)}
                                >
                                    {(isPillsExpanded ? items : items.slice(0, visibleCount)).map((part, index) => (
                                        <span key={index} className={`ingredient-pill ${part.className}`}>
                                            {part.label}: {part.value}
                                        </span>
                                    ))}
                                    {hiddenCount > 0 && !isPillsExpanded && (
                                        <span className="ingredient-pill show-more-pills" onClick={(e) => { e.stopPropagation(); setExpanded(prev => ({ ...prev, [terminal.id]: true })); }}>
                                            ... Ещё {hiddenCount}
                                        </span>
                                    )}
                                    {isPillsExpanded && (
                                        <span className="ingredient-pill show-more-pills" onClick={(e) => { e.stopPropagation(); setExpanded(prev => ({ ...prev, [terminal.id]: false })); }}>
                                            Свернуть
                                        </span>
                                    )}
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
                                        {stockParts.length > 0 && renderStockRow(stockParts)}
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
                    initialTab={location.state?.targetTab} // Pass the target tab to the modal
                />
            )}
        </>
    );
}