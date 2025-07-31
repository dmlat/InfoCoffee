// frontend/src/components/StandDetail/StandRecipesTab.js
import React, { useState, useEffect, useMemo, useCallback, useRef, useLayoutEffect } from 'react';
import apiClient from '../../api';
import { ALL_ITEMS, truncateName } from '../../constants';
import CopySettingsModal from '../CopySettingsModal';
import EditRecipeModal from './EditRecipeModal';
import PresetSelectionModal from './PresetSelectionModal';
import { FaEyeSlash, FaUndo } from 'react-icons/fa'; // Иконка для скрытия
import './StandRecipesTab.css';

const formatRecipeName = (name) => {
    if (!name) return '';
    const firstLine = name.substring(0, 8);
    let secondLine = name.substring(8, 16);
    if (name.length > 16) {
        secondLine = secondLine.substring(0, 7) + '.';
    }
    if (!secondLine) return firstLine;
    return `${firstLine}\n${secondLine}`;
};

// Helper to sort ingredients based on the canonical order in ALL_ITEMS
const sortIngredients = (items) => {
    const order = ALL_ITEMS.map(item => item.name);
    return [...items].sort((a, b) => order.indexOf(a.item_name) - order.indexOf(b.item_name));
};


export default function StandRecipesTab({ terminal, internalTerminalId, machineItems, initialRecipes, allTerminals, onSave }) {
    const [recipes, setRecipes] = useState([]);
    const [hiddenRecipesVisible, setHiddenRecipesVisible] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [isCopyModalOpen, setIsCopyModalOpen] = useState(false);
    
    // State for modals
    const [editingRecipe, setEditingRecipe] = useState(null);
    const [isPresetSelectorOpen, setPresetSelectorOpen] = useState(false);
    const [selectingPresetFor, setSelectingPresetFor] = useState(null); // For which ID we are selecting a preset
    const [presetSelectionSource, setPresetSelectionSource] = useState(null); // 'tab' or 'modal'
    const scrollContainerRef = useRef(null);
    const scrollPositionRef = useRef(null);
    const wasHiddenVisibleRef = useRef(false);

    useEffect(() => {
        wasHiddenVisibleRef.current = hiddenRecipesVisible;
    }, [hiddenRecipesVisible]);

    useLayoutEffect(() => {
        if (scrollPositionRef.current !== null && scrollContainerRef.current) {
            scrollContainerRef.current.scrollTop = scrollPositionRef.current;
            scrollPositionRef.current = null; // Reset after restoring
        }
        if (wasHiddenVisibleRef.current) {
            setHiddenRecipesVisible(true);
        }
    }, [recipes]);


    useEffect(() => {
        if (!machineItems || !initialRecipes) return;
        
        const allRecipes = machineItems.map(itemId => {
            const existingRecipe = initialRecipes[itemId];
            if (existingRecipe) {
                return { ...existingRecipe };
            }
            return {
                machine_item_id: itemId,
                terminal_id: internalTerminalId,
                name: '',
                items: [],
                is_hidden: false, 
            };
        });

        // Сортировка: сначала рецепты с ингредиентами, потом без, внутри по ID
        allRecipes.sort((a, b) => {
            const aHasItems = a.items && a.items.length > 0;
            const bHasItems = b.items && b.items.length > 0;
            if (aHasItems && !bHasItems) return -1;
            if (!aHasItems && bHasItems) return 1;
            return a.machine_item_id - b.machine_item_id;
        });

        setRecipes(allRecipes);
    }, [initialRecipes, machineItems, internalTerminalId]);

    // Function to update a single recipe in the local state
    const updateLocalRecipe = (updatedRecipe) => {
        setRecipes(prevRecipes => {
            const newRecipes = prevRecipes.map(r => 
                r.machine_item_id === updatedRecipe.machine_item_id ? updatedRecipe : r
            );
            // Re-sort the list to maintain order
            newRecipes.sort((a, b) => {
                const aHasItems = a.items && a.items.length > 0;
                const bHasItems = b.items && b.items.length > 0;
                if (aHasItems && !bHasItems) return -1;
                if (!aHasItems && bHasItems) return 1;
                return a.machine_item_id - b.machine_item_id;
            });
            return newRecipes;
        });
    };

    const handleToggleHidden = async (recipe, isHidden) => {
        if (scrollContainerRef.current) {
            scrollPositionRef.current = scrollContainerRef.current.scrollTop;
        }

        try {
            let response;
            if (recipe.id) {
                // If recipe exists, just update its status
                response = await apiClient.post(`/recipes/${recipe.id}/toggle-hidden`, { is_hidden: isHidden });
            } else {
                // If recipe does not exist, create it with hidden status
                const payload = {
                    terminalId: recipe.terminal_id,
                    machine_item_id: recipe.machine_item_id,
                    name: 'Скрытый', // Placeholder name
                    items: [],
                    is_hidden: isHidden, // Explicitly set hidden status
                };
                response = await apiClient.post('/recipes', payload);
            }
            onSave();
        } catch (err) {
            console.error('Ошибка при обновлении статуса.', err);
            scrollPositionRef.current = null;
        }
    };
    
    const handlePresetSelected = async (preset) => {
        const targetMachineId = selectingPresetFor;
        if (!targetMachineId) return;

        // Common data for both paths
        const recipeData = {
            name: preset.name.split('(')[0].trim(),
            items: preset.items,
        };

        if (presetSelectionSource === 'tab') {
            if (scrollContainerRef.current) {
                scrollPositionRef.current = scrollContainerRef.current.scrollTop;
            }
            // Path 1: Save directly
            try {
                const payload = {
                    terminalId: internalTerminalId,
                    machine_item_id: targetMachineId,
                    ...recipeData,
                    save_as_template: false, // Not a template save from here
                };
                const response = await apiClient.post('/recipes', payload);
                onSave(); // Refresh the main list
            } catch (err) {
                 console.error('Ошибка сохранения.', err);
                 scrollPositionRef.current = null; // Reset on error
            }

        } else if (presetSelectionSource === 'modal') {
             // Path 2: Open in EditRecipeModal
            const baseRecipe = recipes.find(r => r.machine_item_id === targetMachineId) || {
                machine_item_id: targetMachineId,
                terminal_id: internalTerminalId,
            };
            const updatedRecipeWithPreset = { ...baseRecipe, ...recipeData };
            setEditingRecipe(updatedRecipeWithPreset);
        }

        // Cleanup
        setPresetSelectorOpen(false);
        setSelectingPresetFor(null);
        setPresetSelectionSource(null);
    };
    
    const handleCopyRecipes = async (destinationTerminalIds) => {
        setIsCopyModalOpen(false);
        if (destinationTerminalIds.length === 0) return;

        setIsSaving(true);
        
        try {
            const res = await apiClient.post('/recipes/copy', {
                sourceTerminalId: internalTerminalId,
                destinationTerminalIds: destinationTerminalIds
            });
            onSave(); // Refresh data after copy
        } catch (err) {
             console.error('Ошибка при копировании.', err);
        } finally {
            setIsSaving(false);
        }
    };

    const visibleRecipes = useMemo(() => recipes.filter(r => !r.is_hidden), [recipes]);
    const hiddenRecipes = useMemo(() => recipes.filter(r => r.is_hidden), [recipes]);

    const renderRecipeRow = (recipe, isHiddenTable = false) => {
        const hasItems = recipe.items && recipe.items.length > 0;

        // Group ingredients for special display rule
        const primaryIngredients = [];
        const singleUnitIngredients = [];
        if (hasItems) {
            const sortedItems = sortIngredients(recipe.items);
            sortedItems.forEach(item => {
                if (parseFloat(item.quantity) === 1) {
                    singleUnitIngredients.push(item);
                } else {
                    primaryIngredients.push(item);
                }
            });
        }

        return (
            <tr key={recipe.machine_item_id} className="recipe-row" onClick={() => !isHiddenTable && setEditingRecipe(recipe)}>
                <td className="id-col">
                    <div className="id-val">{recipe.machine_item_id}</div>
                    {!isHiddenTable && (
                        <div className="name-val">
                            {(recipe.name ? formatRecipeName(recipe.name) : 'Без названия')
                                .split('\n').map((line, idx) => (
                                    <React.Fragment key={idx}>
                                        {line}
                                        {idx < 1 ? <br/> : null}
                                    </React.Fragment>
                                ))}
                        </div>
                    )}
                </td>
                
                {!isHiddenTable && (
                    <td className="recipe-items-col">
                        {hasItems ? (
                            <span className="ingredient-summary-line" title={recipe.items.map(item => `${item.item_name}: ${item.quantity}`).join(' | ')}>
                                {primaryIngredients.map((item, index) => (
                                    <span className="ingredient-group" key={item.item_name}>
                                        {`${truncateName(item.item_name)}: `}
                                        <span className="ingredient-quantity-highlight">{item.quantity}</span>
                                        {(index < primaryIngredients.length - 1 || singleUnitIngredients.length > 0) && <span className="separator"> | </span>}
                                    </span>
                                ))}
                                {singleUnitIngredients.length > 0 && (
                                    <span className="ingredient-group">
                                        {`${singleUnitIngredients.map(i => truncateName(i.item_name)).join(', ')}: `}
                                        <span className="ingredient-quantity-highlight">1</span>
                                    </span>
                                )}
                            </span>
                        ) : (
                            <div className="recipe-actions">
                                <button className="action-link" onClick={(e) => { e.stopPropagation(); setEditingRecipe(recipe); }}>Создать новый рецепт</button>
                                <span>&nbsp;или&nbsp;</span>
                                <button className="action-link" onClick={(e) => { 
                                    e.stopPropagation(); 
                                    setSelectingPresetFor(recipe.machine_item_id);
                                    setPresetSelectionSource('tab');
                                    setPresetSelectorOpen(true);
                                }}>Выбрать готовый</button>
                            </div>
                        )}
                    </td>
                )}

                <td className="actions-col" onClick={(e) => e.stopPropagation()}>
                    {isHiddenTable ? (
                         <button 
                            className="action-btn secondary compact-return-btn" 
                            onClick={() => handleToggleHidden(recipe, false)}
                            title="Вернуть в основной список"
                        >
                           <FaUndo style={{ marginRight: '4px' }} /> Вернуть
                         </button>
                    ) : (
                        <button 
                            className="hide-btn" 
                            title="Скрыть ID" 
                            onClick={(e) => {
                                e.stopPropagation();
                                handleToggleHidden(recipe, true);
                            }}
                        >
                            <FaEyeSlash />
                        </button>
                    )}
                </td>
            </tr>
        );
    };

    return (
        <>
            {editingRecipe && (
                <EditRecipeModal
                    recipe={editingRecipe}
                    onClose={(didSave) => {
                        if (didSave) {
                           // Re-fetch data if a recipe was edited and saved in the modal
                           onSave(); 
                        }
                        setEditingRecipe(null);
                    }}
                    onOpenPresetSelector={() => {
                        setSelectingPresetFor(editingRecipe.machine_item_id);
                        setPresetSelectionSource('modal');
                        setPresetSelectorOpen(true);
                    }}
                />
            )}

            {isPresetSelectorOpen && (
                <PresetSelectionModal
                    onClose={() => {
                        setPresetSelectorOpen(false);
                        setSelectingPresetFor(null); // Clear the target on close
                        setPresetSelectionSource(null);
                    }}
                    onSelect={handlePresetSelected}
                />
            )}

            {isCopyModalOpen && (
                 <CopySettingsModal
                    terminals={allTerminals}
                    sourceTerminalId={terminal.id}
                    onSave={handleCopyRecipes}
                    onClose={() => setIsCopyModalOpen(false)}
                    title="Копировать рецепты в..."
                />
            )}
            <div className="modal-tab-content recipes-form" ref={scrollContainerRef}>
                <div className="recipes-info-block">
                    <div className="recipes-info-text-container">
                        <p className="recipes-info-text">&#8226; Нажмите на <span className="text-highlight-blue">рецепт</span>, чтобы настроить его.</p>
                        <p className="recipes-info-text">&#8226; Нажмите <FaEyeSlash style={{ verticalAlign: 'middle', margin: '0 4px' }} /> и <span className="text-highlight-red">скройте</span> неиспользуемые ID.</p>
                    </div>
                    <button type="button" className="action-btn secondary copy-recipes-btn" onClick={() => setIsCopyModalOpen(true)} disabled={isSaving}>Копировать</button>
                </div>

                <div className="table-scroll-container">
                    <table className="recipes-table-new">
                        <thead>
                            <tr>
                                <th className="id-col-header">ID</th>
                                <th className="recipe-items-col-header">Рецепт</th>
                                <th className="actions-col-header"></th>
                            </tr>
                        </thead>
                        <tbody>
                            {visibleRecipes.length > 0 
                                ? visibleRecipes.map(recipe => renderRecipeRow(recipe))
                                : <tr><td colSpan="3">Нет активных рецептов.</td></tr>
                            }
                        </tbody>
                    </table>
                </div>
                
                {hiddenRecipes.length > 0 && (
                    <div className="tasks-list-container" style={{ marginTop: '16px' }}>
                        <div className="container-header" onClick={() => setHiddenRecipesVisible(!hiddenRecipesVisible)}>
                             <h2 className="container-title">
                                <span className={`toggle-arrow ${hiddenRecipesVisible ? 'open' : ''}`}></span>
                                Скрытые ID ({hiddenRecipes.length})
                            </h2>
                        </div>
                        
                        {hiddenRecipesVisible && (
                             <div className="table-scroll-container" style={{ marginTop: '12px' }}>
                                <table className="recipes-table-new hidden-table">
                                     <thead>
                                        <tr>
                                            <th className="id-col-header">ID</th>
                                            <th className="actions-col-header">Действие</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {hiddenRecipes.map(recipe => renderRecipeRow(recipe, true))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </>
    );
}