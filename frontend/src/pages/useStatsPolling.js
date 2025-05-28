// src/pages/useStatsPolling.js
import { useEffect, useRef, useState, useCallback } from 'react';
import apiClient from '../api';

export function useStatsPolling(apiPeriod) { // apiPeriod is { dateFrom: 'YYYY-MM-DD', dateTo: 'YYYY-MM-DD' }
  const [stats, setStats] = useState({ revenue: 0, salesCount: 0, expensesSum: 0 });
  const [coffeeStats, setCoffeeStats] = useState([]);
  const [statsLoading, setStatsLoading] = useState(true);
  const [coffeeLoading, setCoffeeLoading] = useState(true);
  const [error, setError] = useState('');
  
  const timerRef = useRef(null);
  const initialFetchDoneRef = useRef(false); 

  const fetchAll = useCallback(async (isBackgroundUpdate = false) => {
    const token = localStorage.getItem('app_token'); // Используем 'app_token' как в api.js
    if (!apiPeriod || !apiPeriod.dateFrom || !apiPeriod.dateTo) {
      console.warn('useStatsPolling: apiPeriod is incomplete, skipping fetch.', apiPeriod);
      setStats({ revenue: 0, salesCount: 0, expensesSum: 0 });
      setCoffeeStats([]);
      if (!isBackgroundUpdate) {
          setStatsLoading(false);
          setCoffeeLoading(false);
          setError('Период не задан полностью.');
      }
      return;
    }
    if (!token) {
      console.warn('useStatsPolling: token is missing.');
       if (!isBackgroundUpdate) {
          setStatsLoading(false);
          setCoffeeLoading(false);
          setError('Отсутствует токен авторизации.');
       }
      return;
    }

    if (!isBackgroundUpdate) {
      setStatsLoading(true);
      setCoffeeLoading(true);
      setError('');
    }

    let currentError = '';
    try {
      // dateFrom и dateTo уже должны быть в формате YYYY-MM-DD
      const statsRes = await apiClient.get('/transactions/stats', {
        params: { from: apiPeriod.dateFrom, to: apiPeriod.dateTo } 
      });
      setStats(statsRes.data.stats || { revenue: 0, salesCount: 0, expensesSum: 0 });
    } catch (e) {
      console.error("Error fetching overall stats:", e);
      if (!isBackgroundUpdate) setStats({ revenue: 0, salesCount: 0, expensesSum: 0 });
      currentError += `Ошибка статистики продаж (${e.response?.data?.error || e.message}). `;
    } finally {
      if (!isBackgroundUpdate) setStatsLoading(false);
    }

    try {
      const coffeeRes = await apiClient.get('/transactions/coffee-stats', {
        params: { from: apiPeriod.dateFrom, to: apiPeriod.dateTo }
      });
      setCoffeeStats(coffeeRes.data.stats || []);
    } catch (e) {
      console.error("Error fetching coffee stats:", e);
      if (!isBackgroundUpdate) setCoffeeStats([]);
      currentError += `Ошибка статистики по кофейням (${e.response?.data?.error || e.message}).`;
    } finally {
      if (!isBackgroundUpdate) setCoffeeLoading(false);
    }

    if (currentError.trim()) {
        setError(currentError.trim());
        if (isBackgroundUpdate) {
            console.warn("Фоновое обновление статистики с ошибками:", currentError.trim());
        }
    } else if (!isBackgroundUpdate) { 
        setError('');
    }

  }, [apiPeriod]);

  useEffect(() => {
    initialFetchDoneRef.current = false;
    setStatsLoading(true);
    setCoffeeLoading(true);
    fetchAll(false).then(() => {
      initialFetchDoneRef.current = true;
    });
  }, [fetchAll]); // Убрали apiPeriod отсюда, т.к. fetchAll уже зависит от него и вызовет перезапуск

  useEffect(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
    }
    
    // Получаем токен внутри эффекта, чтобы условие было актуальным
    const currentToken = localStorage.getItem('app_token'); 

    if (currentToken && apiPeriod && apiPeriod.dateFrom && apiPeriod.dateTo && initialFetchDoneRef.current) {
      timerRef.current = setInterval(() => {
        console.log('Polling for stats update...', apiPeriod);
        fetchAll(true); 
      }, 30 * 1000); 
    }

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  // Зависимость от fetchAll и apiPeriod корректна, т.к. они определяют, как и когда должен работать поллинг.
  // currentToken проверяется внутри, поэтому его нет в зависимостях.
  }, [apiPeriod, fetchAll]); 

  return { stats, statsLoading, coffeeStats, coffeeLoading, error };
}