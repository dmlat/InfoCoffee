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
