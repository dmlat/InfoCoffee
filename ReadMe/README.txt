# InfoCoffee Analytics Platform: Technical Documentation

This document provides a comprehensive technical overview of the InfoCoffee Analytics Platform, detailing its architecture, configuration, and key operational concepts. It is intended for developers to understand the system's inner workings, particularly the distinctions between development and production environments.

---

## 1. Project Architecture

The project is structured as a monorepo containing a React frontend and a Node.js (Express) backend.

-   `backend/`: The Express.js server that handles all business logic, API requests, database interactions, and communication with external services like Vendista. It also includes the integrated Telegram bot and all background workers.
-   `frontend/`: The React application that serves as the user interface, delivered to users as a Telegram Mini App.
-   `ecosystem.config.js`: The PM2 configuration file for managing production processes. This is the standard for running the application on a production server.
-   `docker-compose.yml`: Defines the services, networks, and volumes for the local development environment, primarily for running the PostgreSQL database.

### 1.1. Production Architecture (PM2)

In a production environment, the system is managed by PM2 and runs as two distinct processes defined in `ecosystem.config.js`:

1.  **infocoffee-backend**: The main process that runs the API server, the integrated Telegram Bot, and the bot monitoring system.
2.  **infocoffee-scheduler**: A dedicated process for handling all scheduled (cron) jobs, including data imports from Vendista, terminal synchronization, and other recurring background tasks.

**Critical Note:** The Telegram bot functionality is fully integrated into the `infocoffee-backend` process. There is no separate bot process.

---

## 2. Environment Configuration

The application's behavior is fundamentally controlled by the `NODE_ENV` environment variable, which must be set to either `development` or `production`.

### 2.1. Configuration Loading

-   The application entry point, `backend/app.js`, is the **only** module responsible for loading environment variables.
-   It detects the `NODE_ENV` and loads the corresponding `.env` file.
-   `production`: Loads configuration from `backend/.env`.
-   `development`: Loads configuration from `backend/.env.development`.
-   All other modules in the application access configuration variables via `process.env`. **Do not add `require('dotenv').config()` to any other file.**

> **Mistake to Avoid:** Never add `require('dotenv').config()` to any other files (e.g., `db.js`, `bot.js`). `app.js` is the single source of truth for configuration. Adding it elsewhere can cause modules to load inconsistent environments, leading to hard-to-debug errors where different parts of the application connect to different databases or services.

### 2.2. Environment-Specific Settings

-   **Production (`.env`):**
    -   Must contain all production-grade credentials.
    -   Requires a production `TELEGRAM_BOT_TOKEN` for the main bot.
    -   Requires a separate `ADMIN_TELEGRAM_BOT_TOKEN` and `ADMIN_TELEGRAM_CHAT_ID_FOR_ERRORS` for the error notification system.
    -   Contains production database credentials and the `ENCRYPTION_KEY`.

-   **Development (`.env.development`):**
    -   This file must be completely self-contained for local development.
    -   It uses a dedicated `DEV_TELEGRAM_BOT_TOKEN` for all bot functionalities to avoid interfering with the production bot.
    -   It should contain connection details for the local Docker-based PostgreSQL database.
    -   It includes test Telegram user IDs (`DEV_OWNER_TELEGRAM_ID`, etc.) required for the role emulation feature.

### 2.3. env.example

The `backend/env.example` file serves as a comprehensive template, documenting all required environment variables for both production and development setups.

---

## 3. Authentication and Authorization

The authentication system is designed to function both within the real Telegram Mini App environment and in a standard web browser for development.

### 3.1. Authentication Flow

1.  **Initiation**:
    -   **Production**: The frontend, running inside Telegram, receives the `initData` string from the `window.Telegram.WebApp` object provided by the Telegram client.
    -   **Development**: The `frontend/src/pages/DevEntryPage.js`, accessible at the root of the local frontend server, serves as the primary entry point. It allows developers to select a user role (`owner`, `admin`, `service`) with a single click.

