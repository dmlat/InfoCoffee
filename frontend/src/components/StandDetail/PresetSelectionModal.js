// frontend/src/components/StandDetail/PresetSelectionModal.js
import React, { useState, useEffect } from 'react';
import apiClient from '../../api';
import './PresetSelectionModal.css';
import '../../components/ModalFrame.css'; // Import shared modal styles

const formatIngredientName = (name) => {
    return name.length > 5 ? name.substring(0, 5) + '.' : name;
};

const PresetSelectionModal = ({ onClose, onSelect, source }) => { // Added source prop
    const [presets, setPresets] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState('');

    useEffect(() => {
        const fetchPresets = async () => {
            try {
                const response = await apiClient.get('/presets');
                if (response.data.success) {
                    setPresets(response.data.presets || []);
                } else {
                    setError('Не удалось загрузить шаблоны.');
                }
            } catch (err) {
                setError(err.response?.data?.error || 'Ошибка сети при загрузке шаблонов.');
            } finally {
                setIsLoading(false);
            }
        };
        fetchPresets();
    }, []);
    
     const handleSelect = (preset) => {
        // The onSelect function (coming from StandRecipesTab) handles
        // updating the state in EditRecipeModal and closing this preset modal.
        onSelect(preset);
    };

    const handleClose = () => {
        // If the modal was opened from the EditRecipeModal, just close it.
        // If it was opened directly from StandRecipesTab, onClose will handle everything.
        onClose();
    };

    const renderRecipeGrid = (items) => {
        const itemsChunks = [];
        if (items && items.length > 0) {
            for (let i = 0; i < items.length; i += 3) { // Changed to 3 for 6 columns
                itemsChunks.push(items.slice(i, i + 3));
            }
        }
        return (
             <div className="preset-recipe-grid six-columns">
                {itemsChunks.map((chunk, index) => (
                    <React.Fragment key={index}>
                        <div className="preset-ingredient-cell name">{formatIngredientName(chunk[0].item_name)}:</div>
                        <div className="preset-ingredient-cell value">{chunk[0].quantity}</div>
                        {chunk[1] ? (
                            <>
                                <div className="preset-ingredient-cell name">{formatIngredientName(chunk[1].item_name)}:</div>
                                <div className="preset-ingredient-cell value">{chunk[1].quantity}</div>
                            </>
                        ) : <><div/><div/></> }
                        {chunk[2] ? (
                            <>
                                <div className="preset-ingredient-cell name">{formatIngredientName(chunk[2].item_name)}:</div>
                                <div className="preset-ingredient-cell value">{chunk[2].quantity}</div>
                            </>
                        ) : <><div/><div/></> }
                    </React.Fragment>
                ))}
            </div>
        );
    };

    return (
        <div className="modal-overlay">
            <div className="modal-content">
                <div className="modal-header">
                    <h2 className="modal-title">Выбрать готовый рецепт</h2>
                    <button onClick={handleClose} className="modal-close-btn">&times;</button>
                </div>
                <div className="modal-body">
                    {isLoading && <p>Загрузка шаблонов...</p>}
                    {error && <p className="error-message">{error}</p>}
                    {!isLoading && !error && presets.length === 0 && (
                        <p>Нет доступных шаблонов. Вы можете создать их, сохраняя рецепты.</p>
                    )}
                    <div className="presets-list">
                        {presets.map(preset => (
                            <div key={preset.id} className="preset-card" onClick={() => handleSelect(preset)}>
                                <h4 className="preset-name">{preset.name}</h4>
                                {renderRecipeGrid(preset.items)}
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default PresetSelectionModal; 