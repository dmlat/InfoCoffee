import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { initDevTelegram } from '../utils/dev';
import { useAuth } from '../App';
import './DevEntryPage.css';

const DevEntryPage = () => {
  const navigate = useNavigate();
  const { reAuthenticate, authStatus } = useAuth();

  useEffect(() => {
    if (authStatus === 'authenticated') {
      navigate('/');
    }
  }, [authStatus, navigate]);

  const handleRoleSelect = async (role) => {
    try {
      console.log(`[DevEntry] Logging in as ${role}...`);
      
      const url = new URL(window.location);
      url.searchParams.set('role', role);
      window.history.pushState({}, '', url);

      await initDevTelegram();
      await reAuthenticate();
      
    } catch (error) {
      console.error('Error setting up dev environment:', error);
      alert('Ошибка при настройке среды разработки. Проверьте консоль для подробностей.');
    }
  };

  return (
    <div className="dev-entry-container">
      <div className="dev-entry-card">
        <h1 className="dev-entry-title">Панель разработчика</h1>
        <p className="dev-entry-description">
          Выберите роль для эмуляции входа в приложение. Это позволит вам тестировать функционал от имени разных пользователей.
        </p>
        <div className="dev-entry-actions">
          <button onClick={() => handleRoleSelect('owner')} className="dev-entry-button owner">
            Войти как Владелец
          </button>
          <button onClick={() => handleRoleSelect('admin')} className="dev-entry-button admin">
            Войти как Администратор
          </button>
          <button onClick={() => handleRoleSelect('service')} className="dev-entry-button service">
            Войти как Техник
          </button>
        </div>
        <p className="dev-entry-note">
          При первом входе под ролью "Владелец" будет создан тестовый пользователь и его данные.
        </p>
      </div>
    </div>
  );
};

export default DevEntryPage; 