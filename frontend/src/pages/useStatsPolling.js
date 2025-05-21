import { useEffect, useRef, useState } from 'react';
import axios from 'axios';

export function useStatsPolling(periodRange) {
  const [stats, setStats] = useState({ revenue: 0, salesCount: 0, expensesSum: 0 });
  const [coffeeStats, setCoffeeStats] = useState([]);
  const [statsLoading, setStatsLoading] = useState(true);
  const [coffeeLoading, setCoffeeLoading] = useState(true);
  const [error, setError] = useState('');
  const timerRef = useRef();
  const token = localStorage.getItem('token');

  const fetchAll = async () => {
    if (!periodRange[0] || !periodRange[1]) return;
    const from = periodRange[0].toISOString();
    const to = periodRange[1].toISOString();

    try {
      setStatsLoading(true);
      setError('');
      const statsRes = await axios.get('/api/transactions/stats', {
        headers: { Authorization: `Bearer ${token}` },
        params: { from, to }
      });
      setStats(statsRes.data.stats);
    } catch (e) {
      setStats({ revenue: 0, salesCount: 0, expensesSum: 0 });
      setError('Ошибка загрузки статистики продаж');
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
    } catch (e) {
      setCoffeeStats([]);
      setError('Ошибка загрузки статистики по кофеточкам');
    } finally {
      setCoffeeLoading(false);
    }
  };

  useEffect(() => {
    fetchAll();
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(fetchAll, 30 * 1000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
    // eslint-disable-next-line
  }, [periodRange, token]);

  return { stats, statsLoading, coffeeStats, coffeeLoading, error };
}
