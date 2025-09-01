# Changelog

All notable changes to this project will be documented in this file.

---

### **Version 1.1.0 (2024-08-21)**

This update focuses on major stability improvements, bug fixes, and documentation enhancements.

#### **🚀 Features & Refactoring**

-   **Critical Stability Boost (`bot.js` Refactoring)**: The main user-facing bot (`bot.js`) has been significantly refactored to use the robust `botQueue.js` message queuing system for all outgoing messages. This change prevents Telegram API rate-limiting errors, ensures reliable message delivery even under high load, and improves overall system resilience.

-   **Development Environment Fix (`cross-env`)**: Resolved a critical issue where the `NODE_ENV=development` environment variable was not being set correctly. By integrating the `cross-env` package, the local development server now starts reliably in the correct mode, enabling proper bot initialization and access to development-only API endpoints.

#### **🐛 Bug Fixes**

-   **Expense Logging Fix**: Fixed a bug that caused the system to crash when a user tried to log an expense via the Telegram bot without specifying a date. The system now correctly defaults to the current timestamp (`new Date()`) for the `expense_time` field, preventing database errors.

#### **🧹 Code Cleanup & Maintenance**

-   **Code Readability**: Removed legacy, commented-out code blocks and numerous non-essential `console.log` statements, particularly from `auth.js` and `db.js`. This makes the codebase cleaner and easier to maintain.

#### **📚 Documentation**

-   **`CHANGELOG.md`**: This file has been created to track project versions and changes moving forward.
-   **`Bot.md`**: The technical documentation for the bot has been updated to reflect the `bot.js` refactoring. It now includes a "Technical Debt" section that accurately describes the current state and outlines potential future improvements (e.g., queueing `editMessageText` calls).
-   **`API_Backend.md`**: The backend API documentation has been updated to include the previously undocumented diagnostic endpoint `POST /api/auth/test-admin-notification`.

### v0.9.1 - 2024-09-01

**Исправления (Fixes):**

-   **Исправлена критическая ошибка аутентификации после регистрации:**
    -   **Проблема:** После завершения регистрации пользователь видел ошибку "ошибка сети", хотя на бэкенде регистрация проходила успешно. При обновлении страницы пользователь был авторизован.
    -   **Причина:**
        1.  **Race Condition (Состояние гонки) на фронтенде:** Сразу после получения успешного ответа о регистрации, фронтенд запускал полную повторную аутентификацию (`reAuthenticate`). Этот запрос уходил слишком быстро, и бэкенд не всегда успевал обработать и найти только что созданного пользователя, что приводило к ошибке "Пользователь не найден".
        2.  **Неконсистентность API на бэкенде:** Разные эндпоинты (`/complete-registration` и `/refresh-app-token`) возвращали объект пользователя с разным стилем именования ключей (`camelCase` vs `snake_case`), что могло вызывать скрытые ошибки при обработке данных на клиенте.
    -   **Решение:**
        1.  **На фронтенде:** Вместо полной повторной аутентификации была внедрена функция `setAuthenticated`, которая плавно переводит приложение в аутентифицированное состояние, используя данные, полученные сразу после регистрации. Это устранило состояние гонки.
        2.  **На бэкенде:** Все эндпоинты аутентификации были стандартизированы. Теперь они всегда возвращают объект пользователя в `snake_case`, что соответствует формату данных в базе данных.
    -   **Улучшения:** Добавлено детальное логирование на бэкенде для процесса обновления токена, чтобы упростить диагностику подобных проблем в будущем.
-   Исправлена ошибка в `updateUserInContext`, при которой могли теряться данные пользователя при обновлении профиля.