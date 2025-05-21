import React from 'react';
import { useStatsPolling } from './useStatsPolling';

const cellLeft = { padding: '7px 12px', fontWeight: 500, textAlign: 'left', border: 'none', background: 'none' };
const cellRight = { padding: '7px 12px', textAlign: 'right', border: 'none', background: 'none' };

// Пропсы: periodRange, periods, period, setPeriod, fromDate, toDate, setFromDate, setToDate
export default function FinancesPage({
  periodRange,
  periods,
  period,
  setPeriod,
  fromDate,
  toDate,
  setFromDate,
  setToDate
}) {
  const { stats, statsLoading, coffeeStats, coffeeLoading } = useStatsPolling(periodRange);

  const revenue = stats.revenue || 0;
  const salesCount = stats.salesCount || 0;
  const expensesSum = stats.expensesSum || 0;
  const taxes = +(revenue * 0.06).toFixed(2);
  const acquiring = +(revenue * 0.016).toFixed(2);
  const netProfit = +(revenue - expensesSum - taxes - acquiring).toFixed(2);
  const margin = revenue ? (netProfit / revenue * 100).toFixed(1) : 0;

  return (
    <div style={{ display: 'flex', gap: 32, alignItems: 'flex-start', maxWidth: 980, margin: '0 auto' }}>
      {/* Левая часть — таблица показателей */}
      <div style={{ flex: 2, minWidth: 300 }}>
        <div style={{ fontSize: 22, fontWeight: 600, marginBottom: 18, color: '#eee' }}>Финансовые показатели</div>
        <div style={{ marginBottom: 18, display: 'flex', gap: 18, alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 2 }}>НАЧАЛО ПЕРИОДА</div>
            <input
              type="date"
              value={fromDate}
              disabled={period.label !== 'ВАШ ПЕРИОД'}
              onChange={e => setFromDate(e.target.value)}
              style={{
                padding: 8, borderRadius: 8, background: period.label === 'ВАШ ПЕРИОД' ? '#23272f' : '#1a1c22',
                color: '#fff', border: '1px solid #394063', width: 120, opacity: period.label === 'ВАШ ПЕРИОД' ? 1 : 0.5
              }}
            />
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 2 }}>КОНЕЦ ПЕРИОДА</div>
            <input
              type="date"
              value={toDate}
              disabled={period.label !== 'ВАШ ПЕРИОД'}
              onChange={e => setToDate(e.target.value)}
              style={{
                padding: 8, borderRadius: 8, background: period.label === 'ВАШ ПЕРИОД' ? '#23272f' : '#1a1c22',
                color: '#fff', border: '1px solid #394063', width: 120, opacity: period.label === 'ВАШ ПЕРИОД' ? 1 : 0.5
              }}
            />
          </div>
        </div>
        <table style={{
          width: '100%',
          borderCollapse: 'collapse',
          background: '#23272f',
          borderRadius: 14,
          overflow: 'hidden',
          fontSize: 17,
          marginBottom: 18
        }}>
          <tbody>
            {statsLoading ? (
              <tr>
                <td style={{ ...cellLeft, color: '#888', fontStyle: 'italic' }} colSpan={2}>Загрузка показателей...</td>
              </tr>
            ) : (
              <>
                <tr><td style={cellLeft}>Продажи</td>      <td style={cellRight}>{salesCount}</td></tr>
                <tr><td style={cellLeft}>Выручка</td>      <td style={{ ...cellRight, color: '#ffb300' }}>{revenue.toLocaleString('ru-RU')} ₽</td></tr>
                <tr><td style={cellLeft}>Расходы</td>      <td style={{ ...cellRight, color: '#c6c6c6' }}>{expensesSum.toLocaleString('ru-RU')} ₽</td></tr>
                <tr><td style={cellLeft}>Налоги</td>       <td style={{ ...cellRight, color: '#9bcaff' }}>{taxes.toLocaleString('ru-RU')} ₽</td></tr>
                <tr><td style={cellLeft}>Эквайринг</td>    <td style={{ ...cellRight, color: '#e2aaff' }}>{acquiring.toLocaleString('ru-RU')} ₽</td></tr>
                <tr style={{ background: '#3e67e0', color: '#fff' }}>
                  <td style={{ ...cellLeft, fontWeight: 700 }}>Прибыль</td>
                  <td style={{ ...cellRight, fontWeight: 700 }}>{netProfit.toLocaleString('ru-RU')} ₽</td>
                </tr>
                <tr>
                  <td style={cellLeft}>Маржинальность</td>
                  <td style={cellRight}>{margin}%</td>
                </tr>
              </>
            )}
          </tbody>
        </table>

        {/* Статистика кофеен внизу */}
        <div style={{ fontSize: 20, fontWeight: 600, color: '#4eb4e7', marginBottom: 8, marginTop: 20 }}>Статистика кофеен</div>
        <table style={{
          width: '100%',
          borderCollapse: 'collapse',
          background: '#23272f',
          borderRadius: 12,
          overflow: 'hidden'
        }}>
          <thead>
            <tr style={{ background: '#1f2330', color: '#8ae6ff' }}>
              <th style={{ textAlign: 'left', padding: '8px 12px' }}>Кофеточка</th>
              <th style={{ textAlign: 'right', padding: '8px 12px' }}>Выручка</th>
              <th style={{ textAlign: 'right', padding: '8px 12px' }}>Продажи</th>
            </tr>
          </thead>
          <tbody>
            {coffeeLoading ? (
              <tr>
                <td colSpan={3} style={{ color: '#888', padding: 20, textAlign: 'center' }}>Загрузка...</td>
              </tr>
            ) : coffeeStats.length === 0 ? (
              <tr>
                <td colSpan={3} style={{ color: '#888', padding: 20, textAlign: 'center' }}>Нет данных за период</td>
              </tr>
            ) : (
              coffeeStats.map(row => (
                <tr key={row.coffee_shop_id} style={{ background: '#23273a', borderBottom: '1px solid #303548' }}>
                  <td style={{ textAlign: 'left', padding: '8px 12px' }}>{row.coffee_shop_id}</td>
                  <td style={{ textAlign: 'right', padding: '8px 12px' }}>{row.revenue.toLocaleString('ru-RU')} ₽</td>
                  <td style={{ textAlign: 'right', padding: '8px 12px' }}>{row.sales_count}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Правая часть — Кнопки ПЕРИОДОВ вертикально */}
      <div style={{ flex: 1, minWidth: 220 }}>
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          width: '100%'
        }}>
          {periods.map(p => (
            <button
              key={p.label}
              className={period.label === p.label ? 'period-btn active' : 'period-btn'}
              style={{
                padding: '11px 0',
                fontWeight: 500,
                background: period.label === p.label ? '#3e67e0' : '#23272f',
                color: period.label === p.label ? '#fff' : '#c0d7fb',
                border: period.label === p.label ? '2px solid #6e9cf7' : '1px solid #323954',
                borderRadius: 10,
                cursor: 'pointer'
              }}
              onClick={() => setPeriod(p)}
            >{p.label}</button>
          ))}
        </div>
      </div>
    </div>
  );
}
