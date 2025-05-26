// frontend/src/pages/Login.js
import React, { useState } from 'react';
import apiClient from '../api'; // Путь к api.js
import { useNavigate } from 'react-router-dom';

export default function Login({ setIsAuth }) {
  const [vendistaLogin, setVendistaLogin] = useState('');
  const [vendistaPass, setVendistaPass] = useState('');
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    try {
      localStorage.clear();
      const res = await apiClient.post('/login', { // '/api/' уже в baseURL
        vendista_login: vendistaLogin,
        vendista_password: vendistaPass,
      });

      // console.log('Ответ от /api/login на фронтенде:', res.data); // Оставим для отладки, если нужно
      // if (res.data.user) {
      //     console.log('Объект user из ответа на фронтенде:', res.data.user);
      // }

      localStorage.setItem('token', res.data.token);
      if (res.data.user) {
        localStorage.setItem('vendista_login', res.data.user.vendista_login);
        localStorage.setItem('userId', String(res.data.user.userId));
        localStorage.setItem('setup_date', res.data.user.setup_date || '');
        localStorage.setItem('tax_system', res.data.user.tax_system || '');
        localStorage.setItem('acquiring_rate', String(res.data.user.acquiring) || '0');
      }

      setIsAuth(true);
      navigate('/dashboard');
    } catch (err) {
      setError(err.response?.data?.error || 'Ошибка входа');
    }
  };

  return (
    <div className="auth-container"> {/* Используем новый класс */}
      <div className="auth-form-wrapper"> {/* Используем новый класс */}
        <h2>Вход в MyCoffeeAnalytics</h2>
        <form onSubmit={handleLogin}>
          <input
            id="login-vendista"
            name="vendista_login"
            value={vendistaLogin}
            onChange={e => setVendistaLogin(e.target.value)}
            placeholder="Логин Vendista"
            type="text"
            required
            autoComplete="username"
          />
          <input
            id="login-vendista-password"
            name="vendista_password"
            value={vendistaPass}
            onChange={e => setVendistaPass(e.target.value)}
            placeholder="Пароль Vendista"
            type="password"
            required
            autoComplete="current-password"
          />
          <button type="submit" className="auth-button-primary">Войти</button> {/* Используем новый класс */}
          <button
            type="button"
            onClick={() => navigate('/register')}
            className="auth-button-secondary" /* Используем новый класс */
          >
            Регистрация
          </button>
          {error && <div className="auth-error">{error}</div>} {/* Используем новый класс */}
        </form>
      </div>
    </div>
  );
}