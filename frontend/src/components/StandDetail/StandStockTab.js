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

    const formattedCurrent = current % 1 === 0 ? current : current.toFixed(1);
    const formattedMax = max % 1 === 0 ? max : max.toFixed(1);

    return (
        <div className="machine-progress-bar-container">
            <div className="machine-progress-fill" style={{ width: `${Math.min(percentage, 100)}%` }} />
            {critical > 0 && <div className="machine-progress-critical-marker" style={{ left: `${criticalPercentage}%` }} />}
            <span className="machine-progress-text">{formattedCurrent}/{formattedMax} {unit}</span>
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
        
        const standStockText = standData 
            ? `${standData.current.toLocaleString('ru-RU', { maximumFractionDigits: 2 })} ${item.unit}` 
            : '—';
        
        return (
            <tr key={item.name} className={extraClass}>
                <td>{item.name}</td>
                <td className="stock-cell">{standStockText}</td>
                <td className="machine-cell">
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
                        <col style={{ width: '120px' }} />
                        <col style={{ width: '120px' }} />
                        <col style={{ width: 'auto' }} />
                    </colgroup>
                    <thead>
                        <tr>
                            <th>Товар</th>
                            <th className="text-right">Стойка</th>
                            <th className="header-coffeemachine text-right">Кофемашина</th>
                        </tr>
                    </thead>
                    <tbody>
                        {ALL_ITEMS.filter(item => item.type === 'ingredient' && item.name !== 'Вода').map(item => renderRow(item, 'ingredient-row'))}
                        {renderRow(ALL_ITEMS.find(i => i.name === 'Вода'), 'water-row')}
                        {ALL_ITEMS.filter(item => item.type === 'consumable').map(item => renderRow(item, 'consumable-row'))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}