2.  **Development Emulation**:
    -   When a role is selected on the `DevEntryPage`, the `frontend/src/utils/dev.js` utility script sends a request to the backend's `GET /api/dev-config` endpoint to fetch the pre-configured test user IDs.
    -   It then generates a fake `initData` string based on the selected role and **overwrites the `window.Telegram` object** in the browser. This mechanism simulates a legitimate Telegram login.
    -   A "Logout (Dev)" button is rendered on all pages in development mode, allowing for instant session termination and role switching by returning to the `DevEntryPage`.
    
> **Mistake to Avoid:** The asynchronous initialization in `frontend/index.js` (`initDevTelegram().then(...)`) is critical. Rendering the `<App />` component directly in development mode will cause it to start before the mock `window.Telegram` object is created, which will break the authentication flow.

3.  **Handshake**: The real (production) or fake (development) `initData` string is sent to the backend endpoint `POST /api/auth/telegram-handshake`.

4.  **Validation**:
    -   In `production`, the backend performs a strict cryptographic hash validation of the `initData` string using the `TELEGRAM_BOT_TOKEN` to ensure its authenticity.
    -   In `development`, this hash validation is **skipped**, allowing the backend to trust the fake `initData` sent from the browser.

5.  **JWT Issuance**: Upon successful validation, the backend issues a JSON Web Token (JWT) containing the user's ID, `telegram_id`, and `accessLevel`. This token must be included in the `Authorization: Bearer <token>` header of all subsequent API requests.

### 3.2. Frontend State Management (AuthProvider)

-   The `AuthProvider` React Context (`frontend/src/App.js`) is the central component for managing authentication state on the frontend. It handles the full authentication lifecycle, stores the user object and token, and makes them available to all child components.
-   **CRITICAL: `isLoading` flag**: The `AuthProvider` exposes an `isLoading` boolean flag. This flag is `true` while the provider is asynchronously validating the token with the backend. Any component that relies on user data (e.g., `user.accessLevel` for role-based rendering) **must** check this flag and render a loading state until it is `false`. Failure to do so will lead to runtime errors (`Cannot read properties of undefined`) as the component will attempt to access `user` before it has been loaded.

> **Mistake to Avoid:** Always check `if (isLoading)` before attempting to access the `user` object from the `useAuth()` hook. Components often render before the async authentication process is complete. Accessing `user.accessLevel` when `user` is still `null` is a common source of crashes.

### 3.2.1. Accessing User Data in Components

The established pattern for accessing user data (like the user object, token, or authentication status) within any component is to use the `useAuth()` hook. This ensures that every component has access to the same, single source of truth.

```javascript
// Example from RightsPage.js
import { useAuth } from '../App';

export default function RightsPage() {
    const { user, isLoading } = useAuth();

    if (isLoading) {
        return <div>Loading...</div>;
    }
    // ... rest of the component logic using 'user'
}
```

> **Mistake to Avoid:** **Never pass the `user` object as a prop** from a parent component to a child page (e.g., `<ProfilePage user={user} />`). This is an anti-pattern in this project. It breaks the standardized data flow, can lead to state synchronization issues, and was the root cause of an infinite-loop bug on the `ProfilePage`. Always use the `useAuth()` hook directly within the component that needs the data.

### 3.2.2. Managing Component State with External Data (Props)

A common challenge is managing a component's internal state when it's initialized with data from props, especially in editing forms or modals. A frequent bug occurs when trying to track whether the user has made changes ("dirty state").

> **Mistake to Avoid:** **Do not re-initialize your component's "original state" every time props change.** If you have a `useEffect` hook that watches a prop (e.g., an `itemToEdit` object) and it sets both the *current form state* and the *original state snapshot* for comparison, any update to that prop will incorrectly make it seem like no changes have been made.
>
> **Correct Pattern:**
> 1.  On the first render or when a new item is loaded, capture the incoming prop data into an "initial state" variable (using `useState`). Use a `useRef` to store the ID of the item being edited.
> 2.  In your `useEffect` hook that watches the prop, check if the ID of the incoming item is different from the one in your `useRef`.
> 3.  Only reset the "initial state" snapshot if the ID has changed (i.e., a completely new item is being edited).
> 4.  If the ID is the same, only update the *display* state, allowing your comparison logic to correctly detect changes against the original snapshot.
> This prevents the component from losing track of user edits when parent data is updated (e.g., applying a preset or template).

