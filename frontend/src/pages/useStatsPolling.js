// src/pages/useStatsPolling.js
import { useEffect, useRef, useState, useCallback } from 'react';
import axios from 'axios';

export function useStatsPolling(periodRange) {
  const [stats, setStats] = useState({ revenue: 0, salesCount: 0, expensesSum: 0 });
  const [coffeeStats, setCoffeeStats] = useState([]);

  // Изначально ставим true, чтобы при первой загрузке показать индикаторы
  const [statsLoading, setStatsLoading] = useState(true);
  const [coffeeLoading, setCoffeeLoading] = useState(true);

  const [error, setError] = useState('');
  const timerRef = useRef(null);
  const token = localStorage.getItem('token');

  // Используем useRef для отслеживания, это первичная загрузка для текущего periodRange или нет
  // Он будет сбрасываться при изменении periodRange
  const initialFetchDoneRef = useRef(false);

  const fetchAll = useCallback(async (isBackgroundUpdate = false) => {
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

    // Устанавливаем loading в true только если это не фоновое обновление (т.е. первая загрузка для диапазона)
    if (!isBackgroundUpdate) {
      setStatsLoading(true);
      setCoffeeLoading(true);
      setError(''); // Сбрасываем предыдущие ошибки при новой "полной" загрузке
    }

    try {
      const statsRes = await axios.get('/api/transactions/stats', {
        headers: { Authorization: `Bearer ${token}` },
        params: { from, to }
      });
      setStats(statsRes.data.stats || { revenue: 0, salesCount: 0, expensesSum: 0 });
    } catch (e) {
      console.error("Error fetching overall stats:", e);
      // При ошибке не сбрасываем старые данные, если это фоновое обновление
      if (!isBackgroundUpdate) {
        setStats({ revenue: 0, salesCount: 0, expensesSum: 0 });
      }
      currentError += `Ошибка загрузки статистики продаж (${e.message}). `;
    } finally {
      if (!isBackgroundUpdate) { // Устанавливаем false только после нефоновой загрузки
        setStatsLoading(false);
      }
    }

    try {
      const coffeeRes = await axios.get('/api/transactions/coffee-stats', {
        headers: { Authorization: `Bearer ${token}` },
        params: { from, to }
      });
      setCoffeeStats(coffeeRes.data.stats || []);
    } catch (e) {
      console.error("Error fetching coffee stats:", e);
      if (!isBackgroundUpdate) {
        setCoffeeStats([]);
      }
      currentError += `Ошибка загрузки статистики по кофеточкам (${e.message}).`;
    } finally {
      if (!isBackgroundUpdate) {
        setCoffeeLoading(false);
      }
    }

    // Если были ошибки во время фонового обновления, можно их показать
    // или просто залогировать, чтобы не беспокоить пользователя постоянными сообщениями
    if (currentError.trim() && isBackgroundUpdate) {
        console.warn("Фоновое обновление статистики завершилось с ошибками:", currentError.trim());
        // Можно установить setError(currentError.trim()); если хочешь, чтобы пользователь видел эти ошибки
        // но это может быть навязчиво при каждом интервале.
    } else {
        setError(currentError.trim());
    }

  }, [periodRange, token]);

  // Эффект для сброса initialFetchDoneRef при изменении periodRange
  // и для начальной загрузки
  useEffect(() => {
    initialFetchDoneRef.current = false; // Сбрасываем флаг при смене диапазона

    // При монтировании или смене periodRange, делаем "полную" загрузку (с индикаторами)
    setStatsLoading(true); 
    setCoffeeLoading(true);
    fetchAll(false).then(() => { // false означает не фоновое обновление
        initialFetchDoneRef.current = true; // Отмечаем, что начальная загрузка для этого диапазона завершена
    });
  }, [fetchAll, periodRange]); // Зависимость от periodRange важна для перезапуска при смене дат

  // Эффект для настройки интервального поллинга
  useEffect(() => {
    // Убедимся, что поллинг запускается только после первой загрузки
    if (!initialFetchDoneRef.current) {
        // Если initialFetchDoneRef все еще false, значит, первая загрузка еще не завершилась,
        // или fetchAll не был вызван из предыдущего useEffect.
        // Это состояние обычно временное. Можно дождаться, пока initialFetchDoneRef.current станет true.
        // Но логика выше (fetchAll(false).then(...)) должна это покрыть.
    }

    if (timerRef.current) {
      clearInterval(timerRef.current);
    }
    // Запускаем поллинг только если есть токен и валидный диапазон
    if (token && periodRange && periodRange[0] && periodRange[1]) {
        timerRef.current = setInterval(() => {
            console.log('Polling for stats update...');
            fetchAll(true); // true означает фоновое обновление без индикаторов загрузки
        }, 30 * 1000); // Poll every 30 seconds
    }

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, [token, periodRange, fetchAll]); // Добавляем token и periodRange, чтобы перезапускать таймер при их изменении

  return { stats, statsLoading, coffeeStats, coffeeLoading, error };
}