// frontend/src/components/StandDetail/StandNavigator.js
import React from 'react';
import './StandNavigator.css';

export default function StandNavigator({ terminal, allTerminals, onTerminalChange }) {

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

    const isOnline = (terminal.last_hour_online || 0) > 0;

    return (
        <div className="stand-navigator">
            <button className="nav-arrow" onClick={() => handleTerminalSwitch(-1)}>&lt;</button>
            <div className="nav-terminal-name">
                <span className={`status-indicator ${isOnline ? 'online' : 'offline'}`}></span>
                <span>{terminal.comment || `Терминал #${terminal.id}`}</span>
            </div>
            <button className="nav-arrow" onClick={() => handleTerminalSwitch(1)}>&gt;</button>
        </div>
    );
}