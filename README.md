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
-   `DATA_SCHEMA.md`: Provides a detailed description of the PostgreSQL database schema, including all tables, columns, and relationships.

---

## 2. Backend Deep Dive

The backend is the core of the application. Here are some key concepts to understand.

### Environment Variables

**Centralized Loading**: All environment variables (`.env` files) are loaded **only** in `backend/db.js`. This is the single source of truth for configuration.

-   **Production (`NODE_ENV=production`):** Loads configuration from `backend/.env`.
-   **Development (`NODE_ENV=development`):** Loads configuration from `backend/.env.development`.

**Configuration Strategy:**
To prevent conflicts and ensure a safe development environment, the project uses separate Telegram bots and settings for production and development.

-   **Production:** Uses the main bot (`TELEGRAM_BOT_TOKEN`) and a dedicated admin bot (`ADMIN_TELEGRAM_BOT_TOKEN`) for error reporting. All settings are defined in `backend/.env`.
-   **Development:** Uses a single, separate test bot (`DEV_TELEGRAM_BOT_TOKEN`) for all functionalities, including error reporting. All settings for development must be fully defined in `backend/.env.development`. **This file must be self-contained and include all necessary variables (database, JWT, etc.).**

**New `env.example` file:**
A new file, `backend/env.example`, has been created. It serves as a template that documents all the necessary variables for both `.env` (production) and `.env.development` (development) files. Use this file as a reference when setting up your environment.

**DO NOT** add `require('dotenv').config()` to any other file. All necessary variables are available globally via `process.env` after `db.js` is imported anywhere in the application.

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

1.  **Handshake**: The frontend sends `initData` to `POST /api/auth/telegram-handshake`.
2.  **Validation**: The backend uses `validateTelegramInitData` in `backend/routes/auth.js` to verify the data.
    -   In `production`, it performs a cryptographic hash check using the `TELEGRAM_BOT_TOKEN`.
    -   In `development`, this check is **bypassed** to allow easy testing in a regular web browser.
3.  **JWT Token**: Upon successful validation, the backend issues a JSON Web Token (JWT) which is used for all subsequent authenticated API requests in the `Authorization: Bearer <token>` header.
4.  **Middleware**: The `backend/middleware/auth.js` middleware protects authenticated routes by verifying the JWT on every request.

### Error Reporting

Unhandled errors and specific issues are reported to an administrator via a Telegram bot.

-   The utility function `sendErrorToAdmin` in `backend/utils/adminErrorNotifier.js` is used for this.
-   To prevent spam from repeated frontend requests causing the same error, this function debounces notifications. It will only send one notification for a unique user/error-context pair within a 5-minute window.

---

## 3. Frontend Overview

The frontend is a standard Create React App application.

-   `src/api.js`: An `axios` client is configured here. It handles adding the JWT to requests and refreshing it.
-   `src/pages/`: Contains the main pages of the application, such as `RegisterPage.js` and `Dashboard.js`.
-   `src/utils/user.js`: Contains helper functions for managing user data in `localStorage`.

---

## 4. Getting Started

1.  **Clone the repository.**
2.  **Configure environment variables**:
    -   In the `backend/` directory, create two files: `.env` for production and `.env.development` for local development.
    -   Use `backend/env.example` as a reference. Pay close attention to fill in **all** required variables for each file. The `.env.development` file must be complete and contain its own values for the database, JWT, etc.
3.  **Install dependencies**: Run `npm install` in both the root directory and the `frontend/` directory.
4.  **Run the application**: Use `docker-compose up -d` from the root directory to start the backend server and the database.
5.  **Start the frontend**: Navigate to the `frontend/` directory and run `npm start`.

---

## 5. Deployment

The `deploy.sh` script is used for deploying the application on the production server. It automates:
- Pulling the latest changes from Git.
- Installing/updating dependencies only if needed.
- Restarting the application services using Docker Compose.

---

## 6. Key Files

-   `DATA_SCHEMA.md`: **Essential reading.** Understand the database structure before making any data-related changes.
-   `backend/routes/auth.js`: The heart of the user registration and login logic.
-   `backend/db.js`: The single source of truth for database and environment configuration.
-   `deploy.sh`: The production deployment script.
-   `MANUAL_JOBS.md`: **New!** Instructions for running background jobs (like data imports) manually.

---

## 7. Operations and Manual Jobs

For maintenance, debugging, or development, you can run most background jobs manually. The system uses a centralized script for this.

-   **`scripts/run-manual-job.sh`**: The main script to execute on a server.
-   **`backend/worker/manual_runner.js`**: The Node.js script that contains the core logic. It's usually easier to run this directly in local development.

All commands and examples are documented in `MANUAL_JOBS.md`.

---

## 8. Development vs. Production Workflow

The application has two distinct modes of operation, managed by the `NODE_ENV` environment variable. Understanding the differences is crucial for development and deployment.

### Local Development (`NODE_ENV=development`)

This mode is designed for building and testing features locally without needing the full Telegram environment.

**How to run:**
```bash
# From the project root
npm run dev
```
This command concurrently starts the backend with `nodemon` and the frontend with `react-scripts start`.

**Key Behaviors:**
-   **Backend (`nodemon app.js`):**
    -   Uses `backend/.env.development` for **all** configuration. It does not fall back to `.env`.
    -   **Telegram Hash Bypass**: The authentication endpoint (`/api/auth/telegram-handshake`) **DOES NOT** validate the Telegram `initData` hash. This is the key feature that allows browser-based development.
    -   **Hot-Reload**: `nodemon` automatically restarts the server when you save changes to backend files.
-   **Frontend (`react-scripts start`):**
    -   **Mock Telegram Environment**: The file `frontend/src/utils/dev.js` detects the development environment and creates a `window.Telegram` mock object.
    -   This allows the application to run in a standard web browser (e.g., Chrome) and bypasses the need to load it through a real Telegram client.
    -   **Role Emulation**: You can emulate different user roles by adding a URL parameter, for example: `http://localhost:3000/?role=service` to test as a service user.

### Production Deployment (`NODE_ENV=production`)

This is the live mode, used on your server. It is configured via `backend/.env`.

**How to deploy:**
1.  Commit and push your changes to your GitHub repository.
2.  On your server, pull the latest changes: `git pull`.
3.  Run the deployment script: `./deploy.sh`.

**Key Behaviors:**
-   **Backend (`node app.js` within Docker):**
    -   Uses `backend/.env` for configuration with production-level `TELEGRAM_BOT_TOKEN` and other secrets.
    -   **Strict Telegram Validation**: The authentication endpoint **ENFORCES** cryptographic validation of the `initData` hash. Any request with an invalid hash will be rejected. This is a critical security measure.
-   **Frontend (Static Build):**
    -   The `deploy.sh` script (or a CI/CD pipeline) should run `npm run build:frontend`.
    -   This creates a highly optimized static build of the React app in `frontend/build/`.
    -   This static build is then served to users. The application expects to be loaded within a genuine Telegram Web App environment. 