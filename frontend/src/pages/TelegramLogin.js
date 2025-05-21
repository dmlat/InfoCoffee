// src/pages/TelegramLogin.js
import React, { useEffect } from 'react';
import axios from 'axios';

export default function TelegramLogin({ setIsAuth }) {
  useEffect(() => {
    // Telegram Web App данные доступны в window.Telegram.WebApp.initDataUnsafe
    if (window.Telegram && window.Telegram.WebApp) {
      const tgUser = window.Telegram.WebApp.initDataUnsafe.user;
      if (tgUser && tgUser.id) {
        // Попроси пользователя ввести свой логин/пароль Vendista
        // или автоматом отправь telegram_id на backend, чтобы связать!
        // Можно сохранить в localStorage telegram_id
        localStorage.setItem('telegram_id', tgUser.id);
        // дальше реализуешь связку после регистрации/логина
      }
    }
  }, []);

  // Верни форму регистрации/логина, как раньше, но можешь теперь после успеха 
  // послать запрос на backend /api/telegram/link с telegram_id + user_id
  return (
    <div>
      {/* Твой компонент логина/регистрации */}
      <h2>Добро пожаловать в Telegram Web App!</h2>
      {/* тут форма логина или кнопка "Войти через Telegram" */}
    </div>
  );
}
