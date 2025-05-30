import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css'; // Убедись, что этот файл содержит все актуальные стили
import App from './App';

// --- Начало кода для отмены регистрации Service Worker ---
// Этот код пытается найти и отменить регистрацию всех Service Worker'ов,
// связанных с текущим сайтом. Это может помочь, если старый Service Worker
// кэширует устаревшие ресурсы.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then(function(registrations) {
    if (registrations && registrations.length > 0) {
      console.log('Найдены активные Service Worker-ы. Попытка отмены регистрации...');
      for (let registration of registrations) {
        registration.unregister()
          .then(function(isUnregistered) {
            if (isUnregistered) {
              console.log('Service Worker успешно отменен:', registration.scope);
              // Рекомендуется перезагрузить страницу после успешной отмены регистрации,
              // чтобы браузер перестал использовать кэш от Service Worker.
              // Можно сделать это один раз, например, по флагу в localStorage.
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
// --- Конец кода для отмены регистрации Service Worker ---

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode> {/* Рекомендуется для разработки */}
    <App />
  </React.StrictMode>
);

// Если ты использовал Create React App и у тебя есть файл reportWebVitals.js,
// ты можешь раскомментировать следующую часть для отслеживания производительности:
// import reportWebVitals from './reportWebVitals';
// reportWebVitals(console.log); // или отправка на сервер аналитики