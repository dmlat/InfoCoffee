// frontend/src/components/StandDetail/EditRecipeModal.js
import React, { useState, useEffect, useCallback, useRef } from 'react';
import apiClient from '../../api';
import { ALL_ITEMS, truncateName } from '../../constants';
import ConfirmModal from '../ConfirmModal';
import { FaListUl } from 'react-icons/fa'; // Import a list icon
import './EditRecipeModal.css';
import '../../components/ModalFrame.css';


const EditRecipeModal = ({ recipe, onClose, onOpenPresetSelector }) => {
    const [name, setName] = useState('');
    const [items, setItems] = useState([]);
    const [saveAsTemplate, setSaveAsTemplate] = useState(false);
    const [isDirty, setIsDirty] = useState(false);
    const [initialState, setInitialState] = useState(null);
    const [showConfirmClose, setShowConfirmClose] = useState(false);
    const openedRecipeIdRef = useRef(null);

    // Custom comparison function for items to handle type differences
    const itemsAreEqual = (a, b) => {
        if (a.length !== b.length) return false;
        const sortedA = [...a].sort((x, y) => x.item_name.localeCompare(y.item_name));
        const sortedB = [...b].sort((x, y) => x.item_name.localeCompare(y.item_name));
        for (let i = 0; i < sortedA.length; i++) {
            if (sortedA[i].item_name !== sortedB[i].item_name ||
                parseFloat(sortedA[i].quantity) !== parseFloat(sortedB[i].quantity)) {
                return false;
            }
        }
        return true;
    };
    
    // Effect to initialize and reset state when `recipe` prop changes
    useEffect(() => {
        if (recipe) {
            const isNewRecipeContext = openedRecipeIdRef.current !== recipe.machine_item_id;

            const recipeName = recipe.name || '';
            const recipeItemsMap = (recipe.items || []).reduce((acc, item) => {
                acc[item.item_name] = item.quantity;
                return acc;
            }, {});

            const allPossibleItems = ALL_ITEMS.map(item => ({
                item_name: item.name,
                quantity: recipeItemsMap[item.name] || '',
            }));

            setName(recipeName);
            setItems(allPossibleItems);
            
            if (isNewRecipeContext) {
                openedRecipeIdRef.current = recipe.machine_item_id;
                setSaveAsTemplate(false);

                const initial = {
                    name: recipeName,
                    items: allPossibleItems.filter(i => i.quantity && parseFloat(i.quantity) > 0),
                    saveAsTemplate: false,
                };
                
                setInitialState(initial);
                setIsDirty(false); // Always reset dirty state when a new recipe is loaded
            }
        }
    }, [recipe]);
    
    // Effect to check for changes and set the dirty state
    useEffect(() => {
        if (!initialState) return;
        
        const currentName = name;
        const currentItems = items.filter(item => item.quantity && parseFloat(item.quantity) > 0);

        const nameChanged = currentName !== initialState.name;
        const itemsChanged = !itemsAreEqual(currentItems, initialState.items);
        const templateChanged = saveAsTemplate !== initialState.saveAsTemplate;

        setIsDirty(nameChanged || itemsChanged || templateChanged);
    }, [name, items, saveAsTemplate, initialState]);


    const handleSave = useCallback(async () => {
        if (!recipe || !isDirty) return;

        const payload = {
            terminalId: recipe.terminal_id,
            machine_item_id: recipe.machine_item_id,
            name: name,
            items: items.filter(item => item.quantity && parseFloat(item.quantity) > 0),
            save_as_template: saveAsTemplate,
        };

        try {
            await apiClient.post('/recipes', payload);
            onClose(true); // Close modal on successful save, pass true to indicate save
        } catch (error) {
            console.error("Failed to save recipe:", error);
        }
    }, [recipe, name, items, saveAsTemplate, isDirty, onClose]);

    const handleCloseRequest = () => {
        if (isDirty) {
            setShowConfirmClose(true);
        } else {
            onClose(false); // Pass false to indicate no save happened
        }
    };
    
    const handleConfirmSaveAndClose = async () => {
        await handleSave();
        // onClose is now called inside handleSave
    };

    const handleItemChange = (itemName, value) => {
        const normalizedValue = value.replace(/,/g, '.').replace(/[^0-9.]/g, '');
        setItems(prevItems =>
            prevItems.map(item =>
                item.item_name === itemName ? { ...item, quantity: normalizedValue } : item
            )
        );
    };

    const handleFocus = (e) => e.currentTarget.select();

    if (!recipe) return null;

    return (
        <div className="modal-overlay">
            <div className="modal-content">
                <div className="modal-header">
                    <h2 className="modal-title">Рецепт для ID: {recipe.machine_item_id}</h2>
                    <button onClick={handleCloseRequest} className="modal-close-btn">&times;</button>
                </div>
                <div className="modal-body">
                     <div className="template-checkbox-top">
                        <input
                            id="saveAsTemplate"
                            type="checkbox"
                            checked={saveAsTemplate}
                            onChange={(e) => setSaveAsTemplate(e.target.checked)}
                        />
                        <label htmlFor="saveAsTemplate">
                            Сохранить шаблон для других стоек?
                        </label>
                    </div>

                    <div className="top-buttons-container">
                        <div className="recipe-control-group">
                             <button className="action-btn secondary preset-btn" onClick={onOpenPresetSelector}>
                                <FaListUl style={{ marginRight: '8px', fontSize: '0.9em' }}/>
                                Выбрать готовый
                             </button>
                        </div>
                        <div className="recipe-control-group">
                             <label>&nbsp;</label> {/* Placeholder for alignment */}
                             <button className="action-btn" onClick={handleSave} disabled={!isDirty}>
                                Сохранить
                            </button>
                        </div>
                    </div>

                     <div className="recipe-name-container">
                        <label htmlFor="recipeName">Название</label>
                        <input
                            id="recipeName"
                            type="text"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="Например, Капучино"
                        />
                    </div>

                    <div className="ingredients-grid three-columns">
                        {items.map(item => (
                            <div key={item.item_name} className="ingredient-input-group">
                                <label htmlFor={`item-${item.item_name}`}>{truncateName(item.item_name)}</label>
                                <input
                                    id={`item-${item.item_name}`}
                                    type="text"
                                    inputMode="decimal"
                                    value={item.quantity}
                                    onChange={(e) => handleItemChange(item.item_name, e.target.value)}
                                    onFocus={handleFocus}
                                    placeholder="0"
                                />
                            </div>
                        ))}
                    </div>
                </div>
                 {showConfirmClose && (
                    <ConfirmModal
                        isOpen={true}
                        title="Сохранить изменения?"
                        message="У вас есть несохранённые изменения. Сохранить их перед выходом?"
                        onConfirm={handleConfirmSaveAndClose}
                        onCancel={() => {
                            setShowConfirmClose(false);
                            onClose(false); // Discard changes and close
                        }}
                        confirmText="Да"
                        cancelText="Нет"
                    />
                )}
            </div>
        </div>
    );
};

export default EditRecipeModal; 