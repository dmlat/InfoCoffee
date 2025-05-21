// src/hooks/useStatsPolling.js
import { useEffect, useRef, useState } from 'react';
import axios from 'axios';

export function useStatsPolling(periodRange) {
  const [stats, setStats] = useState({ revenue: 0, salesCount: 0, expensesSum: 0 });
  const [coffeeStats, setCoffeeStats] = useState([]);
  const [statsLoading, setStatsLoading] = useState(true);
  const [coffeeLoading, setCoffeeLoading] = useState(true);
  const timerRef = useRef();
  const token = localStorage.getItem('token');

  // Общая функция обновления
  const fetchAll = async () => {
    if (!periodRange[0] || !periodRange[1]) return;
    const from = periodRange[0].toISOString();
    const to = periodRange[1].toISOString();

    try {
      setStatsLoading(true);
      const statsRes = await axios.get('/api/transactions/stats', {
        headers: { Authorization: `Bearer ${token}` },
        params: { from, to }
      });
      setStats(statsRes.data.stats);
    } catch {
      setStats({ revenue: 0, salesCount: 0, expensesSum: 0 });
    } finally {
      setStatsLoading(false);
    }

    try {
      setCoffeeLoading(true);
      const coffeeRes = await axios.get('/api/transactions/coffee-stats', {
        headers: { Authorization: `Bearer ${token}` },
        params: { from, to }
      });
      setCoffeeStats(coffeeRes.data.stats || []);
    } catch {
      setCoffeeStats([]);
    } finally {
      setCoffeeLoading(false);
    }
  };

  useEffect(() => {
    fetchAll();
    // Очистка и запуск интервала
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(fetchAll, 30 * 1000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
    // eslint-disable-next-line
  }, [periodRange, token]);

  return { stats, statsLoading, coffeeStats, coffeeLoading };
}
