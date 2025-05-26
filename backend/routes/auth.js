const express = require('express');
const jwt = require('jsonwebtoken');
// const bcrypt = require('bcryptjs'); // Для хэша — если будет нужно
const pool = require('../db');
const axios = require('axios');
const router = express.Router();
const { startImport } = require('../worker/vendista_import_worker');

// --- Регистрация пользователя ---
router.post('/register', async (req, res) => {
    try {
        const { vendista_login, vendista_password, date_install, tax_system, acquiring } = req.body;
        if (!vendista_login || !vendista_password || !date_install)
            return res.status(400).json({ success: false, error: 'Все поля обязательны!' });

        const exist = await pool.query('SELECT * FROM users WHERE vendista_login = $1', [vendista_login]);
        if (exist.rows.length > 0)
            return res.status(400).json({ success: false, error: 'Пользователь уже зарегистрирован!' });

        const tokenResp = await axios.get(`https://api.vendista.ru:99/token`, {
            params: { login: vendista_login, password: vendista_password }
        });
        if (!tokenResp.data.token)
            return res.status(400).json({ success: false, error: 'Vendista логин/пароль невалидны!' });

        await pool.query(
            `INSERT INTO users (vendista_login, vendista_password_hash, setup_date, tax_system, acquiring) VALUES ($1,$2,$3,$4,$5)`,
            [vendista_login, vendista_password, date_install, tax_system, acquiring]
        );
        const userRes = await pool.query('SELECT id FROM users WHERE vendista_login=$1', [vendista_login]);
        const userId = userRes.rows[0].id;

        startImport({
            user_id: userId,
            vendistaLogin: vendista_login,
            vendistaPass: vendista_password,
            first_coffee_date: date_install
        });

        const token = jwt.sign({ userId, vendista_login }, process.env.JWT_SECRET, { expiresIn: '12h' });
        // При регистрации не возвращаем все данные профиля, пользователь должен будет залогиниться
        res.json({ success: true, token, user: { userId, vendista_login } });
    } catch (err) {
        console.error("Ошибка в /api/register:", err);
        res.status(500).json({ success: false, error: 'Ошибка регистрации: ' + err.message });
    }
});

// --- Логин пользователя ---
router.post('/login', async (req, res) => {
    try {
        const { vendista_login, vendista_password } = req.body;
        if (!vendista_login || !vendista_password)
            return res.status(400).json({ success: false, error: 'Требуется Vendista логин и пароль' });

        const userRes = await pool.query(
            'SELECT id, vendista_login AS db_vendista_login, vendista_password_hash, setup_date, tax_system, acquiring FROM users WHERE vendista_login=$1', // Добавил db_vendista_login для ясности
            [vendista_login]
        );
        if (userRes.rows.length === 0)
            return res.status(400).json({ success: false, error: 'Пользователь не найден!' });

        const user = userRes.rows[0];
        if (vendista_password !== user.vendista_password_hash)
            return res.status(400).json({ success: false, error: 'Неверный пароль!' });

        const token = jwt.sign({ userId: user.id, vendista_login: user.db_vendista_login }, process.env.JWT_SECRET, { expiresIn: '12h' });

        const userResponseData = {
            userId: user.id,
            vendista_login: user.db_vendista_login, // Используем логин из БД
            setup_date: user.setup_date,
            tax_system: user.tax_system,
            acquiring: user.acquiring
        };

        console.log('[Backend /api/login] Данные пользователя для отправки:', userResponseData); // Лог для отладки

        res.json({
            success: true,
            token,
            user: userResponseData
        });
    } catch (err) {
        console.error("Ошибка в /api/login:", err);
        res.status(500).json({ success: false, error: 'Ошибка входа: ' + err.message });
    }
});

// --- "Тихое" обновление сессии через Telegram ID ---
router.post('/refresh-session-via-telegram', async (req, res) => {
  const { telegram_id, initData } = req.body; // initData - для возможной будущей валидации

  if (!telegram_id) {
    return res.status(400).json({ success: false, error: 'Отсутствует Telegram ID' });
  }

  // TODO (в будущем): Валидация initData от Telegram на сервере для безопасности
  // Это более сложная тема, требует проверки подписи данных с использованием твоего токена бота
  // Пока для простоты мы будем доверять telegram_id, но для продакшена это нужно усилить.
  // console.log('[refresh-session-via-telegram] Received initData:', initData);

  try {
    const userRes = await pool.query(
      'SELECT id, vendista_login, vendista_password_hash, setup_date, tax_system, acquiring FROM users WHERE telegram_id = $1',
      [telegram_id]
    );

    if (userRes.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Пользователь с таким Telegram ID не найден в нашей системе.' });
    }

    const user = userRes.rows[0];
    const vendistaLogin = user.vendista_login;
    const vendistaPassword = user.vendista_password_hash; // Это должен быть РЕАЛЬНЫЙ пароль Vendista

    if (!vendistaLogin || !vendistaPassword) {
      return res.status(400).json({ success: false, error: 'Учетные данные Vendista для этого пользователя неполные.' });
    }

    // 1. Пытаемся получить токен от API Vendista
    let vendistaApiToken;
    try {
      const tokenResp = await axios.get('https://api.vendista.ru:99/token', {
        params: { login: vendistaLogin, password: vendistaPassword },
        timeout: 10000 // Таймаут
      });
      vendistaApiToken = tokenResp.data.token;
      if (!vendistaApiToken) {
        // Пароль Vendista в нашей БД мог устареть
        console.warn(`[refresh-session-via-telegram] Не удалось получить токен Vendista для пользователя ${user.id} (Telegram ID: ${telegram_id}). Возможно, учетные данные Vendista устарели.`);
        return res.status(401).json({ success: false, error: 'Не удалось подтвердить учетные данные Vendista. Возможно, они изменились.' });
      }
    } catch (vendistaError) {
      console.error(`[refresh-session-via-telegram] Ошибка при запросе токена Vendista для пользователя ${user.id}:`, vendistaError.message);
      return res.status(503).json({ success: false, error: 'Сервис Vendista временно недоступен или произошла ошибка при проверке учетных данных.' });
    }

    // 2. Если токен Vendista получен, генерируем новый JWT-токен нашего приложения
    const newAppToken = jwt.sign(
      { userId: user.id, vendista_login: user.vendista_login }, // Полезная нагрузка токена
      process.env.JWT_SECRET,
      { expiresIn: '12h' }
    );

    // 3. Возвращаем новый JWT и основные данные пользователя (аналогично /login)
    const userResponseData = {
        userId: user.id,
        vendista_login: user.vendista_login,
        setup_date: user.setup_date,     // Эти поля нужно будет также выбрать в SQL-запросе выше
        tax_system: user.tax_system,   // или передать в JWT, если они не меняются часто
        acquiring: user.acquiring      // и не нужны для каждой сессии сразу
    };

    console.log(`[refresh-session-via-telegram] Успешно обновлена сессия для пользователя ${user.id} (Telegram ID: ${telegram_id})`);
    res.json({
      success: true,
      token: newAppToken,
      user: userResponseData // Отправляем те же данные, что и при обычном логине
    });

  } catch (err) {
    console.error("Ошибка в /api/auth/refresh-session-via-telegram:", err);
    res.status(500).json({ success: false, error: 'Внутренняя ошибка сервера при обновлении сессии.' });
  }
});

module.exports = router;