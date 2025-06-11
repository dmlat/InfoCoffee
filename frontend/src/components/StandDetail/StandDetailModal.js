// frontend/src/components/StandDetail/StandDetailModal.js
import React, { useState, useEffect, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import apiClient from '../../api';
import StandNavigator from './StandNavigator';
import StandStockTab from './StandStockTab';
import StandRecipesTab from './StandRecipesTab';
import StandSettingsTab from './StandSettingsTab';
import { ALL_ITEMS } from '../../constants';
import './StandDetailModal.css';

export default function StandDetailModal({ terminal, allTerminals, onTerminalChange, onClose }) {
    const location = useLocation();
    const navigate = useNavigate();

    const getTabFromHash = () => {
        const hash = location.hash.replace('#', '');
        if (['stock', 'recipes', 'settings'].includes(hash)) {
            return hash;
        }
        return 'stock';
    }

    const [activeTab, setActiveTab] = useState(getTabFromHash);
    const [details, setDetails] = useState({ inventory: [] });
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState('');
    
    const [initialSettings, setInitialSettings] = useState({});
    const [machineItems, setMachineItems] = useState([]);
    const [initialRecipes, setInitialRecipes] = useState({});
    const [internalTerminalId, setInternalTerminalId] = useState(null);

    const formatNumericOutput = (value) => {
        const num = parseFloat(value);
        if (isNaN(num)) return '';
        if (num % 1 === 0) return String(Math.round(num));
        return String(num);
    };

    const fetchDetailsAndRecipes = useCallback(async () => {
        const vendistaId = terminal.id;
        if (!vendistaId) return;
        
        setIsLoading(true); setError('');
        try {
            const detailsResponse = await apiClient.get(`/terminals/vendista/${vendistaId}/details`, {
                params: { name: terminal.comment, serial_number: terminal.serial_number }
            });
            if (!detailsResponse.data.success) throw new Error(detailsResponse.data.error);

            const { details: fetchedDetails, internalId: fetchedInternalId } = detailsResponse.data;
            setDetails(fetchedDetails);
            setInternalTerminalId(fetchedInternalId);
            
            const newSettings = {};
            ALL_ITEMS.forEach(item => {
                // --- ГЛАВНОЕ ИСПРАВЛЕНИЕ БАГА ---
                // Ищем настройку именно для локации 'machine', чтобы избежать путаницы
                const existingItem = fetchedDetails.inventory.find(
                    i => i.item_name === item.name && i.location === 'machine'
                );
                newSettings[item.name] = {
                    max_stock: formatNumericOutput(existingItem?.max_stock),
                    critical_stock: formatNumericOutput(existingItem?.critical_stock)
                };
            });
            setInitialSettings(newSettings);

            const itemsResponse = await apiClient.get(`/terminals/vendista/${vendistaId}/machine-items`);
            if (itemsResponse.data.success) setMachineItems(itemsResponse.data.machineItems || []);

            if(fetchedInternalId) {
                const recipesResponse = await apiClient.get(`/recipes/terminal/${fetchedInternalId}`);
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
            }
        } catch (err) {
            setError(err.response?.data?.error || 'Ошибка сети при загрузке данных стойки.');
        } finally {
            setIsLoading(false);
        }
    }, [terminal.id, terminal.comment, terminal.serial_number]);

    useEffect(() => {
        fetchDetailsAndRecipes();
    }, [fetchDetailsAndRecipes]);

    const handleTabClick = (tabId) => {
        setActiveTab(tabId);
        navigate(`${location.pathname}#${tabId}`, { replace: true });
    };
    
    // Переименовываем вкладку для ясности
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
                       />;
            case 'settings':
                return <StandSettingsTab 
                            terminal={terminal}
                            initialSettings={initialSettings}
                            onSave={fetchDetailsAndRecipes}
                       />;
            default:
                return null;
        }
    }

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content stand-detail-modal" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>Настройки стойки</h2>
                    <button className="modal-close-btn" onClick={onClose}>&times;</button>
                </div>
                
                <StandNavigator 
                    terminal={terminal}
                    allTerminals={allTerminals}
                    onTerminalChange={onTerminalChange}
                />

                <div className="modal-body">
                    <div className="modal-tabs">
                        {Object.entries(tabTitleMap).map(([tabId, title]) => (
                             <button key={tabId} onClick={() => handleTabClick(tabId)} className={activeTab === tabId ? 'active' : ''}>
                                {title}
                            </button>
                        ))}
                    </div>
                    
                    {isLoading && <div className="page-loading-container"><span>Загрузка деталей...</span></div>}
                    {error && <p className="error-message">{error}</p>}
                    {!isLoading && !error && renderActiveTab()}
                </div>
            </div>
        </div>
    );
}