// frontend/src/components/StandDetail/StandStockTab.js
import React from 'react';
import { ALL_ITEMS } from '../../constants';
import './StandStockTab.css';

const getUnitText = (itemName) => {
    switch (itemName) {
        case 'Кофе':
        case 'Сливки':
        case 'Какао':
        case 'Раф':
            return 'г';
        case 'Вода':
            return 'мл';
        default:
            return 'шт.';
    }
};

const MachineProgressBar = ({ current, max, critical, itemName, onConfigureClick }) => {
    if (max === null || max === undefined || max === 0) {
        return <span className="configure-container-notice" onClick={onConfigureClick}>Заполните контейнер</span>;
    }
    const percentage = (current / max) * 100;
    const criticalPercentage = (critical / max) * 100;
    const unit = getUnitText(itemName);

    let barColorClass = '';
    if (critical > 0) {
        if (current <= critical) {
            barColorClass = 'critical';
        } else if (current <= critical * 2) {
            barColorClass = 'high';
        }
    }

    const isPiece = unit === 'шт.';
    const formattedCurrent = current.toLocaleString('ru-RU', { maximumFractionDigits: isPiece ? 0 : 1 });
    const formattedMax = max.toLocaleString('ru-RU', { maximumFractionDigits: isPiece ? 0 : 1 });

    return (
        <div className="machine-progress-bar-container">
            <div className={`machine-progress-fill ${barColorClass}`} style={{ width: `${Math.min(percentage, 100)}%` }} />
            {critical > 0 && <div className="machine-progress-critical-marker" style={{ left: `${criticalPercentage}%` }} />}
            <span className="machine-progress-text">{formattedCurrent} / {formattedMax} {unit}</span>
        </div>
    );
};

export default function StandStockTab({ details, onConfigureClick }) {
    const inventoryMap = (details.inventory || []).reduce((acc, item) => {
        acc[item.item_name] = acc[item.item_name] || {};
        acc[item.item_name][item.location] = {
            current: parseFloat(item.current_stock || 0),
            max: parseFloat(item.max_stock || 0),
            critical: parseFloat(item.critical_stock || 0),
        };
        return acc;
    }, {});

    const renderRow = (item, extraClass = '') => {
        const standData = inventoryMap[item.name]?.stand;
        const machineData = inventoryMap[item.name]?.machine;
        
        let standStockText = '—';
        if (standData) {
            const value = standData.current;
            if (item.unit === 'г' || item.unit === 'мл') {
                standStockText = `${(value / 1000).toLocaleString('ru-RU', { maximumFractionDigits: 2 })} ${item.unit === 'г' ? 'кг' : 'л'}`;
            } else {
                standStockText = `${value.toLocaleString('ru-RU', { maximumFractionDigits: 0 })} ${item.unit}`;
            }
        }
        
        return (
            <tr key={item.name} className={extraClass}>
                {/* ИСПРАВЛЕНИЕ: Используем короткое имя item.name */}
                <td className="name-col">{item.name}</td>
                <td className="stock-col">{standStockText}</td>
                <td className="machine-col">
                    <MachineProgressBar 
                        current={machineData?.current || 0} 
                        max={machineData?.max} 
                        critical={machineData?.critical || 0} 
                        itemName={item.name}
                        onConfigureClick={onConfigureClick}
                    />
                </td>
            </tr>
        );
    };

    return (
        <div className="modal-tab-content stock-tab-content">
            <div className="table-scroll-container">
                <table className="stock-table-reworked">
                    <colgroup>
                        <col className="name-col-colgroup" />
                        <col className="stock-col-colgroup" />
                        <col className="machine-col-colgroup" />
                    </colgroup>
                    <thead>
                        <tr>
                            <th className="name-col">Товар</th>
                            <th className="stock-col">Стойка</th>
                            <th className="machine-col header-coffeemachine">Кофемашина</th>
                        </tr>
                    </thead>
                    <tbody>
                        {ALL_ITEMS.filter(item => ['Кофе', 'Сливки', 'Какао', 'Раф', 'Вода'].includes(item.name)).map(item => renderRow(item, 'ingredient-row'))}
                        <tr className="table-separator-row"><td colSpan="3"></td></tr>
                        {ALL_ITEMS.filter(item => !['Кофе', 'Сливки', 'Какао', 'Раф', 'Вода'].includes(item.name)).map(item => renderRow(item, 'consumable-row'))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}