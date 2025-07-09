# Database Schema for "coffee_dashboard"

This document describes the current PostgreSQL database schema used in the InfoCoffee Analytics project. The schema consists of 12 tables responsible for storing data about users, transactions, expenses, inventory, and system logs.

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
Stores basic information about application users. The primary user record is created upon registration and linked to a Telegram account.

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
    registration_date TIMESTAMPTZ DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_users_telegram_id ON public.users(telegram_id);
```

---

## `user_access_rights` Table
Defines the access rights of one user to another's data, enabling delegated access for admins or service personnel.

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
A list of coffee stands (terminals) linked to a user.

```sql
CREATE TABLE IF NOT EXISTS public.terminals (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    vendista_terminal_id INTEGER NOT NULL,
    name VARCHAR(255),
    serial_number VARCHAR(100),
    last_online_time TIMESTAMPTZ,
    is_online BOOLEAN DEFAULT FALSE,
    service_interval_sales INTEGER,
    sales_since_last_service INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, vendista_terminal_id)
);

CREATE INDEX IF NOT EXISTS idx_terminals_user_id ON public.terminals(user_id);
```

---

## `transactions` Table
Stores all transactions retrieved from Vendista.

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
*Note: The `id` column in this table was changed from a plain integer to `SERIAL PRIMARY KEY` to ensure uniqueness and auto-incrementing behavior.*

---

## `expenses` Table
Stores expenses manually entered by the user.

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
Tracks ingredient and consumable stock levels at the central warehouse and in individual stands.

```sql
CREATE TABLE IF NOT EXISTS public.inventories (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    terminal_id INTEGER REFERENCES terminals(id) ON DELETE CASCADE,
    item_name VARCHAR(100) NOT NULL,
    location VARCHAR(50) NOT NULL,
    current_stock NUMERIC(12,3) NOT NULL DEFAULT 0,
    max_stock NUMERIC(12,3),
    critical_stock NUMERIC(12,3),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, terminal_id, item_name, location)
);

CREATE INDEX IF NOT EXISTS idx_inventories_user_location ON public.inventories(user_id, location);
```

---

## `recipes` Table
Defines drink recipes linked to specific buttons (`machine_item_id`) on a terminal.

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
Specifies the ingredients and quantities required for each recipe.

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
Stores maintenance settings for each coffee stand.

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

CREATE INDEX IF NOT EXISTS idx_stand_service_settings_terminal_id ON public.stand_service_settings(terminal_id);
```

---

## `maintenance_tasks` Table
A log of system-generated maintenance tasks.

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
A log of service tasks (cleaning, restocking).

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

CREATE INDEX IF NOT EXISTS idx_service_tasks_status ON public.service_tasks(status);
CREATE INDEX IF NOT EXISTS idx_service_tasks_task_type ON public.service_tasks(task_type);
CREATE INDEX IF NOT EXISTS idx_service_tasks_terminal_id ON public.service_tasks(terminal_id);
```

---

## `worker_logs` Table
Logs background processes, such as data imports from Vendista.

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

CREATE INDEX IF NOT EXISTS idx_worker_logs_job_name ON public.worker_logs(job_name);
CREATE INDEX IF NOT EXISTS idx_worker_logs_last_run_at ON public.worker_logs(last_run_at);
CREATE INDEX IF NOT EXISTS idx_worker_logs_user_id ON public.worker_logs(user_id);
```
```