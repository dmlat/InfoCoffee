// frontend/src/components/StandDetail/StandNavigator.js
import React from 'react';
import './StandNavigator.css';

export default function StandNavigator({ terminal, allTerminals, onTerminalChange, onNameClick }) {

    const handleTerminalSwitch = (direction) => {
        const currentIndex = allTerminals.findIndex(t => t.id === terminal.id);
        if (currentIndex === -1) return;

        let nextIndex = currentIndex + direction;
        if (nextIndex < 0) {
            nextIndex = allTerminals.length - 1;
        } else if (nextIndex >= allTerminals.length) {
            nextIndex = 0;
        }
        
        const nextTerminal = allTerminals[nextIndex];
        if (nextTerminal) {
            onTerminalChange(nextTerminal);
        }
    };

    return (
        <div className="stand-navigator">
            <button className="nav-arrow" onClick={() => handleTerminalSwitch(-1)}>&lt;</button>
            <div className="nav-separator"></div>
            <div className="nav-terminal-name" onClick={onNameClick}>
                {onNameClick && <span className="nav-list-icon">☰</span>}
                <span>{terminal.comment || `Терминал #${terminal.id}`}</span>
            </div>
            <div className="nav-separator"></div>
            <button className="nav-arrow" onClick={() => handleTerminalSwitch(1)}>&gt;</button>
        </div>
    );
}