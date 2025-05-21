import React from 'react';

export default function Table({ columns, data }) {
  return (
    <div style={{
      overflowX: 'auto', borderRadius: 10, background: '#23272f', marginTop: 18,
      boxShadow: '0 2px 8px rgba(0,0,0,0.08)'
    }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', color: '#fff' }}>
        <thead>
          <tr>
            {columns.map(col => (
              <th key={col.accessor}
                  style={{padding: 10, borderBottom: '1px solid #2b303a', textAlign: 'left', fontWeight: 500, fontSize: 15}}>
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.length === 0 &&
            <tr>
              <td colSpan={columns.length} style={{padding: 18, color: '#777'}}>Нет данных</td>
            </tr>
          }
          {data.map((row, i) => (
            <tr key={i} style={{background: i % 2 === 1 ? '#282c34' : 'transparent'}}>
              {columns.map(col => (
                <td key={col.accessor} style={{padding: 10, fontSize: 15, borderBottom: '1px solid #2b303a'}}>
                  {row[col.accessor]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
