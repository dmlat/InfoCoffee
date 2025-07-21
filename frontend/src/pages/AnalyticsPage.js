// frontend/src/pages/AnalyticsPage.js
import React from 'react';

export default function AnalyticsPage({ user }) {
  return (
    <div className="page-container" style={{flexDirection: 'column'}}>
      <div className="main-content-area" style={{width: '100%'}}>
        <div style={{ padding: 20, background: '#23272f', borderRadius: '12px', color: '#eee', fontSize: '1.1em' }}>
          <h2>Аналитика</h2>
          <p><i>Страница в разработке.</i></p>
          <p>Здесь будут отображаться аналитические данные и графики.</p>
        </div>
      </div>
    </div>
  );
}