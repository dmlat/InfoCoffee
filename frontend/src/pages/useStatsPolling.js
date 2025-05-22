// src/pages/useStatsPolling.js
import { useEffect, useRef, useState, useCallback } from 'react'; // Added useCallback
import axios from 'axios';

export function useStatsPolling(periodRange) {
  const [stats, setStats] = useState({ revenue: 0, salesCount: 0, expensesSum: 0 });
  const [coffeeStats, setCoffeeStats] = useState([]);
  const [statsLoading, setStatsLoading] = useState(true);
  const [coffeeLoading, setCoffeeLoading] = useState(true);
  const [error, setError] = useState('');
  const timerRef = useRef(null); // Initialize with null
  const token = localStorage.getItem('token');

  const fetchAll = useCallback(async () => {
    if (!periodRange || !periodRange[0] || !periodRange[1]) {
      console.warn('useStatsPolling: periodRange is incomplete, skipping fetch.');
      setStats({ revenue: 0, salesCount: 0, expensesSum: 0 });
      setCoffeeStats([]);
      setStatsLoading(false);
      setCoffeeLoading(false);
      setError('Период не задан полностью для загрузки статистики.');
      return;
    }
    if (!token) {
      console.warn('useStatsPolling: token is missing, skipping fetch.');
      setStats({ revenue: 0, salesCount: 0, expensesSum: 0 });
      setCoffeeStats([]);
      setStatsLoading(false);
      setCoffeeLoading(false);
      setError('Отсутствует токен авторизации для загрузки статистики.');
      return;
    }

    const from = periodRange[0].toISOString();
    const to = periodRange[1].toISOString();
    let currentError = '';

    setStatsLoading(true);
    try {
      const statsRes = await axios.get('/api/transactions/stats', {
        headers: { Authorization: `Bearer ${token}` },
        params: { from, to }
      });
      setStats(statsRes.data.stats || { revenue: 0, salesCount: 0, expensesSum: 0 });
    } catch (e) {
      console.error("Error fetching overall stats:", e);
      setStats({ revenue: 0, salesCount: 0, expensesSum: 0 });
      currentError += 'Ошибка загрузки статистики продаж. ';
    } finally {
      setStatsLoading(false);
    }

    setCoffeeLoading(true);
    try {
      const coffeeRes = await axios.get('/api/transactions/coffee-stats', {
        headers: { Authorization: `Bearer ${token}` },
        params: { from, to }
      });
      setCoffeeStats(coffeeRes.data.stats || []);
    } catch (e) {
      console.error("Error fetching coffee stats:", e);
      setCoffeeStats([]);
      currentError += 'Ошибка загрузки статистики по кофеточкам.';
    } finally {
      setCoffeeLoading(false);
    }
    setError(currentError.trim());
  }, [periodRange, token]); // Dependencies for useCallback

  useEffect(() => {
    fetchAll(); // Initial call

    if (timerRef.current) {
      clearInterval(timerRef.current);
    }
    timerRef.current = setInterval(fetchAll, 30 * 1000); // Poll every 30 seconds

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, [fetchAll]); // Now useEffect depends on the memoized fetchAll

  return { stats, statsLoading, coffeeStats, coffeeLoading, error };
}