### 3.2.3. Preserving UI State Across Re-renders

For complex components that display lists or have interactive UI elements (like accordions), it is critical to preserve the user's view state across data-driven re-renders to avoid a frustrating user experience.

> **Mistake to Avoid:** **Forgetting to preserve UI state beyond scroll position.** When a user action triggers a data refresh and re-render, the entire component tree can be rebuilt. This will reset not only the scroll position but also the state of any interactive elements, like whether a collapsible section was open. Simply saving and restoring `scrollTop` is not enough.
>
> **Correct Pattern:**
> 1.  Identify all critical UI state that needs to be preserved (e.g., scroll position, open/closed state of accordions, selected tabs).
> 2.  Use `useRef` hooks to create persistent storage for each piece of state that needs to survive the re-render.
> 3.  **Before** dispatching the action that causes the re-render, capture the current UI state and save it to your `useRef` variables.
> 4.  Use the `useLayoutEffect` hook to restore the UI state. This hook should depend on the data that gets re-rendered. It runs synchronously after the DOM has been updated but before the browser has painted the screen, making it ideal for restoring state without a visual flicker.

### 3.3. Routing and Navigation

The application uses `react-router-dom` v6 with a robust, role-based routing architecture to prevent redirection loops and enforce access control.

1.  **Single Parent Route (`/dashboard`)**: A single, protected parent route serves as the entry point for all authenticated users.
2.  **Layout Selector (`DashboardLayoutSelector`)**: Inside the `/dashboard` route, this component inspects the authenticated user's `accessLevel` and renders the correct UI layout: `MainDashboardLayout` for `owner`/`admin` or `ServiceDashboardLayout` for `service`.
3.  **Protected Routes (`ProtectedRoute`)**: Each child route that requires specific permissions (e.g., `/dashboard/finances` for admins) is wrapped in this component. It verifies the user's role and redirects them to a default page if they lack the necessary access.

This structure eliminates the possibility of infinite redirect cycles and provides a clear, predictable navigation flow.

### 3.3.1. Adding a New Page

To add a new navigable page to the main dashboard, follow these steps:

1.  **Create the Page Component**: Create your new component file in `frontend/src/pages/`, for example, `AnalyticsPage.js`. Ensure it uses the `useAuth()` hook for user data if needed.
2.  **Import the Component**: In `frontend/src/App.js`, import the new page component.
    ```javascript
    import AnalyticsPage from './pages/AnalyticsPage';
    ```
3.  **Add the Route**: In `frontend/src/App.js`, add a new `<Route>` within the `DashboardLayoutSelector`'s child routes. Wrap it in `ProtectedRoute` if it requires specific user roles.
    ```javascript
    <Route path="analytics" element={<ProtectedRoute allowedRoles={['owner', 'admin']}><AnalyticsPage /></ProtectedRoute>} />
    ```
4.  **Add Navigation Link**: In `frontend/src/layouts/MainDashboardLayout.js` (or `ServiceDashboardLayout.js`), add a new `NavLink` to the appropriate tab row so users can navigate to your new page.

---

## 4. Key Backend Systems

### 4.1. Database Interaction (backend/db.js)

The `db.js` module provides a standardized interface for PostgreSQL database interaction.

-   **Simple Queries**: Use `db.query(text, params)` for single, atomic queries. It uses the connection pool automatically.
-   **Transactions**: For multi-step operations that must succeed or fail as a single unit, a dedicated client must be acquired from the pool. **Always release the client in a `finally` block to prevent connection leaks.**

```javascript
const { pool } = require('../db'); // Must destructure 'pool'
const client = await pool.connect();
try {
    await client.query('BEGIN');
    // ... your queries using client.query()
    await client.query('COMMIT');
} catch (e) {
    await client.query('ROLLBACK');
    throw e;
} finally {
    client.release(); // CRITICAL: Release client back to the pool
}
```
*Mistake to avoid*: `require('../db')` returns the module object, not the pool itself. To use transactions, you **must** destructure `pool`: `const { pool } = require('../db');`. Failure to do so will result in a `pool.connect is not a function` runtime error.

### 4.2. Background Workers and Scheduled Jobs

