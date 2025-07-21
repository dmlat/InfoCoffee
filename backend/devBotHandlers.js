// backend/devBotHandlers.js
const { pool } = require('./db');

const DEV_MANUAL_MESSAGE = `
**🚀 Локальный запуск проекта**

1. Запускает контейнер с PostgreSQL:
\`docker-compose up -d\`

2. Запускает Backend и Frontend в dev-режиме:
\`npm run dev\`

- **Frontend (Owner)**: [http://localhost:3000/?role=owner](http://localhost:3000/?role=owner)
- **Frontend (Admin)**: [http://localhost:3000/?role=admin](http://localhost:3000/?role=admin)
- **Frontend (Service)**: [http://localhost:3000/?role=service](http://localhost:3000/?role=service)
- **Backend API**: [http://localhost:3001](http://localhost:3001)

---

**🛠️ Команды для ручных импортов**

*Команды нужно выполнять из корневой папки проекта. Копируй и вставляй в терминал*

Импорт транзакций за 30 дней для пользователя с ID=1:
\`node backend/worker/manual_runner.js import-transactions --user-id 1 --days 30\`

Синхронизация терминалов для пользователя с ID=1:
\`node backend/worker/manual_runner.js sync-terminals --user-id 1\`
`.trim();

module.exports = (bot) => {
    // --- Команды ---
    
    bot.onText(/\/dev_help/, (msg) => {
        bot.sendMessage(msg.chat.id, DEV_MANUAL_MESSAGE, { parse_mode: 'Markdown' });
    });

    bot.onText(/\/dev_reset_db/, (msg) => {
        const chatId = msg.chat.id;
        bot.sendMessage(chatId,
            '⚠️ *Вы уверены, что хотите полностью очистить локальную базу данных?*\\n\\nЭто действие необратимо и удалит всех пользователей, транзакции, инвентарь и т.д.', {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🔴 Да, я уверен, удалить всё', callback_data: 'dev_confirm_db_reset' }],
                        [{ text: '🟢 Отмена', callback_data: 'main_menu' }]
                    ]
                }
            }
        );
    });

    bot.onText(/\/dev_setup_test_users/, async (msg) => {
        const chatId = msg.chat.id;
        try {
            // 1. Найти основного пользователя (владельца)
            const ownerRes = await pool.query('SELECT id FROM users ORDER BY id LIMIT 1');
            if (ownerRes.rows.length === 0) {
                bot.sendMessage(chatId, '❌ Владелец не найден. Сначала зарегистрируйтесь в приложении.');
                return;
            }
            const ownerId = ownerRes.rows[0].id;

            // 2. Определить тестовых пользователей
            const testUsers = [
                { telegramId: 1000000001, name: 'Тестовый Админ', level: 'admin' },
                { telegramId: 1000000002, name: 'Тестовый Обслуживание', level: 'service' }
            ];

            // 3. Добавить или обновить права доступа для тестовых пользователей
            const client = await pool.connect();
            try {
                await client.query('BEGIN');
                for (const user of testUsers) {
                    const query = `
                        INSERT INTO user_access_rights (owner_user_id, shared_with_telegram_id, shared_with_name, access_level)
                        VALUES ($1, $2, $3, $4)
                        ON CONFLICT (owner_user_id, shared_with_telegram_id)
                        DO UPDATE SET shared_with_name = EXCLUDED.shared_with_name, access_level = EXCLUDED.access_level;
                    `;
                    await client.query(query, [ownerId, user.telegramId, user.name, user.level]);
                }
                await client.query('COMMIT');
            } catch (e) {
                await client.query('ROLLBACK');
                throw e;
            } finally {
                client.release();
            }

            bot.sendMessage(chatId, '✅ Тестовые пользователи "admin" и "service" успешно созданы и привязаны к вашему аккаунту.');

        } catch (err) {
            console.error('[DEV] Test users setup failed:', err);
            bot.sendMessage(chatId, `❌ Ошибка при создании тестовых пользователей:\n\n<pre><code>${err.message}</code></pre>`, { parse_mode: 'HTML' });
        }
    });

    // --- Обработчик кнопок ---

    bot.on('callback_query', async (query) => {
        const { data, message } = query;
        
        if (data !== 'dev_confirm_db_reset') {
            return; // Игнорируем колбэки, не относящиеся к этому модулю
        }
        
        const chatId = message.chat.id;
        const messageId = message.message_id;

        const TABLES_TO_TRUNCATE = [
            "users", "user_access_rights", "terminals", "transactions", "expenses",
            "inventories", "recipes", "recipe_items", "stand_service_settings",
            "maintenance_tasks", "service_tasks", "worker_logs"
        ];
        const truncateQuery = `TRUNCATE TABLE ${TABLES_TO_TRUNCATE.join(', ')} RESTART IDENTITY CASCADE;`;

        try {
            await pool.query(truncateQuery);
            await bot.editMessageText('✅ База данных успешно очищена.', { chat_id: chatId, message_id: messageId });
            console.log(`[DEV] Database has been reset by user ${query.from.id}.`);
            await bot.answerCallbackQuery(query.id, { text: 'База данных очищена!', show_alert: true });
        } catch (err) {
            console.error('[DEV] DB Reset failed:', err);
            await bot.editMessageText(`❌ Ошибка при очистке базы данных:\\n\\n<pre><code>${err.message}</code></pre>`, { chat_id: chatId, message_id: messageId, parse_mode: 'HTML' });
            await bot.answerCallbackQuery(query.id, { text: 'Ошибка при сбросе БД.', show_alert: true });
        }
    });
}; 