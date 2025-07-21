import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css'; // Главный файл стилей
import App from './App';
import reportWebVitals from './reportWebVitals';
import { initDevTelegram } from './utils/dev';

// The first call was redundant and is now removed.
// The async call before rendering is the correct way.

// Код для отмены регистрации Service Worker остаётся без изменений
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then(function(registrations) {
    if (registrations && registrations.length > 0) {
      console.log('Найдены активные Service Worker-ы. Попытка отмены регистрации...');
      for (let registration of registrations) {
        registration.unregister()
          .then(function(isUnregistered) {
            if (isUnregistered) {
              console.log('Service Worker успешно отменен:', registration.scope);
              if (!localStorage.getItem('sw_unregistered_once')) {
                localStorage.setItem('sw_unregistered_once', 'true');
                window.location.reload();
              }
            } else {
              console.warn('Не удалось отменить регистрацию Service Worker:', registration.scope);
            }
          })
          .catch(function(error) {
            console.error('Ошибка при отмене регистрации Service Worker:', registration.scope, error);
          });
      }
    } else {
      console.log('Активные Service Worker-ы не найдены.');
    }
  }).catch(function(error) {
    console.error('Ошибка при получении регистраций Service Worker:', error);
  });
} else {
  console.log('Service Worker API не поддерживается в этом браузере.');
}

const root = ReactDOM.createRoot(document.getElementById('root'));

// В режиме разработки сначала выполняем асинхронную инициализацию
// моков для Telegram, и только потом рендерим приложение.
if (process.env.NODE_ENV === 'development') {
  initDevTelegram().then(() => {
    root.render(
      <React.StrictMode>
        <App />
      </React.StrictMode>
    );
  });
} else {
  // В продакшене просто рендерим приложение
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
}

// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
reportWebVitals();