-   **Import Scheduler (`schedule_imports.js`)**: Manages all scheduled data synchronization with the Vendista API, including 15-minute, daily, and weekly imports. Also handles terminal status synchronization.
-   **Inventory Notifier (`inventory_notifier_worker.js`)**: Runs hourly to scan for inventory changes. It aggregates all changes made by a user within that hour, groups them by location (determined by `terminal_id`: `NULL` for Warehouse, present for a Stand), and sends a consolidated, structured report to the owner and admins. To handle large reports, the worker automatically splits messages that exceed Telegram's character limit.
-   **Task Cleanup (`task_cleanup_worker.js`)**: Runs daily at 23:59 (Moscow Time) to hide completed tasks from the main UI, keeping the active task list clean while preserving historical data for analytics.

### 4.2.1. Transaction Import Logic

The system distinguishes between two types of transaction imports:

#### **Historical Import** (`isHistoricalImport: true`)
-   Used for importing past transactions during initial setup or data recovery
-   **Inventory updates SKIPPED** - ingredients were already consumed in the past
-   Optimized for speed (~10x faster) as it only handles database operations
-   Triggered by: `--full-history` flag, initial user registration

#### **Scheduled Import** (`isHistoricalImport: false`) 
-   Runs every 15 minutes to sync recent transactions (last 24 hours)
-   **Inventory updates ENABLED** - ingredients are deducted for new sales only
-   Updates ingredient levels and creates service tasks based on recipes
-   **Critical**: Only processes inventory for NEW transactions (xmax === '0'), avoiding duplication

**Key Features:**
-   Uses PostgreSQL `ON CONFLICT` to distinguish new vs updated transactions
-   Ingredient deduction only occurs for genuinely new sales
-   Prevents duplicate inventory processing during overlapping import periods

### 4.3. Telegram Bot System (Queuing and Error Handling)

-   **Safe Initialization (`backend/bot.js`)**: Bot initialization is handled by a controlled `startPolling` function that includes deliberate delays and a retry mechanism with exponential backoff to prevent 429 "Too Many Requests" errors on startup.
-   **Message Queuing (`backend/utils/botQueue.js`)**: All outgoing Telegram messages are processed through a robust queuing system. It features separate queues for regular and priority messages, rate limiting, and automatic retries for failed messages.
-   **Admin Error Notifier (`backend/utils/adminErrorNotifier.js`)**: A sophisticated error reporting system that groups similar errors, debounces notifications (e.g., one alert per unique error every 5 minutes), and uses a separate admin bot to avoid interfering with the main bot's queue.

### 4.4. Vendista Payment Status Tracking

To prevent notification spam from users with unpaid Vendista accounts, the system tracks their payment status.

-   If the Vendista API returns a 402 "Payment Required" error, the user's status in the database is set to `payment_required`.
-   A single notification is sent to administrators.
-   Background workers will then skip this user in subsequent runs until the issue is resolved.
-   The status is automatically reset to `active` once API calls for that user succeed again.
-   Admins can also manually reset the status via the `POST /api/auth/reset-payment-status` endpoint.

---

## 5. Getting Started (Local Development)

1.  **Clone Repository**: Clone the project to your local machine.
2.  **Configure Environments**: In the `backend/` directory, create `.env` and `.env.development` files using `backend/env.example` as a template. Fill in all required variables for both files.
3.  **Install Dependencies**: Run `npm run install:all` from the project's root directory.
4.  **Start Database**: Run `docker-compose up -d` to start the PostgreSQL container.
5.  **Run Application**: Run `npm run dev`. This will start the backend (port 3001) and frontend (port 3000) servers with `nodemon` and `react-scripts`.
6.  **Access Application**: Open `http://localhost:3000` in your browser to access the `DevEntryPage` and begin testing.

> **Important Note on Database Schema:** If you encounter database errors like `column "..." does not exist` after pulling new changes, your local database schema is likely out of sync. The safest way to resolve this in a development environment is to stop the application, delete the `pgdata` volume (`rm -rf pgdata`), and restart the Docker container (`docker-compose up -d`). This will recreate the database with the latest schema.

---

## 6. Deployment

Deployment to a production server is automated via the `deploy.sh` script. This script handles:

