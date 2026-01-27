// src/pages/useStatsPolling.js
import { useEffect, useRef, useState, useCallback } from 'react';
import apiClient from '../api';

export default function useStatsPolling(apiPeriod, token) { // token уже добавлен
  const [stats, setStats] = useState({ revenue: 0, salesCount: 0, expensesSum: 0 });
  const [coffeeStats, setCoffeeStats] = useState([]);
  const [drinkStats, setDrinkStats] = useState([]);
  const [statsLoading, setStatsLoading] = useState(true);
  const [coffeeLoading, setCoffeeLoading] = useState(true);
  const [drinkLoading, setDrinkLoading] = useState(true);
  const [error, setError] = useState('');
  
  const timerRef = useRef(null);
  const initialFetchDoneRef = useRef(false); 

  const fetchAll = useCallback(async (isBackgroundUpdate = false) => {
    if (!apiPeriod || !apiPeriod.dateFrom || !apiPeriod.dateTo) {
      setStats({ revenue: 0, salesCount: 0, expensesSum: 0 });
      setCoffeeStats([]);
      if (!isBackgroundUpdate) {
          setStatsLoading(false);
          setCoffeeLoading(false);
          setDrinkLoading(false);
          setError('Период не задан полностью.');
      }
      return;
    }
    if (!token) {
      if (!isBackgroundUpdate) {
          setStatsLoading(false);
          setCoffeeLoading(false);
          setDrinkLoading(false);
          setError('Отсутствует токен авторизации.');
       }
      return;
    }

    if (!isBackgroundUpdate) {
      setStatsLoading(true);
      setCoffeeLoading(true);
      setDrinkLoading(true);
      setError('');
    }

    let currentError = '';
    try {
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

    try {
      const drinkRes = await apiClient.get('/transactions/drink-stats', {
        params: { from: apiPeriod.dateFrom, to: apiPeriod.dateTo }
      });
      setDrinkStats(drinkRes.data.stats || []);
    } catch (e) {
      console.error("Error fetching drink stats:", e);
      if (!isBackgroundUpdate) setDrinkStats([]);
      currentError += `Ошибка статистики по напиткам (${e.response?.data?.error || e.message}).`;
    } finally {
      if (!isBackgroundUpdate) setDrinkLoading(false);
    }

    if (currentError.trim()) {
        setError(currentError.trim());
    } else if (!isBackgroundUpdate) { 
        setError('');
    }

  }, [apiPeriod, token]); // <--- ИСПРАВЛЕНИЕ: Добавляем token в массив зависимостей

  useEffect(() => {
    initialFetchDoneRef.current = false;
    setStatsLoading(true);
    setCoffeeLoading(true);
    setDrinkLoading(true);
    fetchAll(false).then(() => {
      initialFetchDoneRef.current = true;
    });
  }, [fetchAll]);

  useEffect(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
    }
    
    // <--- ИСПРАВЛЕНИЕ: Используем token из пропсов, а не из localStorage
    if (token && apiPeriod && apiPeriod.dateFrom && apiPeriod.dateTo && initialFetchDoneRef.current) {
      timerRef.current = setInterval(() => {
        fetchAll(true); 
      }, 30 * 1000); 
    }

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, [apiPeriod, fetchAll, token]); // <--- ИСПРАВЛЕНИЕ: Добавляем token в массив зависимостей

  return { stats, statsLoading, coffeeStats, coffeeLoading, drinkStats, drinkLoading, error };
}