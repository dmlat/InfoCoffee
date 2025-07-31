// frontend/src/pages/StandsPage.js
import React, { useState, useEffect, useCallback, useRef, useLayoutEffect } from 'react';
import apiClient from '../api';
// Вот корректный путь после перемещения файла модального окна
import StandDetailModal from '../components/StandDetail/StandDetailModal'; 
import './StandsPage.css';
import { ALL_ITEMS, truncateName } from '../constants';
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
        if (!container || !items || items.length === 0) return 0; // No items, no visible pills.

        const containerWidth = container.offsetWidth;
        const gap = 6;
        
        const tempPill = document.createElement('span');
        tempPill.style.visibility = 'hidden';
        tempPill.style.position = 'absolute';
        tempPill.className = 'ingredient-pill'; // Base class for sizing
        document.body.appendChild(tempPill);

        const getPillWidth = (text) => {
            tempPill.innerText = text;
            return tempPill.offsetWidth;
        };

        const showMorePillText = `...`; // Use a very short text for minimal show more button width
        const showMorePillWidth = getPillWidth(showMorePillText);

        let currentWidth = 0;
        let count = 0;

        for (let i = 0; i < items.length; i++) {
            const itemPillText = `${items[i].label}: ${items[i].value}`;
            const pillWidth = getPillWidth(itemPillText);
            
            let widthIfAdded = currentWidth + pillWidth + (i > 0 ? gap : 0);

            // If this is the last item, or if the next item would cause overflow
            // and there are still more items to show, we need space for 'show more' button.
            const needsShowMoreSpace = (i < items.length - 1);

            if (needsShowMoreSpace && (widthIfAdded + gap + showMorePillWidth > containerWidth)) {
                // This pill doesn't fit if we also need space for 'show more' button.
                // So, if we haven't added any pills yet, but we need show more, we should still show 1 pill.
                if (count === 0 && items.length > 0) {
                    count = 1; // Ensure at least one pill is shown if there are any items
                }
                break;
            } else if (!needsShowMoreSpace && widthIfAdded > containerWidth) {
                // If this is the last pill and it overflows without 'show more' button
                break;
            }
            
            currentWidth = widthIfAdded;
            count++;
        }

        document.body.removeChild(tempPill);

        // Ensure at least one pill is visible if there are any, unless the container is too small even for one
        return count > 0 ? count : (items.length > 0 ? 1 : 0); 
    }, []);

    useLayoutEffect(() => {
        const initialCalculatedCounts = {};
        terminals.forEach(terminal => {
            const element = refs.current[terminal.id];
            if (element) {
                const items = formatStock(terminal.machine_inventory);
                initialCalculatedCounts[terminal.id] = calculateVisibleCount(element, items);
            }
        });

        let currentMinGlobalVisibleCount = Infinity;
        if (terminals.length > 0) {
            currentMinGlobalVisibleCount = Math.min(...Object.values(initialCalculatedCounts));
        } else {
            currentMinGlobalVisibleCount = 0;
        }

        const finalInitialCounts = {};
        terminals.forEach(terminal => {
            finalInitialCounts[terminal.id] = currentMinGlobalVisibleCount; // Apply the global minimum for symmetry
        });
        setVisibleCounts(finalInitialCounts);


        const observers = new Map();
        terminals.forEach(terminal => {
            const element = refs.current[terminal.id];
            if (element) {
                const observer = new ResizeObserver(() => {
                    // Recalculate all counts on *any* resize
                    const currentCalculatedCounts = {};
                    terminals.forEach(t => {
                        const el = refs.current[t.id];
                        if (el) {
                            const items = formatStock(t.machine_inventory);
                            currentCalculatedCounts[t.id] = calculateVisibleCount(el, items);
                        }
                    });

                    let recalculatedMinGlobalVisibleCount = Infinity;
                    if (terminals.length > 0) {
                        recalculatedMinGlobalVisibleCount = Math.min(...Object.values(currentCalculatedCounts));
                    } else {
                        recalculatedMinGlobalVisibleCount = 0;
                    }

                    // Apply the new global minimum to ALL terminals
                    const finalUpdatedCounts = {};
                    terminals.forEach(t => {
                        finalUpdatedCounts[t.id] = recalculatedMinGlobalVisibleCount; // Apply the global minimum for symmetry
                    });
                    setVisibleCounts(finalUpdatedCounts);
                });
                observer.observe(element);
                observers.set(terminal.id, observer);
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
            label: truncateName(item.item_name),
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
                                    <span className={`status-indicator ${isOnline ? 'online' : 'offline'}`}></span>
                                    <div className="stand-info">
                                        <h3 className="stand-name">{terminal.name || `Терминал #${terminal.id}`}</h3>
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