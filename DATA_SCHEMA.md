### **Файл: `DATABASE_SCHEMA.md`**

# Структура базы данных "coffee_dashboard"

Этот документ описывает актуальную схему базы данных PostgreSQL, используемую в проекте InfoCoffee Analytics. Схема включает 12 таблиц, отвечающих за хранение данных о пользователях, транзакциях, расходах, инвентаре и системных логах.

### Содержание
1.  [Таблица `users`](#таблица-users)
2.  [Таблица `user_access_rights`](#таблица-user_access_rights)
3.  [Таблица `terminals`](#таблица-terminals)
4.  [Таблица `transactions`](#таблица-transactions)
5.  [Таблица `expenses`](#таблица-expenses)
6.  [Таблица `inventories`](#таблица-inventories)
7.  [Таблица `recipes`](#таблица-recipes)
8.  [Таблица `recipe_items`](#таблица-recipe_items)
9.  [Таблица `stand_service_settings`](#таблица-stand_service_settings)
10. [Таблица `maintenance_tasks`](#таблица-maintenance_tasks)
11. [Таблица `service_tasks`](#таблица-service_tasks)
12. [Таблица `worker_logs`](#таблица-worker_logs)

---

## Таблица `users`
Хранит основную информацию о пользователях приложения.

```sql
CREATE TABLE IF NOT EXISTS public.users
(
    id integer NOT NULL DEFAULT nextval('users_id_seq'::regclass),
    telegram_id bigint,
    vendista_api_token text COLLATE pg_catalog."default",
    name character varying(255) COLLATE pg_catalog."default",
    first_name character varying(255) COLLATE pg_catalog."default",
    last_name character varying(255) COLLATE pg_catalog."default",
    user_name character varying(255) COLLATE pg_catalog."default",
    language_code character varying(10) COLLATE pg_catalog."default",
    photo_url text COLLATE pg_catalog."default",
    setup_date date,
    tax_system character varying(32) COLLATE pg_catalog."default",
    acquiring numeric,
    registration_date timestamp with time zone,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT users_pkey PRIMARY KEY (id),
    CONSTRAINT users_telegram_id_key UNIQUE (telegram_id)
);

CREATE INDEX IF NOT EXISTS idx_users_telegram_id
    ON public.users USING btree
    (telegram_id ASC NULLS LAST);
````

-----

## Таблица `user_access_rights`

Определяет права доступа одних пользователей к данным других.

```sql
CREATE TABLE IF NOT EXISTS public.user_access_rights
(
    id integer NOT NULL DEFAULT nextval('user_access_rights_id_seq'::regclass),
    owner_user_id integer NOT NULL,
    shared_with_telegram_id bigint NOT NULL,
    shared_with_name character varying(255) COLLATE pg_catalog."default" NOT NULL,
    access_level character varying(50) COLLATE pg_catalog."default" NOT NULL DEFAULT 'admin'::character varying,
    can_receive_stock_notifications boolean DEFAULT false,
    can_receive_service_notifications boolean DEFAULT false,
    assigned_terminals_stock integer[],
    assigned_terminals_service integer[],
    timezone character varying(100) COLLATE pg_catalog."default",
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT user_access_rights_pkey PRIMARY KEY (id),
    CONSTRAINT user_access_rights_owner_user_id_shared_with_telegram_id_key UNIQUE (owner_user_id, shared_with_telegram_id),
    CONSTRAINT user_access_rights_owner_user_id_fkey FOREIGN KEY (owner_user_id)
        REFERENCES public.users (id) MATCH SIMPLE
        ON UPDATE NO ACTION
        ON DELETE CASCADE
);
```

-----

## Таблица `terminals`

Список кофейных стоек (терминалов), привязанных к пользователю.

```sql
CREATE TABLE IF NOT EXISTS public.terminals
(
    id integer NOT NULL DEFAULT nextval('terminals_id_seq'::regclass),
    user_id integer NOT NULL,
    vendista_terminal_id integer NOT NULL,
    name character varying(255) COLLATE pg_catalog."default",
    serial_number character varying(100) COLLATE pg_catalog."default",
    last_online_time timestamp with time zone,
    is_online boolean DEFAULT false,
    service_interval_sales integer,
    sales_since_last_service integer DEFAULT 0,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT terminals_pkey PRIMARY KEY (id),
    CONSTRAINT terminals_user_id_vendista_terminal_id_key UNIQUE (user_id, vendista_terminal_id),
    CONSTRAINT terminals_user_id_fkey FOREIGN KEY (user_id)
        REFERENCES public.users (id) MATCH SIMPLE
        ON UPDATE NO ACTION
        ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_terminals_user_id
    ON public.terminals USING btree
    (user_id ASC NULLS LAST);
```

-----

## Таблица `transactions`

Хранит все транзакции, полученные из Vendista.

```sql
CREATE TABLE IF NOT EXISTS public.transactions
(
    id integer NOT NULL,
    user_id integer NOT NULL,
    coffee_shop_id integer,
    amount numeric,
    transaction_time timestamp with time zone,
    result character varying(255) COLLATE pg_catalog."default",
    reverse_id integer,
    terminal_comment character varying(255) COLLATE pg_catalog."default",
    card_number character varying(32) COLLATE pg_catalog."default",
    status character varying(64) COLLATE pg_catalog."default",
    bonus numeric,
    left_sum numeric,
    left_bonus numeric,
    machine_item_id integer,
    last_updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT transactions_pkey PRIMARY KEY (id),
    CONSTRAINT transactions_user_id_fkey FOREIGN KEY (user_id)
        REFERENCES public.users (id) MATCH SIMPLE
        ON UPDATE NO ACTION
        ON DELETE CASCADE
);
```

-----

## Таблица `expenses`

Расходы, введенные пользователем вручную.

```sql
CREATE TABLE IF NOT EXISTS public.expenses
(
    id integer NOT NULL DEFAULT nextval('expenses_id_seq'::regclass),
    user_id integer NOT NULL,
    amount numeric NOT NULL,
    comment text COLLATE pg_catalog."default",
    expense_time timestamp with time zone NOT NULL,
    CONSTRAINT expenses_pkey PRIMARY KEY (id),
    CONSTRAINT expenses_user_id_fkey FOREIGN KEY (user_id)
        REFERENCES public.users (id) MATCH SIMPLE
        ON UPDATE NO ACTION
        ON DELETE CASCADE
);
```

-----

## Таблица `inventories`

Остатки ингредиентов и расходников на центральном складе (`location` = 'warehouse') и в стойках (`location` = 'stand' / 'machine').

```sql
CREATE TABLE IF NOT EXISTS public.inventories
(
    id integer NOT NULL DEFAULT nextval('inventories_id_seq'::regclass),
    user_id integer NOT NULL,
    terminal_id integer,
    item_name character varying(100) COLLATE pg_catalog."default" NOT NULL,
    location character varying(50) COLLATE pg_catalog."default" NOT NULL,
    current_stock numeric(12,3) NOT NULL DEFAULT 0,
    max_stock numeric(12,3),
    critical_stock numeric(12,3),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT inventories_pkey PRIMARY KEY (id),
    CONSTRAINT inventories_user_id_terminal_id_item_name_location_key UNIQUE (user_id, terminal_id, item_name, location),
    CONSTRAINT inventories_terminal_id_fkey FOREIGN KEY (terminal_id)
        REFERENCES public.terminals (id) MATCH SIMPLE
        ON UPDATE NO ACTION
        ON DELETE CASCADE,
    CONSTRAINT inventories_user_id_fkey FOREIGN KEY (user_id)
        REFERENCES public.users (id) MATCH SIMPLE
        ON UPDATE NO ACTION
        ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_inventories_user_location
    ON public.inventories USING btree
    (user_id ASC NULLS LAST, location COLLATE pg_catalog."default" ASC NULLS LAST);
```

-----

## Таблица `recipes`

Рецепты напитков, привязанные к конкретным кнопкам (`machine_item_id`) на терминале.

```sql
CREATE TABLE IF NOT EXISTS public.recipes
(
    id integer NOT NULL DEFAULT nextval('recipes_id_seq'::regclass),
    terminal_id integer NOT NULL,
    machine_item_id integer NOT NULL,
    name character varying(255) COLLATE pg_catalog."default",
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT recipes_pkey PRIMARY KEY (id),
    CONSTRAINT recipes_terminal_id_machine_item_id_key UNIQUE (terminal_id, machine_item_id),
    CONSTRAINT recipes_terminal_id_fkey FOREIGN KEY (terminal_id)
        REFERENCES public.terminals (id) MATCH SIMPLE
        ON UPDATE NO ACTION
        ON DELETE CASCADE
);
```

-----

## Таблица `recipe_items`

Состав каждого рецепта: список ингредиентов и их количество для списания.

```sql
CREATE TABLE IF NOT EXISTS public.recipe_items
(
    id integer NOT NULL DEFAULT nextval('recipe_items_id_seq'::regclass),
    recipe_id integer NOT NULL,
    item_name character varying(100) COLLATE pg_catalog."default" NOT NULL,
    quantity numeric(10,3) NOT NULL DEFAULT 0,
    CONSTRAINT recipe_items_pkey PRIMARY KEY (id),
    CONSTRAINT recipe_items_recipe_id_item_name_key UNIQUE (recipe_id, item_name),
    CONSTRAINT recipe_items_recipe_id_fkey FOREIGN KEY (recipe_id)
        REFERENCES public.recipes (id) MATCH SIMPLE
        ON UPDATE NO ACTION
        ON DELETE CASCADE
);
```

-----

## Таблица `stand_service_settings`

Настройки обслуживания для каждой торговой точки (стойки).

```sql
CREATE TABLE IF NOT EXISTS public.stand_service_settings
(
    id integer NOT NULL DEFAULT nextval('stand_service_settings_id_seq'::regclass),
    terminal_id integer NOT NULL,
    cleaning_frequency integer,
    restock_thresholds jsonb,
    assignee_ids bigint[],
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT stand_service_settings_pkey PRIMARY KEY (id),
    CONSTRAINT stand_service_settings_terminal_id_key UNIQUE (terminal_id),
    CONSTRAINT stand_service_settings_terminal_id_fkey FOREIGN KEY (terminal_id)
        REFERENCES public.terminals (id) MATCH SIMPLE
        ON UPDATE NO ACTION
        ON DELETE CASCADE,
    CONSTRAINT stand_service_settings_cleaning_frequency_check CHECK (cleaning_frequency > 0)
);

CREATE INDEX IF NOT EXISTS idx_stand_service_settings_terminal_id
    ON public.stand_service_settings USING btree
    (terminal_id ASC NULLS LAST);

CREATE OR REPLACE TRIGGER set_stand_service_settings_updated_at
    BEFORE UPDATE 
    ON public.stand_service_settings
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

COMMENT ON TABLE public.stand_service_settings
    IS 'Настройки обслуживания для каждой торговой точки (стойки)';
```

-----

## Таблица `maintenance_tasks`

Журнал задач на обслуживание, созданных системой.

```sql
CREATE TABLE IF NOT EXISTS public.maintenance_tasks
(
    id integer NOT NULL DEFAULT nextval('maintenance_tasks_id_seq'::regclass),
    terminal_id integer NOT NULL,
    user_id integer,
    task_type character varying(50) COLLATE pg_catalog."default" NOT NULL,
    status character varying(50) COLLATE pg_catalog."default" NOT NULL DEFAULT 'new'::character varying,
    description text COLLATE pg_catalog."default",
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    completed_at timestamp with time zone,
    CONSTRAINT maintenance_tasks_pkey PRIMARY KEY (id),
    CONSTRAINT maintenance_tasks_terminal_id_fkey FOREIGN KEY (terminal_id)
        REFERENCES public.terminals (id) MATCH SIMPLE
        ON UPDATE NO ACTION
        ON DELETE CASCADE,
    CONSTRAINT maintenance_tasks_user_id_fkey FOREIGN KEY (user_id)
        REFERENCES public.users (id) MATCH SIMPLE
        ON UPDATE NO ACTION
        ON DELETE CASCADE
);
```

-----

## Таблица `service_tasks`

Журнал задач на обслуживание (чистка, пополнение).

```sql
CREATE TABLE IF NOT EXISTS public.service_tasks
(
    id integer NOT NULL DEFAULT nextval('service_tasks_id_seq'::regclass),
    terminal_id integer NOT NULL,
    task_type character varying(20) COLLATE pg_catalog."default" NOT NULL,
    status character varying(20) COLLATE pg_catalog."default" NOT NULL DEFAULT 'pending'::character varying,
    details jsonb,
    assignee_ids bigint[],
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    completed_at timestamp with time zone,
    CONSTRAINT service_tasks_pkey PRIMARY KEY (id),
    CONSTRAINT service_tasks_terminal_id_fkey FOREIGN KEY (terminal_id)
        REFERENCES public.terminals (id) MATCH SIMPLE
        ON UPDATE NO ACTION
        ON DELETE CASCADE,
    CONSTRAINT service_tasks_task_type_check CHECK (task_type::text = ANY (ARRAY['cleaning'::character varying, 'restock'::character varying]::text[])),
    CONSTRAINT service_tasks_status_check CHECK (status::text = ANY (ARRAY['pending'::character varying, 'completed'::character varying]::text[]))
);

CREATE INDEX IF NOT EXISTS idx_service_tasks_status ON public.service_tasks(status);
CREATE INDEX IF NOT EXISTS idx_service_tasks_task_type ON public.service_tasks(task_type);
CREATE INDEX IF NOT EXISTS idx_service_tasks_terminal_id ON public.service_tasks(terminal_id);

COMMENT ON TABLE public.service_tasks
    IS 'Журнал задач на обслуживание (чистка, пополнение)';
```

-----

## Таблица `worker_logs`

Логи фоновых процессов (например, импорт транзакций из Vendista).

```sql
CREATE TABLE IF NOT EXISTS public.worker_logs
(
    id integer NOT NULL DEFAULT nextval('worker_logs_id_seq'::regclass),
    user_id integer,
    job_name character varying(100) COLLATE pg_catalog."default" NOT NULL,
    last_run_at timestamp with time zone,
    status character varying(50) COLLATE pg_catalog."default",
    processed_items integer,
    added_items integer,
    updated_items integer,
    error_message text COLLATE pg_catalog."default",
    details text COLLATE pg_catalog."default",
    CONSTRAINT worker_logs_pkey PRIMARY KEY (id),
    CONSTRAINT worker_logs_user_id_fkey FOREIGN KEY (user_id)
        REFERENCES public.users (id) MATCH SIMPLE
        ON UPDATE NO ACTION
        ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_worker_logs_job_name ON public.worker_logs(job_name);
CREATE INDEX IF NOT EXISTS idx_worker_logs_last_run_at ON public.worker_logs(last_run_at);
CREATE INDEX IF NOT EXISTS idx_worker_logs_user_id ON public.worker_logs(user_id);
```

```
```