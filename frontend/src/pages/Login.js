import React, { useState } from 'react';
import axios from 'axios';
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
      const res = await axios.post('http://localhost:3001/api/login', {
        vendista_login: vendistaLogin,
        vendista_password: vendistaPass,
      });
      localStorage.setItem('token', res.data.token);
      localStorage.setItem('vendista_login', vendistaLogin); // сохраняем логин для профиля
      setIsAuth(true);
      navigate('/dashboard');
    } catch (err) {
      setError(err.response?.data?.error || 'Ошибка входа');
    }
  };

  return (
    <div className="container">
      <h2 style={{marginBottom: 16}}>Вход</h2>
      <form onSubmit={handleLogin}>
        <input
          id="login-vendista"
          name="vendista_login"
          value={vendistaLogin}
          onChange={e => setVendistaLogin(e.target.value)}
          placeholder="Vendista логин"
          type="text"
          required
          style={{width: '100%'}}
          autoComplete="username"
        />
        <input
          id="login-vendista-password"
          name="vendista_password"
          value={vendistaPass}
          onChange={e => setVendistaPass(e.target.value)}
          placeholder="Vendista пароль"
          type="password"
          required
          style={{width: '100%'}}
          autoComplete="current-password"
        />
        <button type="submit" style={{width: '100%', marginBottom: 8}}>Войти</button>
        <button type="button" onClick={() => navigate('/register')} style={{background: '#282c34', color: '#3e67e0', width: '100%'}}>Регистрация</button>
        {error && <div style={{color: 'salmon', marginTop: 8}}>{error}</div>}
      </form>
    </div>
  );
}
