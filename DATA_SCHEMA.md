# Database Schema for "coffee_dashboard"

This document describes the current PostgreSQL database schema used in the InfoCoffee Analytics project. The schema consists of 12 tables responsible for storing data about users, transactions, expenses, inventory, and system logs.

**Core Principles:**
- **Ownership**: Most data is tied to a `user_id`, representing the business owner.
- **Delegated Access**: The `user_access_rights` table allows users to grant access to their data to other Telegram users (admins, service staff).
- **Centralized Stock**: The `inventories` table acts as the source of truth for all stock, both at the central warehouse and in individual coffee stands.

### Table of Contents
1.  [`users`](#users-table)
2.  [`user_access_rights`](#user_access_rights-table)
3.  [`terminals`](#terminals-table)
4.  [`transactions`](#transactions-table)
5.  [`expenses`](#expenses-table)
6.  [`inventories`](#inventories-table)
7.  [`recipes`](#recipes-table)
8.  [`recipe_items`](#recipe_items-table)
9.  [`stand_service_settings`](#stand_service_settings-table)
10. [`maintenance_tasks`](#maintenance_tasks-table)
11. [`service_tasks`](#service_tasks-table)
12. [`worker_logs`](#worker_logs-table)

---

## `users` Table
Stores primary information about application users. These records represent the *owners* of coffee businesses. The record is created upon the user's first interaction with the bot and is fully populated upon successful registration.

| Column               | Type           | Nullable | Description                                                                                                                                                            |
| -------------------- | -------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id` (PK)            | `SERIAL`       | NOT NULL | Unique internal identifier for the user. Primary key.                                                                                                                  |
| `telegram_id` (UQ)   | `BIGINT`       | NOT NULL | The user's unique Telegram ID. The primary link to their Telegram account.                                                                                             |
| `vendista_api_token` | `TEXT`         | NULL     | **Encrypted** API token for accessing the Vendista service. Populated during registration step 1.                                                                      |
| `first_name`         | `VARCHAR(255)` | NULL     | User's first name from Telegram. Can be empty if not set in the user's profile.                                                                                        |
| `user_name`          | `VARCHAR(255)` | NULL     | User's Telegram username (e.g., @username). Can be empty.                                                                                                              |
| `setup_date`         | `DATE`         | NULL     | **Crucial field**: The date of the first coffee machine installation. Entered by the user during registration step 2 and used as the `Date From` for the initial full history import. |
| `tax_system`         | `VARCHAR(32)`  | NULL     | User's selected tax system (e.g., 'income_6'). Set during registration.                                                                                                |
| `acquiring`          | `NUMERIC`      | NULL     | Acquiring commission rate as a percentage (e.g., 1.9). Set during registration.                                                                                        |
| `created_at`         | `TIMESTAMP`    | NOT NULL | Timestamp when the user record was created. Defaults to `now()`.                                                                                                       |
| `updated_at`         | `TIMESTAMP`    | NULL     | Timestamp of the last record update. Automatically updated by a trigger.                                                                                               |

```sql
CREATE TABLE IF NOT EXISTS public.users (
    id SERIAL PRIMARY KEY,
    telegram_id BIGINT UNIQUE NOT NULL,
    vendista_api_token TEXT,
    first_name VARCHAR(255),
    user_name VARCHAR(255),
    setup_date DATE,
    tax_system VARCHAR(32),
    acquiring NUMERIC,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_at TIMESTAMP DEFAULT now()
);

-- Trigger to automatically update the updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER set_timestamp_users
BEFORE UPDATE ON users
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();
```

---

## `user_access_rights` Table
Defines permissions for one user (e.g., an admin or service staff) to access another user's data (the owner). This is the core of the delegated access system.

| Column                          | Type        | Nullable | Description                                                                   |
| ------------------------------- | ----------- | -------- | ----------------------------------------------------------------------------- |
| `id` (PK)                       | `SERIAL`    | NOT NULL | Unique identifier for the access right.                                       |
| `owner_user_id` (FK)            | `INTEGER`   | NOT NULL | References `users.id`. The user who owns the data.                            |
| `shared_with_telegram_id`       | `BIGINT`    | NOT NULL | The Telegram ID of the person being granted access.                           |
| `shared_with_name`              | `VARCHAR`   | NOT NULL | The name of the person granted access (for display purposes).                 |
| `access_level`                  | `VARCHAR`   | NOT NULL | The level of access, e.g., 'admin', 'service'. `DEFAULT 'admin'`.           |
| `can_receive_stock_notifications` | `BOOLEAN`   | NULL     | Can this person receive notifications about low stock?                        |
| `can_receive_service_notifications`| `BOOLEAN`   | NULL     | Can this person receive notifications about maintenance tasks?              |
| `assigned_terminals_stock`      | `INTEGER[]` | NULL     | Array of `terminals.id` this person is responsible for restocking.            |
| `assigned_terminals_service`    | `INTEGER[]` | NULL     | Array of `terminals.id` this person is responsible for servicing.             |
| `timezone`                      | `VARCHAR`   | NULL     | The timezone of the service staff member (for future notification scheduling).|
| `created_at`                    | `TIMESTAMPTZ`| NULL     | Timestamp of when the access was granted.                                   |

```sql
CREATE TABLE IF NOT EXISTS public.user_access_rights (
    id SERIAL PRIMARY KEY,
    owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    shared_with_telegram_id BIGINT NOT NULL,
    shared_with_name VARCHAR(255) NOT NULL,
    access_level VARCHAR(50) NOT NULL DEFAULT 'admin',
    can_receive_stock_notifications BOOLEAN DEFAULT FALSE,
    can_receive_service_notifications BOOLEAN DEFAULT FALSE,
    assigned_terminals_stock INTEGER[],
    assigned_terminals_service INTEGER[],
    timezone VARCHAR(100),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (owner_user_id, shared_with_telegram_id)
);
```

---

## `terminals` Table
Stores information about coffee terminals (stands), linked to a user. This table acts as a local cache and the single source of truth for the application, synchronized with the Vendista API by a background worker.

| Column                     | Type        | Nullable | Description                                                                                             |
| -------------------------- | ----------- | -------- | ------------------------------------------------------------------------------------------------------- |
| `id` (PK)                  | `INTEGER`   | NOT NULL | Unique internal identifier for the terminal.                                                            |
| `user_id` (FK)             | `INTEGER`   | NOT NULL | References `users.id`, the owner of the terminal.                                                       |
| `vendista_terminal_id`     | `INTEGER`   | NOT NULL | The terminal's ID in the Vendista system. Used to link transactions.                                    |
| `name`                     | `VARCHAR`   | NULL     | The terminal's name (from the `comment` field in Vendista).                                             |
| `serial_number`            | `VARCHAR`   | NULL     | The machine's serial number.                                                                            |
| `last_online_time`         | `TIMESTAMPTZ`| NULL     | The last time the terminal was online, according to Vendista.                                           |
| `is_online`                | `BOOLEAN`   | NULL     | A calculated flag indicating if the terminal is currently online.                                       |
| `is_active`                | `BOOLEAN`   | NOT NULL | "Soft delete" flag. `false` if the terminal is removed from Vendista but kept in our DB for history.    |
| `last_synced_at`           | `TIMESTAMPTZ`| NULL     | Timestamp of the last successful data synchronization for this terminal by the worker.                  |
| `sales_since_cleaning`     | `INTEGER`   | NOT NULL | **Important**: A counter for sales made since the last 'cleaning' task. Reset to 0 when a cleaning task is completed. `DEFAULT: 0`. |
| `created_at`               | `TIMESTAMPTZ`| NOT NULL | Record creation timestamp.                                                                              |
| `updated_at`               | `TIMESTAMPTZ`| NOT NULL | Record last update timestamp.                                                                           |

```sql
CREATE TABLE IF NOT EXISTS public.terminals (
    id INTEGER NOT NULL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    vendista_terminal_id INTEGER NOT NULL,
    name VARCHAR(255),
    serial_number VARCHAR(100),
    last_online_time TIMESTAMPTZ,
    is_online BOOLEAN,
    is_active BOOLEAN NOT NULL DEFAULT true,
    last_synced_at TIMESTAMPTZ,
    sales_since_cleaning INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, vendista_terminal_id)
);
```

---

## `transactions` Table
Stores all financial transactions retrieved from Vendista. This is one of the largest tables in the database.

| Column           | Type        | Nullable | Description                                                           |
| ---------------- | ----------- | -------- | --------------------------------------------------------------------- |
| `id` (PK)        | `SERIAL`    | NOT NULL | Unique identifier for the transaction record in our database.         |
| `user_id` (FK)   | `INTEGER`   | NOT NULL | References `users.id`, the owner of the business.                     |
| `coffee_shop_id` | `INTEGER`   | NULL     | The `vendista_terminal_id` this transaction belongs to.               |
| `amount`         | `NUMERIC`   | NULL     | The transaction amount in cents (e.g., 15000 for 150.00 currency units).|
| `transaction_time`| `TIMESTAMPTZ`| NULL     | The exact timestamp of the transaction from Vendista.                 |
| `result`         | `VARCHAR`   | NULL     | Transaction result code from Vendista ('1' usually means success).    |
| `reverse_id`     | `INTEGER`   | NULL     | ID of the reversal transaction, if any. 0 if it's not a reversal.     |
| `terminal_comment`| `VARCHAR`   | NULL     | The terminal's name at the time of the transaction.                   |
| `machine_item_id`| `INTEGER`   | NULL     | The ID of the button/item sold on the machine. Links to `recipes`.    |
| `last_updated_at`| `TIMESTAMPTZ`| NULL     | When this record was last updated by our system.                      |

```sql
CREATE TABLE IF NOT EXISTS public.transactions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    coffee_shop_id INTEGER,
    amount NUMERIC,
    transaction_time TIMESTAMPTZ,
    result VARCHAR(255),
    reverse_id INTEGER,
    terminal_comment VARCHAR(255),
    card_number VARCHAR(32),
    status VARCHAR(64),
    bonus NUMERIC,
    left_sum NUMERIC,
    left_bonus NUMERIC,
    machine_item_id INTEGER,
    last_updated_at TIMESTAMPTZ DEFAULT now()
);
```

---

## `expenses` Table
Stores expenses manually entered by the user.

| Column       | Type        | Nullable | Description                                        |
| ------------ | ----------- | -------- | -------------------------------------------------- |
| `id` (PK)    | `SERIAL`    | NOT NULL | Unique identifier for the expense.                 |
| `user_id` (FK)| `INTEGER`   | NOT NULL | References `users.id`, the owner.                  |
| `amount`     | `NUMERIC`   | NOT NULL | The monetary value of the expense.                 |
| `comment`    | `TEXT`      | NULL     | A user-provided description of the expense.        |
| `expense_time`| `TIMESTAMPTZ`| NOT NULL | The date and time of the expense, set by the user. |

```sql
CREATE TABLE IF NOT EXISTS public.expenses (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    amount NUMERIC NOT NULL,
    comment TEXT,
    expense_time TIMESTAMPTZ NOT NULL
);
```

---

## `inventories` Table
Tracks ingredient and consumable stock levels at the central warehouse and in individual stands. This is the single source of truth for all stock management.

| Column          | Type          | Nullable | Description                                                                                                            |
| --------------- | ------------- | -------- | ---------------------------------------------------------------------------------------------------------------------- |
| `id` (PK)       | `SERIAL`      | NOT NULL | Unique identifier for the inventory record.                                                                            |
| `user_id` (FK)  | `INTEGER`     | NOT NULL | References `users.id`, the owner.                                                                                      |
| `terminal_id` (FK)| `INTEGER`     | NULL     | References `terminals.id`. `NULL` if the location is 'warehouse'.                                                      |
| `item_name`     | `VARCHAR`     | NOT NULL | The name of the ingredient or consumable (e.g., "Кофе", "Стаканы").                                                    |
| `location`      | `VARCHAR`     | NOT NULL | Where the item is stored. Either `'warehouse'` for the central warehouse or `'machine'` for a specific coffee stand.     |
| `current_stock` | `NUMERIC`     | NOT NULL | The current stock level. Conventionally stored in base units (grams, milliliters, pieces). `DEFAULT 0`.                  |
| `max_stock`     | `NUMERIC`     | NULL     | The maximum capacity for this item at this location. Used to calculate fullness percentage.                            |
| `critical_stock`| `NUMERIC`     | NULL     | The stock level at which a restock notification should be triggered.                                                   |
| `updated_at`    | `TIMESTAMPTZ` | NOT NULL | Timestamp of the last stock update. `DEFAULT now()`.                                                                   |

```sql
CREATE TABLE IF NOT EXISTS public.inventories (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    terminal_id INTEGER REFERENCES terminals(id) ON DELETE CASCADE,
    item_name VARCHAR(100) NOT NULL,
    location VARCHAR(50) NOT NULL, -- 'warehouse' or 'machine'
    current_stock NUMERIC(12,3) NOT NULL DEFAULT 0,
    max_stock NUMERIC(12,3),
    critical_stock NUMERIC(12,3),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, terminal_id, item_name, location)
);
```

---

## `recipes` Table
Defines drink recipes, linking a specific button on a terminal (`machine_item_id`) to a set of ingredients.

| Column          | Type        | Nullable | Description                                                                |
| --------------- | ----------- | -------- | -------------------------------------------------------------------------- |
| `id` (PK)       | `SERIAL`    | NOT NULL | Unique identifier for the recipe.                                          |
| `terminal_id` (FK)| `INTEGER`   | NOT NULL | References `terminals.id`. The terminal this recipe belongs to.            |
| `machine_item_id`| `INTEGER`   | NOT NULL | The ID of the button/item on the machine, from `transactions`.             |
| `name`          | `VARCHAR`   | NULL     | A user-friendly name for the drink (e.g., "Капучино").                     |
| `updated_at`    | `TIMESTAMPTZ`| NOT NULL | Timestamp of the last recipe update. `DEFAULT now()`.                      |

```sql
CREATE TABLE IF NOT EXISTS public.recipes (
    id SERIAL PRIMARY KEY,
    terminal_id INTEGER NOT NULL REFERENCES terminals(id) ON DELETE CASCADE,
    machine_item_id INTEGER NOT NULL,
    name VARCHAR(255),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (terminal_id, machine_item_id)
);
```

---

## `recipe_items` Table
A junction table specifying the ingredients and quantities required for each recipe.

| Column       | Type      | Nullable | Description                                                        |
| ------------ | --------- | -------- | ------------------------------------------------------------------ |
| `id` (PK)    | `SERIAL`  | NOT NULL | Unique identifier for the recipe item link.                        |
| `recipe_id` (FK)| `INTEGER` | NOT NULL | References `recipes.id`.                                           |
| `item_name`  | `VARCHAR` | NOT NULL | The name of the ingredient, linking to `inventories.item_name`.    |
| `quantity`   | `NUMERIC` | NOT NULL | The quantity of the ingredient used in the recipe, in base units.  |

```sql
CREATE TABLE IF NOT EXISTS public.recipe_items (
    id SERIAL PRIMARY KEY,
    recipe_id INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
    item_name VARCHAR(100) NOT NULL,
    quantity NUMERIC(10,3) NOT NULL DEFAULT 0,
    UNIQUE (recipe_id, item_name)
);
```

---

## `stand_service_settings` Table
Stores maintenance settings for each coffee stand, such as cleaning frequency and restock thresholds.

| Column             | Type        | Nullable | Description                                                                          |
| ------------------ | ----------- | -------- | ------------------------------------------------------------------------------------ |
| `id` (PK)          | `SERIAL`    | NOT NULL | Unique identifier for the settings record.                                           |
| `terminal_id` (FK, UQ)| `INTEGER` | NOT NULL | References `terminals.id`. Each terminal has only one settings record.               |
| `cleaning_frequency`| `INTEGER`   | NULL     | The number of sales after which a cleaning task should be generated.                 |
| `restock_thresholds`| `JSONB`     | NULL     | (Not currently in use) A JSON object defining specific restock thresholds per item.  |
| `assignee_ids`     | `BIGINT[]`  | NULL     | An array of `telegram_id`s of users assigned to service this terminal.               |

```sql
CREATE TABLE IF NOT EXISTS public.stand_service_settings (
    id SERIAL PRIMARY KEY,
    terminal_id INTEGER NOT NULL UNIQUE REFERENCES terminals(id) ON DELETE CASCADE,
    cleaning_frequency INTEGER CHECK (cleaning_frequency > 0),
    restock_thresholds JSONB,
    assignee_ids BIGINT[],
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

---

## `maintenance_tasks` Table
A log of system-generated maintenance tasks. This table appears to be a legacy or a more generic task system. The more specific `service_tasks` is currently used for cleaning and restocking.

| Column        | Type        | Nullable | Description                                                     |
| ------------- | ----------- | -------- | --------------------------------------------------------------- |
| `id` (PK)     | `SERIAL`    | NOT NULL | Unique identifier.                                              |
| `terminal_id` (FK)| `INTEGER` | NOT NULL | The associated terminal.                                        |
| `user_id` (FK)  | `INTEGER`   | NULL     | The owner of the terminal.                                      |
| `task_type`   | `VARCHAR`   | NOT NULL | The type of task (e.g., 'system_check').                        |
| `status`      | `VARCHAR`   | NOT NULL | The status of the task (e.g., 'new', 'completed'). `DEFAULT 'new'` |
| `description` | `TEXT`      | NULL     | A detailed description of the task.                             |
| `created_at`  | `TIMESTAMPTZ`| NOT NULL | When the task was created.                                      |
| `completed_at`| `TIMESTAMPTZ`| NULL     | When the task was completed.                                    |

```sql
CREATE TABLE IF NOT EXISTS public.maintenance_tasks (
    id SERIAL PRIMARY KEY,
    terminal_id INTEGER NOT NULL REFERENCES terminals(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES users(id),
    task_type VARCHAR(50) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'new',
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ
);
```

---

## `service_tasks` Table
A log of user-facing service tasks, specifically for **cleaning** and **restocking**. These tasks are generated both automatically (based on sales count) and manually by users.

| Column        | Type        | Nullable | Description                                                               |
| ------------- | ----------- | -------- | ------------------------------------------------------------------------- |
| `id` (PK)     | `SERIAL`    | NOT NULL | Unique identifier for the service task.                                   |
| `terminal_id` (FK)| `INTEGER` | NOT NULL | The terminal that requires service.                                       |
| `task_type`   | `VARCHAR`   | NOT NULL | `'cleaning'` or `'restock'`.                                              |
| `status`      | `VARCHAR`   | NOT NULL | `'pending'` or `'completed'`. `DEFAULT 'pending'`.                        |
| `details`     | `JSONB`     | NULL     | A JSON object for extra details (e.g., which items need restocking).      |
| `assignee_ids`| `BIGINT[]`  | NULL     | An array of `telegram_id`s of users assigned to this specific task.       |
| `created_at`  | `TIMESTAMPTZ`| NOT NULL | When the task was created.                                                |
| `completed_at`| `TIMESTAMPTZ`| NULL     | When the task was completed.                                              |

```sql
CREATE TABLE IF NOT EXISTS public.service_tasks (
    id SERIAL PRIMARY KEY,
    terminal_id INTEGER NOT NULL REFERENCES terminals(id) ON DELETE CASCADE,
    task_type VARCHAR(20) NOT NULL CHECK (task_type IN ('cleaning','restock')),
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','completed')),
    details JSONB,
    assignee_ids BIGINT[],
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ
);
```

---

## `worker_logs` Table
Logs the execution of background processes (workers), such as data imports from Vendista. Essential for debugging synchronization issues.

| Column          | Type        | Nullable | Description                                                             |
| --------------- | ----------- | -------- | ----------------------------------------------------------------------- |
| `id` (PK)       | `SERIAL`    | NOT NULL | Unique identifier for the log entry.                                    |
| `user_id` (FK)  | `INTEGER`   | NULL     | The user for whom the job was running.                                  |
| `job_name`      | `VARCHAR`   | NOT NULL | The name of the background job (e.g., '15-Min Import', 'Daily Update'). |
| `last_run_at`   | `TIMESTAMPTZ`| NULL     | When the job started.                                                   |
| `status`        | `VARCHAR`   | NULL     | The final status of the job run ('success', 'failure').                 |
| `processed_items`| `INTEGER`   | NULL     | Number of items the job attempted to process.                         |
| `added_items`   | `INTEGER`   | NULL     | Number of new records added to the database.                            |
| `updated_items` | `INTEGER`   | NULL     | Number of existing records updated.                                     |
| `error_message` | `TEXT`      | NULL     | The error message if the job failed.                                    |

```sql
CREATE TABLE IF NOT EXISTS public.worker_logs (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    job_name VARCHAR(100) NOT NULL,
    last_run_at TIMESTAMPTZ,
    status VARCHAR(50),
    processed_items INTEGER,
    added_items INTEGER,
    updated_items INTEGER,
    error_message TEXT,
    details TEXT
);
```