1.  Pulling the latest changes from the Git repository.
2.  Installing/updating npm dependencies for both backend and frontend if `package.json` has changed.
3.  Creating a production build of the frontend application.
4.  Using `rsync` to deploy the built frontend assets to the web server's root directory.
5.  Restarting the backend and scheduler processes via PM2 using `pm2 restart ecosystem.config.js --update-env`.

Manual PM2 commands can also be used for management:
-   `pm2 list`: View status of all processes.
-   `pm2 logs infocoffee-backend`: View logs for a specific process.
-   `pm2 restart ecosystem.config.js --update-env`: Restart all processes and apply new environment variables.


---

## 7. Manual Operations

The `backend/worker/manual_runner.js` script provides a command-line interface for executing specific one-off tasks. It is essential for maintenance, debugging, and data backfilling.

Additionally, `backend/worker/direct_import.js` provides a direct import utility that bypasses the scheduling queue for faster debugging and historical imports.

Run the scripts from the project root directory.

### 7.1. Debugging and Performance Tools

For performance analysis and debugging, the system includes several specialized tools:

-   **Direct Import**: Bypasses the queue system for immediate execution and detailed performance metrics
-   **Statistics Display**: Shows comprehensive transaction statistics and database status  
-   **Schedule Testing**: Allows testing of cron jobs without waiting for scheduled execution
-   **Performance Logging**: Detailed timing breakdown of API calls, database operations, and inventory updates

### Available Commands:

-   `import-transactions`: Manually trigger the transaction import for a specific user (via queue). Can fetch for a given number of days or the entire history since the user's setup date.
-   `direct-import`: Direct import without queue (for debugging and faster historical imports). Bypasses the scheduling system.
-   `sync-terminals`: Synchronize the list of terminals from Vendista for a user.
-   `update-creds`: Securely update the Vendista login and password for a user. The script will validate the new credentials before saving the encrypted versions.
-   `test-token`: Test the validity of a user's current Vendista API token against the API endpoints.
-   `show-stats`: Display transaction statistics and database status for a user.
-   `test-schedule`: Test scheduled import jobs immediately without waiting for cron.

### Usage Examples:

-   **Queue import for User 1 (full history):**
    ```bash
    node backend/worker/manual_runner.js import-transactions --user-id 1 --full-history
    ```

-   **Direct import for debugging or faster historical imports:**
    ```bash
    node backend/worker/manual_runner.js direct-import --user-id 1 --full-history
    node backend/worker/manual_runner.js direct-import --user-id 1 --days 7
    ```

-   **Show transaction statistics:**
    ```bash
    node backend/worker/manual_runner.js show-stats --user-id 1
    ```

-   **Test scheduled jobs immediately:**
    ```bash
    node backend/worker/manual_runner.js test-schedule --job 15min
    node backend/worker/manual_runner.js test-schedule --job daily
    ```

-   **Update Vendista credentials for User 1:**
    ```bash
    node backend/worker/manual_runner.js update-creds --user-id 1 --login "your_vendista_login" --password "your_vendista_password"
    ```

-   **Test the API token for User 3:**
    ```bash
    node backend/worker/manual_runner.js test-token --user-id 3
    ```

### 7.2. Shell Wrapper (Convenience Commands)

For easier access, use the shell wrapper `scripts/run-manual-job.sh`:

-   **Quick debugging and statistics:**
    ```bash
    ./scripts/run-manual-job.sh show-stats --user-id 1
    ./scripts/run-manual-job.sh direct-import --user-id 1 --days 1
    ./scripts/run-manual-job.sh test-schedule --job 15min
    ```

-   **Direct alternative to manual_runner.js:**
    ```bash
    node backend/worker/direct_import.js stats 1
    node backend/worker/direct_import.js import 1 7
    node backend/worker/direct_import.js import 1 full-history
    ``` 

### 7.3. Testing Specific Workers

The project may include dedicated test scripts for complex workers in the `backend/worker/` directory, such as `test_inventory_notifier.js`. These scripts are designed to be run in a `development` environment to verify specific functionality without affecting production data.

-   **Run the inventory notifier test:**
    ```bash
    node backend/worker/test_inventory_notifier.js
    ```
--- 