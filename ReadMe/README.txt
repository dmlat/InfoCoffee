# InfoCoffee Analytics Project

Welcome to the InfoCoffee Analytics project! This application is designed to provide analytics and management tools for coffee businesses, integrating with the Vendista platform and a Telegram Mini App for user interaction.

## Table of Contents
1.  [Project Architecture](#project-architecture)
2.  [Backend Deep Dive](#backend-deep-dive)
    - [Environment Variables](#environment-variables)
    - [Database Connection](#database-connection)
    - [Authentication Flow](#authentication-flow)
    - [Error Reporting](#error-reporting)
3.  [Frontend Overview](#frontend-overview)
4.  [Getting Started](#getting-started)
5.  [Deployment](#deployment)
6.  [Key Files](#key-files)

---

## 1. Project Architecture

The project is a monorepo containing a React frontend and a Node.js (Express) backend.

-   `frontend/`: Contains the React application that users interact with through the Telegram Mini App.
-   `backend/`: The Express.js server that handles business logic, API requests, and communication with the database and external services like Vendista.
-   `docker-compose.yml`: Defines the services, networks, and volumes for running the application using Docker, including the main application and the PostgreSQL database.
-   `DATA_SCHEMA.txt`: Provides a detailed description of the PostgreSQL database schema, including all tables, columns, and relationships.

---

## 2. Backend Deep Dive

The backend is the core of the application. Here are some key concepts to understand.

### Environment Variables

**Centralized Loading**: The application entry point, `backend/app.js`, is responsible for loading the correct environment file (`.env` for production, `.env.development` for development) based on the `NODE_ENV` variable. This is the single source of truth for configuration.

-   **Production (`NODE_ENV=production`):** Loads configuration from `backend/.env`.
-   **Development (`NODE_ENV=development`):** Loads configuration from `backend/.env.development`.

**Configuration Strategy:**
To prevent conflicts and ensure a safe development environment, the project uses separate Telegram bots and settings for production and development.

-   **Production:** Uses the main bot (`TELEGRAM_BOT_TOKEN`) and a dedicated admin bot (`ADMIN_TELEGRAM_BOT_TOKEN`) for error reporting. All settings are defined in `backend/.env`.
-   **Development:** Uses a single, separate test bot (`DEV_TELEGRAM_BOT_TOKEN`) for all functionalities, including error reporting. All settings for development must be fully defined in `backend/.env.development`. **This file must be self-contained and include all necessary variables (database, JWT, etc.).**

**New `env.example` file:**
A new file, `backend/env.example`, has been created. It serves as a template that documents all the necessary variables for both `.env` (production) and `.env.development` (development) files. Use this file as a reference when setting up your environment.

**DO NOT** add `require('dotenv').config()` to any other file. All necessary variables are available globally via `process.env` after the application starts.

### Database Connection

The module `backend/db.js` exports an object for database interaction:

```javascript
module.exports = {
  // For single, simple queries. Automatically manages connections.
  query: (text, params) => pool.query(text, params),
  
  // For transactions or when you need a dedicated client.
  pool, 
};
```

**Usage:**

-   **Simple Query**:
    ```javascript
    const db = require('../db');
    const users = await db.query('SELECT * FROM users');
    ```

-   **Transaction**: To ensure a series of operations succeed or fail together, you must get a client from the pool.
    ```javascript
    const { pool } = require('../db');
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        // ... your queries using client.query()
        await client.query('COMMIT');
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release(); // IMPORTANT: Always release the client
    }
    ```
    *Mistake to avoid*: `require('../db')` returns the module object, not the pool itself. To use transactions, you **must** destructure `pool`: `const { pool } = require('../db');`.

### Authentication Flow

Authentication is handled via the Telegram Mini App's `initData`.

**Development Mode**: To simplify local development, the frontend features a dedicated development entry page (`frontend/src/pages/DevEntryPage.js`). This page allows you to select a user role (`owner`, `admin`, or `service`) with a single click. A "Logout (Dev)" button is also available on all pages in development mode, allowing for quick session resets and role switching. The `frontend/src/utils/dev.js` script fetches pre-configured test user IDs from the backend (`GET /api/dev-config`) and simulates the Telegram login handshake by **overwriting** the `window.Telegram` object, ensuring correct role switching with each click. This is the primary method for testing in a browser.

1.  **Handshake**: The frontend sends `initData` to `POST /api/auth/telegram-handshake`.
2.  **Validation**: The backend uses `validateTelegramInitData` in `backend/routes/auth.js` to verify the data.
    -   In `production`, it performs a cryptographic hash check using the `TELEGRAM_BOT_TOKEN`.
    -   In `development`, this check is **bypassed** to allow easy testing in a regular web browser. The `/telegram-handshake` and `/validate-token` endpoints are synchronized to correctly handle emulated roles.
3.  **JWT Token**: Upon successful validation, the backend issues a JSON Web Token (JWT) which is used for all subsequent authenticated API requests in the `Authorization: Bearer <token>` header.
4.  **Middleware**: The `backend/middleware/auth.js` middleware protects authenticated routes by verifying the JWT on every request.

### Error Reporting

Unhandled errors and specific issues are reported to an administrator via a Telegram bot.

-   The utility function `sendErrorToAdmin` in `backend/utils/adminErrorNotifier.js` is used for this.
-   To prevent spam from repeated frontend requests causing the same error, this function debounces notifications. It will only send one notification for a unique user/error-context pair within a 5-minute window.

###   Inventory Change Notifications

To keep business owners informed about stock management, a dedicated worker (`backend/worker/inventory_notifier_worker.js`) runs periodically.

-   **Functionality**: This worker scans the `inventory_change_log` table for new, un-notified changes made by users (typically `service` staff). It groups these changes by the user who made them and sends a consolidated summary report to the business owner and all associated admins.
-   **Scheduling**: The worker is configured in `backend/app.js` to run automatically once per hour.
-   **Purpose**: This provides an audit trail and helps owners keep track of inventory adjustments without needing to check the application constantly.

### Vendista Payment Status Tracking

The application includes a system to track Vendista service payment status and prevent spam notifications when users have unpaid accounts.

-   **Functionality**: When a 402 "Payment Required" error is received from Vendista API, the system sets the user's `vendista_payment_status` to `'payment_required'` and sends a single notification to administrators. Subsequent worker runs skip users with unpaid status.
-   **Automatic Recovery**: When API calls succeed again, the status automatically resets to `'active'` and normal processing resumes.
-   **Integration**: Built into all workers that interact with Vendista API (`terminal_sync_worker.js`, `vendista_import_worker.js`, `schedule_imports.js`).
-   **Manual Management**: Administrators can manually reset payment status using the `POST /api/auth/reset-payment-status` endpoint.

---

## 3. Frontend Overview

The frontend is a standard Create React App application. It focuses on providing a responsive and intuitive user experience within the Telegram Mini App.

-   `src/api.js`: An `axios` client is configured here. It handles adding the JWT to requests and refreshing it.
-   `src/pages/`: Contains the main pages of the application, such as `RegisterPage.js`, `Dashboard.js`, and the `TasksPage.js`.
-   `src/utils/user.js`: Contains helper functions for saving and clearing user data in `localStorage`.

### State Management
A React Context, `AuthProvider`, is the heart of the frontend's state management. It handles the entire authentication lifecycle, stores the authentication status and user data, and makes it available to all components. The `user` object should be accessed from this context, not directly from `localStorage`.

**Key states provided by `AuthProvider`**:
-   `user`: An object containing the current user's data.
-   `token`: The JWT for API requests.
-   `authStatus`: Строка, представляющая текущее состояние ('loading', 'authenticated', 'unauthenticated', 'registration_required').
-   `isLoading`: **Критически важный флаг.** Имеет значение `true`, пока `AuthProvider` инициализируется и проверяет токен. Компоненты, которые зависят от данных пользователя (например, для отображения навигации или выполнения запросов), **обязаны** проверять этот флаг и показывать состояние загрузки, чтобы избежать ошибок, связанных с попыткой доступа к `user` до его определения.

### Restock Task Flow
The process for completing a "restock" task has been streamlined. When a user clicks "Execute" on a restock task from the `TasksPage`, they are redirected to the `WarehousePage`. The warehouse interface is then automatically filtered and "locked" to show only the specific stand associated with that task. This focuses the user on the job at hand and prevents accidental changes to other stands. The previous modal-based workflow has been removed.

### Dashboard Navigation - **ВАЖНОЕ ОБНОВЛЕНИЕ**
Навигация в приложении была полностью переработана с использованием `react-router-dom` v6 для создания надежной и предсказуемой структуры, полностью исключающей ошибки с циклическими перенаправлениями.

**Новая архитектура**:
-   **Единый защищенный маршрут `/dashboard`**: Служит общей точкой входа для всех авторизованных пользователей.
-   **Выбор макета по роли (`DashboardLayoutSelector`)**: Вместо дублирующихся маршрутов теперь используется специальный компонент, который проверяет роль пользователя (`owner`, `admin`, `service`) и рендерит соответствующий макет (`MainDashboardLayout` или `ServiceDashboardLayout`).
-   **Защита дочерних маршрутов (`ProtectedRoute`)**: Каждый внутренний маршрут (например, `/dashboard/finances`) дополнительно защищен, чтобы пользователи с ограниченными правами (например, `service`) не могли получить к нему доступ.

Эта архитектура обеспечивает строгий контроль доступа и стабильность навигации. Старый компонент `DashboardRedirect` и логика с несколькими маршрутами `/dashboard` были полностью удалены.

---

## 4. Getting Started

1.  **Clone the repository.**
2.  **Configure environment variables**:
    -   In the `backend/` directory, create two files: `.env` for production and `.env.development` for local development.
    -   Use `backend/env.example` as a reference. Pay close attention to fill in **all** required variables for each file. The `.env.development` file must be complete and include its own values for the database, JWT, and development user IDs.
3.  **Install dependencies**: Run `npm run install:all` from the project's root directory. This will install dependencies for the root, backend, and frontend.
4.  **Run the application**: 
    -   Use `docker-compose up -d` from the root directory to start the PostgreSQL database.
    -   Use `npm run dev` from the root directory to start both the backend and frontend servers in development mode.
    -   Open `http://localhost:3000` in your browser. You will see the development entry page to select a user role for testing. Use the "Выйти (Дев)" button to reset your session and switch roles.

---

## 5. Deployment

The `