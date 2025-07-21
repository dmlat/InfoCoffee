// frontend/src/components/StandDetail/StandNavigator.js
import React from 'react';
import './StandNavigator.css';

export default function StandNavigator({ terminal, allTerminals, onTerminalChange, onNameClick }) {
    // console.log('[StandNavigator] Props:', { terminal, allTerminals });

    const handleTerminalSwitch = (direction) => {
        if (!terminal || !allTerminals || allTerminals.length === 0) return;

        const currentIndex = allTerminals.findIndex(t => t.id === terminal.id);
        if (currentIndex === -1) {
            // console.log('[StandNavigator] Current terminal not in list, selecting first.');
            onTerminalChange(allTerminals[0]);
            return;
        };

        let nextIndex = currentIndex + direction;
        if (nextIndex < 0) {
            nextIndex = allTerminals.length - 1;
        } else if (nextIndex >= allTerminals.length) {
            nextIndex = 0;
        }
        
        const nextTerminal = allTerminals[nextIndex];
        if (nextTerminal) {
            // console.log(`[StandNavigator] Switching to terminal:`, nextTerminal);
            onTerminalChange(nextTerminal);
        }
    };

    return (
        <div className="stand-navigator">
            <button className="nav-arrow" onClick={() => handleTerminalSwitch(-1)} disabled={!terminal || !allTerminals || allTerminals.length < 2}>&lt;</button>
            <div className="nav-separator"></div>
            <button className="nav-terminal-name" onClick={onNameClick}>
                {onNameClick && <span className="nav-list-icon">☰</span>}
                {terminal ? 
                    (<span>{terminal.name || `Терминал #${terminal.id}`}</span>) :
                    (<span className="nav-placeholder">Выберите стойку</span>)
                }
            </button>
            <div className="nav-separator"></div>
            <button className="nav-arrow" onClick={() => handleTerminalSwitch(1)} disabled={!terminal || !allTerminals || allTerminals.length < 2}>&gt;</button>
        </div>
    );
}