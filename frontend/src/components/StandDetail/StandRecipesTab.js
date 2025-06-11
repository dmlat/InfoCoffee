// frontend/src/components/StandDetail/StandRecipesTab.js
import React, { useState, useEffect, useMemo } from 'react';
import apiClient from '../../api';
import { ALL_ITEMS } from '../../constants';
import CopySettingsModal from '../CopySettingsModal';
import './StandRecipesTab.css';

// Вспомогательная функция для форматирования заголовков
const formatHeader = (name) => {
    if (name.length <= 4) return name;
    return name.substring(0, 3);
};

// Константа для расходников, которым нужно значение по умолчанию
const CONSUMABLES_WITH_DEFAULT_1 = ['Стаканы', 'Крышки', 'Размеш.', 'Сахар', 'Трубочки'];

export default function StandRecipesTab({ terminal, internalTerminalId, machineItems, initialRecipes, allTerminals, onSave }) {
    const [recipes, setRecipes] = useState([]);
    const [changedRecipeIds, setChangedRecipeIds] = useState(new Set());
    const [isSaving, setIsSaving] = useState(false);
    const [isCopyModalOpen, setIsCopyModalOpen] = useState(false);
    const [saveStatus, setSaveStatus] = useState({ message: '', type: '' });

    useEffect(() => {
        if (!machineItems || !initialRecipes) return;
        
        const newRecipes = machineItems.map(itemId => {
            const existingRecipe = initialRecipes[itemId];
            
            if (existingRecipe) {
                // Если рецепт уже существует, просто возвращаем его
                return { ...existingRecipe };
            }
            
            // --- ИЗМЕНЕНИЕ ЗДЕСЬ ---
            // Если рецепта нет, создаем новый с дефолтными значениями для расходников
            return {
                machine_item_id: itemId,
                terminal_id: internalTerminalId,
                name: '',
                // Создаем массив `items` с предустановленными расходниками
                items: CONSUMABLES_WITH_DEFAULT_1.map(name => ({
                    item_name: name,
                    quantity: 1
                })),
            };
        });

        setRecipes(newRecipes);
        setChangedRecipeIds(new Set());
    }, [initialRecipes, machineItems, internalTerminalId]);


    const handleRecipeChange = (machineItemId, field, value, itemName = null) => {
        setRecipes(prevRecipes =>
            prevRecipes.map(recipe => {
                if (recipe.machine_item_id === machineItemId) {
                    const updatedRecipe = { ...recipe };
                    if (field === 'name') {
                        updatedRecipe.name = value;
                    } else if (field === 'quantity' && itemName) {
                        const newItems = [...(recipe.items || [])];
                        const itemIndex = newItems.findIndex(i => i.item_name === itemName);
                        const normalizedValue = value.replace(/,/g, '.').replace(/[^0-9.]/g, '');

                        if (itemIndex > -1) {
                            newItems[itemIndex] = { ...newItems[itemIndex], quantity: normalizedValue };
                        } else {
                            newItems.push({ item_name: itemName, quantity: normalizedValue });
                        }
                        updatedRecipe.items = newItems;
                    }
                    return updatedRecipe;
                }
                return recipe;
            })
        );
        setChangedRecipeIds(prev => new Set(prev).add(machineItemId));
    };

    const showSaveStatus = (message, type) => {
        setSaveStatus({ message, type });
        setTimeout(() => setSaveStatus({ message: '', type: '' }), 3500);
    };

    const handleSave = async () => {
        setIsSaving(true);
        const recipesToSave = recipes.filter(r => changedRecipeIds.has(r.machine_item_id));

        const savePromises = recipesToSave.map(recipe => {
            const payload = {
                terminalId: recipe.terminal_id,
                machine_item_id: recipe.machine_item_id,
                name: recipe.name,
                items: recipe.items.filter(item => item.quantity && parseFloat(item.quantity) > 0)
            };
            return apiClient.post('/recipes', payload);
        });

        try {
            await Promise.all(savePromises);
            showSaveStatus('Изменения успешно сохранены!', 'success');
            onSave(); // Обновляем данные после сохранения
        } catch (err) {
            showSaveStatus(err.response?.data?.error || 'Ошибка при сохранении.', 'error');
        } finally {
            setIsSaving(false);
        }
    };
    
    const handleCopyRecipes = async (destinationVendistaIds) => {
        setIsCopyModalOpen(false);
        if (destinationVendistaIds.length === 0) return;

        setIsSaving(true);
        showSaveStatus(`Копирование в ${destinationVendistaIds.length} терминал(а/ов)...`, 'info');
        
        try {
            const internalIdPromises = destinationVendistaIds.map(vendistaId => 
                apiClient.get(`/terminals/vendista/${vendistaId}/details`).then(res => res.data.internalId)
            );
            
            const destinationInternalIds = await Promise.all(internalIdPromises);

            const res = await apiClient.post('/recipes/copy', {
                sourceTerminalId: internalTerminalId,
                destinationTerminalIds: destinationInternalIds
            });
            showSaveStatus(res.data.message, res.data.success ? 'success' : 'error');
        } catch (err) {
             showSaveStatus(err.response?.data?.error || 'Ошибка при копировании.', 'error');
        } finally {
            setIsSaving(false);
        }
    };
    
    const handleFocus = (e) => e.currentTarget.select();

    const recipeItemsMap = useMemo(() => ALL_ITEMS.map(i => i.name), []);

    return (
        <>
            {isCopyModalOpen && (
                 <CopySettingsModal
                    terminals={allTerminals}
                    sourceTerminalId={terminal.id}
                    onClose={() => setIsCopyModalOpen(false)}
                    onSave={handleCopyRecipes}
                    title="Копировать рецепты в..."
                />
            )}
            <div className="modal-tab-content recipes-form">
                <div className="settings-header-container">
                    <h4>Укажите граммы/шт.</h4>
                    <div className="header-buttons">
                         <button type="button" className="action-btn secondary" onClick={() => setIsCopyModalOpen(true)} disabled={isSaving}>Копировать</button>
                        <button type="button" className="action-btn header-save-btn" onClick={handleSave} disabled={isSaving || changedRecipeIds.size === 0}>
                            {isSaving ? 'Сохранение...' : 'Сохранить'}
                        </button>
                    </div>
                </div>
                 {saveStatus.message && <div className={`save-status-recipes ${saveStatus.type}`}>{saveStatus.message}</div>}

                <div className="table-scroll-container">
                    <table className="recipes-table">
                        <thead>
                            <tr>
                                <th className="sticky-col id-col">ID</th>
                                <th className="sticky-col name-col">Name</th>
                                {recipeItemsMap.map(itemName => (
                                    <th key={itemName} title={itemName}>{formatHeader(itemName)}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {recipes.length > 0 ? recipes.map(recipe => {
                                const itemsAsMap = (recipe.items || []).reduce((acc, item) => {
                                    acc[item.item_name] = item.quantity;
                                    return acc;
                                }, {});

                                return (
                                <tr key={recipe.machine_item_id}>
                                    <td className="sticky-col id-col">{recipe.machine_item_id}</td>
                                    <td className="sticky-col name-col">
                                        <input 
                                            type="text" 
                                            placeholder="Название напитка" 
                                            value={recipe.name || ''} 
                                            onChange={e => handleRecipeChange(recipe.machine_item_id, 'name', e.target.value)}
                                            onFocus={handleFocus}
                                            className="recipe-name-input"
                                        />
                                    </td>
                                    {recipeItemsMap.map(itemName => (
                                        <td key={itemName}>
                                            <input 
                                                type="text" 
                                                inputMode="decimal"
                                                placeholder="0" 
                                                value={itemsAsMap[itemName] || ''}
                                                onChange={e => handleRecipeChange(recipe.machine_item_id, 'quantity', e.target.value, itemName)}
                                                onFocus={handleFocus}
                                            />
                                        </td>
                                    ))}
                                </tr>
                            )}) : (
                                <tr><td colSpan={recipeItemsMap.length + 2}>Нет данных о проданных напитках. Совершите продажу, чтобы кнопки появились.</td></tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </>
    );
}