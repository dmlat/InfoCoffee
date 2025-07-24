// frontend/src/components/StandDetail/StandDetailModal.js
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import apiClient from '../../api';
import StandNavigator from './StandNavigator';
import StandStockTab from './StandStockTab';
import StandRecipesTab from './StandRecipesTab';
import StandSettingsTab from './StandSettingsTab';
import TerminalListModal from '../TerminalListModal';
import { ALL_ITEMS } from '../../constants';
import './StandDetailModal.css';

export default function StandDetailModal({ terminal, allTerminals, onTerminalChange, onClose, initialTab }) {
    const location = useLocation();
    const navigate = useNavigate();
    const scrollPositionRef = useRef(null); // Ref to hold scroll position

    const getTabFromHash = useCallback(() => {
        const hash = location.hash.replace('#', '');
        if (['stock', 'recipes', 'settings'].includes(hash)) {
            return hash;
        }
        return 'stock';
    }, [location.hash]);

    const [activeTab, setActiveTab] = useState(initialTab || getTabFromHash);
    const [details, setDetails] = useState({ inventory: [] });
    const [error, setError] = useState('');
    
    const [initialSettings, setInitialSettings] = useState({});
    const [machineItems, setMachineItems] = useState([]);
    const [initialRecipes, setInitialRecipes] = useState({});
    const [internalTerminalId, setInternalTerminalId] = useState(null);
    const [isTerminalListModalOpen, setIsTerminalListModalOpen] = useState(false);
    const [hiddenRecipesVisible, setHiddenRecipesVisible] = useState(false);

    const formatNumericOutput = (value) => {
        const num = parseFloat(value);
        if (isNaN(num)) return '';
        if (num % 1 === 0) return String(Math.round(num));
        return String(num);
    };

    const fetchDetailsAndRecipes = useCallback(async () => {
        const internalId = terminal.id;
        if (!internalId) return;
        
        setError('');
        setInternalTerminalId(internalId); // Устанавливаем ID сразу

        try {
            // Параллельно запрашиваем все необходимые данные
            const [settingsResponse, itemsResponse, recipesResponse] = await Promise.all([
                apiClient.get(`/terminals/${internalId}/settings`),
                apiClient.get(`/terminals/${internalId}/machine-items`),
                apiClient.get(`/recipes/terminal/${internalId}`)
            ]);

            // Обработка настроек
            if (!settingsResponse.data.success) throw new Error('Не удалось загрузить настройки контейнеров');
            const inventory = settingsResponse.data.settings || [];
            setDetails({ inventory }); // Сохраняем для StandStockTab

            const newSettings = {};
            ALL_ITEMS.forEach(item => {
                const existingItem = inventory.find(i => i.item_name === item.name && i.location === 'machine');
                newSettings[item.name] = {
                    max_stock: formatNumericOutput(existingItem?.max_stock),
                    critical_stock: formatNumericOutput(existingItem?.critical_stock)
                };
            });
            setInitialSettings(newSettings);

            // Обработка кнопок машины
            if (itemsResponse.data.success) {
                setMachineItems(itemsResponse.data.machineItems || []);
            }

            // Обработка рецептов
            if (recipesResponse.data.success) {
                const recipesMap = (recipesResponse.data.recipes || []).reduce((acc, recipe) => {
                    acc[recipe.machine_item_id] = { ...recipe };
                    Object.keys(recipe).forEach(key => {
                        if (key.includes('_grams') || key.includes('_ml')) {
                            acc[recipe.machine_item_id][key] = formatNumericOutput(recipe[key]);
                        }
                    });
                    return acc;
                }, {});
                setInitialRecipes(recipesMap);
            }

        } catch (err) {
            setError(err.response?.data?.error || err.message || 'Ошибка сети при загрузке данных стойки.');
        } finally {
            // No more global loading state
        }
    }, [terminal.id]);

    useEffect(() => {
        fetchDetailsAndRecipes();
    }, [fetchDetailsAndRecipes]);

    useEffect(() => {
        if (!initialTab) {
            setActiveTab(getTabFromHash());
        }
    }, [getTabFromHash, initialTab]);

    const handleTabClick = (tabId) => {
        setActiveTab(tabId);
        navigate(`${location.pathname}#${tabId}`, { replace: true });
    };
    
    const tabTitleMap = {
        'stock': 'Остатки',
        'recipes': 'Рецепты',
        'settings': 'Контейнеры'
    };

    const renderActiveTab = () => {
        switch(activeTab) {
            case 'stock':
                return <StandStockTab details={details} onConfigureClick={() => handleTabClick('settings')} />;
            case 'recipes':
                return <StandRecipesTab 
                            terminal={terminal}
                            internalTerminalId={internalTerminalId}
                            machineItems={machineItems}
                            initialRecipes={initialRecipes}
                            allTerminals={allTerminals}
                            onSave={fetchDetailsAndRecipes} 
                            hiddenRecipesVisible={hiddenRecipesVisible}
                            setHiddenRecipesVisible={setHiddenRecipesVisible}
                            scrollPositionRef={scrollPositionRef}
                       />;
            case 'settings':
                return <StandSettingsTab 
                            terminal={terminal}
                            allTerminals={allTerminals}
                            internalTerminalId={internalTerminalId}
                            initialSettings={initialSettings}
                            onSave={fetchDetailsAndRecipes}
                       />;
            default:
                return null;
        }
    }

    const handleSelectAndClose = (selectedTerminal) => {
        onTerminalChange(selectedTerminal);
        setIsTerminalListModalOpen(false);
    };

    return (
        <>
            <div className="modal-overlay" onClick={onClose}>
                <div className="modal-content stand-detail-modal" onClick={e => e.stopPropagation()}>
                    <div className="modal-header">
                        <h2 className="modal-title">Настройки стойки</h2>
                        <button className="modal-close-btn" onClick={onClose}>&times;</button>
                    </div>
                    
                    <StandNavigator 
                        terminal={terminal}
                        allTerminals={allTerminals}
                        onTerminalChange={onTerminalChange}
                        onNameClick={() => setIsTerminalListModalOpen(true)}
                    />

                    <div className="modal-body">
                        <div className="modal-tabs">
                            {Object.entries(tabTitleMap).map(([tabId, title]) => {
                                let isPending = false;
                                if (tabId === 'recipes') isPending = terminal.needs_recipes_config;
                                if (tabId === 'settings') isPending = terminal.needs_containers_config;
                                
                                return (
                                    <button 
                                        key={tabId} 
                                        onClick={() => handleTabClick(tabId)} 
                                        className={`${activeTab === tabId ? 'active' : ''} ${isPending ? 'pending' : ''}`}
                                    >
                                        {title}
                                    </button>
                                );
                            })}
                        </div>
                        
                        {error && <p className="error-message">{error}</p>}
                        {renderActiveTab()}
                    </div>
                </div>
            </div>

            {isTerminalListModalOpen && (
                <TerminalListModal
                    terminals={allTerminals}
                    onSelect={handleSelectAndClose}
                    onClose={() => setIsTerminalListModalOpen(false)}
                    currentSelection={terminal.id}
                />
            )}
        </>
    );
}