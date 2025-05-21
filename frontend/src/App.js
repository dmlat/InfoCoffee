import React, { useEffect, useState } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Login from './pages/Login';
import Register from './pages/Register';
import Dashboard from './pages/Dashboard';

function App() {
  // Сделаем состояние для isAuth
  const [isAuth, setIsAuth] = useState(!!localStorage.getItem('token'));

  // Слушаем изменения токена
  useEffect(() => {
    const onStorage = () => setIsAuth(!!localStorage.getItem('token'));
    window.addEventListener('storage', onStorage);
    // Поддержка внутри вкладки — реакция на set/remove
    const _setItem = localStorage.setItem;
    localStorage.setItem = function() {
      _setItem.apply(this, arguments);
      onStorage();
    };
    const _removeItem = localStorage.removeItem;
    localStorage.removeItem = function() {
      _removeItem.apply(this, arguments);
      onStorage();
    };
    return () => {
      window.removeEventListener('storage', onStorage);
      localStorage.setItem = _setItem;
      localStorage.removeItem = _removeItem;
    };
  }, []);

  return (
    <Router>
      <Routes>
        <Route path="/login" element={<Login setIsAuth={setIsAuth} />} />
        <Route path="/register" element={<Register />} />
        <Route path="/dashboard" element={isAuth ? <Dashboard /> : <Navigate to="/login" />} />
        <Route path="*" element={<Navigate to={isAuth ? "/dashboard" : "/login"} />} />
      </Routes>
    </Router>
  );
}

export default App;
