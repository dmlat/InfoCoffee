// frontend/src/components/StandDetail/StandSettingsTab.js
import React, { useState, useEffect } from 'react';
import apiClient from '../../api';
import { ALL_ITEMS } from '../../constants';
import './StandSettingsTab.css';

export default function StandSettingsTab({ terminal, initialSettings, onSave }) {
    const [settings, setSettings] = useState(initialSettings);
    const [isSaving, setIsSaving] = useState(false);
    const [saveStatus, setSaveStatus] = useState({ message: '', type: '' });

    useEffect(() => {
        setSettings(initialSettings);
    }, [initialSettings]);

    const normalizeNumericInput = (value) => value.replace(/,/g, '.').replace(/[^0-9.]/g, '');

    const handleSettingsChange = (itemName, field, value) => {
        setSettings(prev => ({ ...prev, [itemName]: { ...prev[itemName], [field]: normalizeNumericInput(value) } }));
    };

    const showSaveStatus = (message, type) => {
        setSaveStatus({ message, type });
        setTimeout(() => setSaveStatus({ message: '', type: '' }), 3000);
    };

    const handleSave = async (e) => {
        e.preventDefault();
        setIsSaving(true);
        const inventorySettings = Object.entries(settings).map(([itemName, values]) => {
            // --- ИСПРАВЛЕНИЕ ---
            // Локация теперь всегда 'machine', так как настройки контейнеров относятся к машине для всех товаров.
            return {
                item_name: itemName,
                location: 'machine',
                max_stock: values.max_stock || null,
                critical_stock: values.critical_stock || null
            }
        });

        try {
            const response = await apiClient.post(`/terminals/vendista/${terminal.id}/settings`, { inventorySettings });
            if (response.data.success) {
                showSaveStatus('Настройки сохранены!', 'success');
                onSave();
            } else {
                showSaveStatus(response.data.error || 'Ошибка.', 'error');
            }
        } catch (err) {
            showSaveStatus(err.response?.data?.error || 'Сетевая ошибка.', 'error');
        } finally {
            setIsSaving(false);
        }
    };
    
    const haveSettingsChanged = JSON.stringify(settings) !== JSON.stringify(initialSettings);

    return (
        <form className="modal-tab-content settings-form" onSubmit={handleSave}>
            <p className="helper-text">Задайте максимальный объем контейнеров и критические остатки для уведомлений.</p>
            <div className="table-scroll-container">
                <div className="settings-section">
                    <h4>Контейнеры кофемашины (г / мл / шт)</h4>
                    <div className="setting-item-header">
                        <span/>
                        <span className="label-max">Максимальные</span>
                        <span className="label-crit">Критические</span>
                    </div>
                    {ALL_ITEMS.map(item => (
                        <div className="setting-item" key={item.name}>
                            <label>{item.fullName || item.name}</label>
                            <input type="text" inputMode="decimal" placeholder="Макс." value={settings[item.name]?.max_stock || ''} onChange={e => handleSettingsChange(item.name, 'max_stock', e.target.value)} />
                            <input type="text" inputMode="decimal" placeholder="Крит." value={settings[item.name]?.critical_stock || ''} onChange={e => handleSettingsChange(item.name, 'critical_stock', e.target.value)} />
                        </div>
                    ))}
                </div>
            </div>
            <div className="form-footer">
                 <button type="submit" className="action-btn" disabled={isSaving || !haveSettingsChanged}>
                    {isSaving ? 'Сохранение...' : 'Сохранить настройки'}
                </button>
                {saveStatus.message && <span className={`save-status ${saveStatus.type}`}>{saveStatus.message}</span>}
            </div>
        </form>
    );
}