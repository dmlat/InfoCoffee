// frontend/src/components/StandDetail/StandRecipesTab.js
import React, { useState, useEffect } from 'react';
import apiClient from '../../api';
import ConfirmModal from '../ConfirmModal';
import TerminalListModal from '../TerminalListModal';
import './StandRecipesTab.css';

const RECIPE_INGREDIENTS_MAP = {
    'Кофе': 'coffee_grams', 'Вода': 'water_ml', 'Сливки': 'milk_grams',
    'Какао': 'cocoa_grams', 'Раф': 'raf_grams'
};

export default function StandRecipesTab({ terminal, internalTerminalId, machineItems, initialRecipes, allTerminals, onSave }) {
    const [recipes, setRecipes] = useState(initialRecipes);
    const [isSaving, setIsSaving] = useState(false);
    const [isCopyModalOpen, setIsCopyModalOpen] = useState(false);
    const [confirmModalState, setConfirmModalState] = useState({ isOpen: false, message: '', onConfirm: () => {} });
    const [saveStatus, setSaveStatus] = useState({ message: '', type: '' });

    useEffect(() => {
        setRecipes(initialRecipes);
    }, [initialRecipes]);

    const normalizeNumericInput = (value) => value.replace(/,/g, '.').replace(/[^0-9.]/g, '');

    const handleRecipeChange = (machineItemId, field, value) => {
        setRecipes(prev => ({
            ...prev,
            [machineItemId]: {
                ...prev[machineItemId],
                machine_item_id: machineItemId,
                [field]: field.includes('_grams') || field.includes('_ml') ? normalizeNumericInput(value) : value
            }
        }));
    };

    const showSaveStatus = (message, type) => {
        setSaveStatus({ message, type });
        setTimeout(() => setSaveStatus({ message: '', type: '' }), 3000);
    };

    const handleSave = async () => {
        setIsSaving(true);
        try {
            const recipesToSave = Object.values(recipes).filter(r => r.name || Object.values(RECIPE_INGREDIENTS_MAP).some(key => r[key]));
            const response = await apiClient.post('/recipes', { terminalId: internalTerminalId, recipes: recipesToSave });
            if (response.data.success) {
                showSaveStatus('Рецепты успешно сохранены!', 'success');
                onSave(); // Вызываем колбэк для обновления initialRecipes в родительском компоненте
            } else {
                 showSaveStatus(response.data.error || 'Ошибка сохранения.', 'error');
            }
        } catch(err) {
            showSaveStatus(err.response?.data?.error || 'Сетевая ошибка.', 'error');
        } finally {
            setIsSaving(false);
        }
    };

    const handleOpenCopyModal = () => {
        setIsCopyModalOpen(true);
    };

    const handleSelectCopyDestination = async (destinationTerminal) => {
        setIsCopyModalOpen(false);
        try {
            const destDetailsRes = await apiClient.get(`/terminals/vendista/${destinationTerminal.id}/details`);
            if (!destDetailsRes.data.success || !destDetailsRes.data.internalId) {
                throw new Error('Не удалось получить внутренний ID целевого терминала.');
            }
            const destinationInternalId = destDetailsRes.data.internalId;

            setConfirmModalState({
                isOpen: true,
                message: `Скопировать рецепты в "${destinationTerminal.comment || `Терминал #${destinationTerminal.id}`}"? Существующие рецепты для тех же кнопок будут перезаписаны.`,
                onConfirm: () => executeCopy(destinationInternalId)
            });
        } catch(err) {
             showSaveStatus(err.response?.data?.error || 'Ошибка получения деталей цели.', 'error');
        }
    };

    const executeCopy = async (destinationInternalId) => {
        setConfirmModalState({ isOpen: false });
        try {
            const res = await apiClient.post('/recipes/copy', {
                sourceTerminalId: internalTerminalId,
                destinationTerminalId: destinationInternalId
            });
            showSaveStatus(res.data.message, res.data.success ? 'success' : 'error');
        } catch (err) {
            showSaveStatus(err.response?.data?.error || 'Ошибка при копировании.', 'error');
        }
    };
    
    const haveRecipesChanged = JSON.stringify(recipes) !== JSON.stringify(initialRecipes);

    return (
        <>
            <ConfirmModal 
                isOpen={confirmModalState.isOpen}
                message={confirmModalState.message}
                onConfirm={confirmModalState.onConfirm}
                onCancel={() => setConfirmModalState({ isOpen: false })}
            />
            {isCopyModalOpen && (
                 <TerminalListModal
                    terminals={allTerminals}
                    onSelect={handleSelectCopyDestination}
                    onClose={() => setIsCopyModalOpen(false)}
                    disabledId={terminal.id}
                    title="Копировать в..."
                />
            )}
            <div className="modal-tab-content recipes-form">
                <p className="helper-text recipes-helper">Укажите названия напитков и расход для автоматического учета остатков.</p>
                <div className="form-footer recipes-footer">
                    <button type="button" className="action-btn" onClick={handleSave} disabled={isSaving || !haveRecipesChanged}>
                        {isSaving ? 'Сохранение...' : 'Сохранить рецепты'}
                    </button>
                    <button type="button" className="action-btn secondary" onClick={handleOpenCopyModal} disabled={isSaving}>
                        Скопировать
                    </button>
                    {saveStatus.message && <span className={`save-status ${saveStatus.type}`}>{saveStatus.message}</span>}
                </div>
                <div className="table-scroll-container">
                    <table className="recipes-table">
                        <thead>
                            <tr>
                                <th>ID</th>
                                <th>Название</th>
                                {Object.keys(RECIPE_INGREDIENTS_MAP).map(ing => <th key={ing}>{ing}</th>)}
                            </tr>
                        </thead>
                        <tbody>
                            {machineItems.length > 0 ? machineItems.map(itemId => (
                                <tr key={itemId}>
                                    <td className="item-id-cell">{itemId}</td>
                                    <td>
                                        <input type="text" placeholder="-" value={recipes[itemId]?.name || ''} 
                                            onChange={e => handleRecipeChange(itemId, 'name', e.target.value)} />
                                    </td>
                                    {Object.entries(RECIPE_INGREDIENTS_MAP).map(([ingName, fieldName]) => (
                                        <td key={ingName}>
                                            <input type="text" inputMode="decimal" placeholder="0" value={recipes[itemId]?.[fieldName] || ''}
                                                onChange={e => handleRecipeChange(itemId, fieldName, e.target.value)} />
                                        </td>
                                    ))}
                                </tr>
                            )) : (
                                <tr><td colSpan={Object.keys(RECIPE_INGREDIENTS_MAP).length + 2}>Нет данных о проданных напитках. Совершите продажу, чтобы кнопки появились.</td></tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </>
    );
}