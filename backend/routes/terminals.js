// backend/routes/terminals.js
const express = require('express');
const router = express.Router();
const pool = require('../db');
const authMiddleware = require('../middleware/auth');
const { sendErrorToAdmin } = require('../utils/adminErrorNotifier');

// --- ГЛАВНЫЙ ЭНДПОИНТ: Получение списка всех активных терминалов ---
// Данные берутся из нашей локальной базы данных, которая синхронизируется воркером.
router.get('/', authMiddleware, async (req, res) => {
    const { ownerUserId } = req.user;

    try {
        const result = await pool.query(
            `WITH terminal_configs AS (
                SELECT
                    t.id,
                    -- Проверка конфигурации контейнеров: есть ли хоть один айтем без заданного max_stock > 0
                    COUNT(i.item_name) FILTER (WHERE i.location = 'machine' AND (i.max_stock IS NULL OR i.max_stock <= 0)) > 0 AS needs_containers_config,
                    -- Проверка конфигурации рецептов: количество напитков в транзакциях больше, чем настроенных рецептов
                    (SELECT COUNT(DISTINCT tr.machine_item_id) FROM transactions tr WHERE tr.coffee_shop_id = t.vendista_terminal_id AND tr.user_id = t.user_id AND tr.machine_item_id IS NOT NULL) > 
                    (SELECT COUNT(r.id) FROM recipes r WHERE r.terminal_id = t.id) AS needs_recipes_config,
                    -- Агрегируем минимальные остатки для главного экрана
                    MIN(CASE WHEN i.item_name = 'Вода' THEN i.current_stock / NULLIF(i.max_stock, 0) END) as water_level,
                    MIN(CASE WHEN i.item_name = ANY(ARRAY['Кофе', 'Сливки', 'Какао', 'Раф']) THEN i.current_stock / NULLIF(i.max_stock, 0) END) as grams_level,
                    MIN(CASE WHEN i.item_name = ANY(ARRAY['Стаканы', 'Крышки', 'Размеш.', 'Сахар', 'Трубочки']) THEN i.current_stock / NULLIF(i.max_stock, 0) END) as pieces_level
                FROM terminals t
                LEFT JOIN inventories i ON t.id = i.terminal_id
                WHERE t.user_id = $1 AND t.is_active = true
                GROUP BY t.id
            )
            SELECT 
                t.id, 
                t.vendista_terminal_id, 
                t.name, 
                t.serial_number, 
                t.last_online_time, 
                t.is_online,
                COALESCE(tc.needs_containers_config, true) AS needs_containers_config,
                COALESCE(tc.needs_recipes_config, false) AS needs_recipes_config,
                jsonb_build_object(
                    'water', jsonb_build_object('level', tc.water_level),
                    'grams', jsonb_build_object('level', tc.grams_level),
                    'pieces', jsonb_build_object('level', tc.pieces_level)
                ) as stock_summary
             FROM terminals t
             LEFT JOIN terminal_configs tc ON t.id = tc.id
             WHERE t.user_id = $1 AND t.is_active = true 
             ORDER BY t.name ASC`,
            [ownerUserId]
        );
        res.json({ success: true, terminals: result.rows });
    } catch (err) {
        console.error(`[GET /api/terminals] UserID: ${ownerUserId} - Error:`, err);
        sendErrorToAdmin({
            userId: ownerUserId, 
            errorContext: 'GET /api/terminals', 
            errorMessage: err.message, 
            errorStack: err.stack
        }).catch(console.error);
        res.status(500).json({ success: false, error: 'Ошибка сервера при получении списка стоек' });
    }
});


// --- ЭНДПОИНТЫ ДЛЯ УПРАВЛЕНИЯ НАСТРОЙКАМИ КОНКРЕТНОГО ТЕРМИНАЛА ---

// Получить настройки (остатки/инвентарь) для терминала по его ID из НАШЕЙ БД
router.get('/:internalId/settings', authMiddleware, async (req, res) => {
    const { ownerUserId } = req.user;
    const { internalId } = req.params;

    try {
        // Проверяем, что терминал принадлежит пользователю
        const termCheck = await pool.query('SELECT id FROM terminals WHERE id = $1 AND user_id = $2', [internalId, ownerUserId]);
        if (termCheck.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Терминал не найден или у вас нет к нему доступа.' });
        }

        const inventoryRes = await pool.query(
            "SELECT item_name, location, current_stock, max_stock, critical_stock FROM inventories WHERE user_id = $1 AND terminal_id = $2 ORDER BY item_name",
            [ownerUserId, internalId]
        );
        
        res.json({ success: true, settings: inventoryRes.rows });
    } catch (err) {
        console.error(`[GET /api/terminals/:id/settings] UserID: ${ownerUserId} - Error:`, err);
        sendErrorToAdmin({
            userId: ownerUserId, errorContext: `GET /api/terminals/${internalId}/settings`,
            errorMessage: err.message, errorStack: err.stack,
        }).catch(console.error);
        res.status(500).json({ success: false, error: 'Ошибка сервера при получении настроек.' });
    }
});

// Сохранить/обновить настройки остатков для терминала по его ID из НАШЕЙ БД
router.post('/:internalId/settings', authMiddleware, async (req, res) => {
    const { ownerUserId } = req.user;
    const { internalId } = req.params;
    const { inventorySettings } = req.body; 

    if (!Array.isArray(inventorySettings)) {
        return res.status(400).json({ success: false, error: 'Неверный формат данных' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Проверяем, что терминал принадлежит пользователю
        const termCheck = await client.query('SELECT id FROM terminals WHERE id = $1 AND user_id = $2', [internalId, ownerUserId]);
        if (termCheck.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, error: 'Терминал не найден или у вас нет к нему доступа.' });
        }

        for (const item of inventorySettings) {
            const { item_name, location, max_stock, critical_stock } = item;
            if (!item_name || !location) continue;

            const max = max_stock !== null && !isNaN(parseFloat(max_stock)) ? parseFloat(max_stock) : null;
            const critical = critical_stock !== null && !isNaN(parseFloat(critical_stock)) ? parseFloat(critical_stock) : null;

            await client.query(
                `INSERT INTO inventories (user_id, terminal_id, item_name, location, max_stock, critical_stock)
                 VALUES ($1, $2, $3, $4, $5, $6)
                 ON CONFLICT (user_id, terminal_id, item_name, location) 
                 DO UPDATE SET
                    max_stock = EXCLUDED.max_stock,
                    critical_stock = EXCLUDED.critical_stock,
                    updated_at = NOW()`,
                [ownerUserId, internalId, item_name, location, max, critical]
            );
        }

        await client.query('COMMIT');
        res.json({ success: true, message: 'Настройки успешно сохранены!' });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error(`[POST /api/terminals/:id/settings] UserID: ${ownerUserId} - Error:`, err);
        sendErrorToAdmin({
            userId: ownerUserId, errorContext: `POST /api/terminals/${internalId}/settings`,
            errorMessage: err.message, errorStack: err.stack,
        }).catch(console.error);
        res.status(500).json({ success: false, error: 'Ошибка сервера при сохранении настроек.' });
    } finally {
        client.release();
    }
});


// --- ЭНДПОИНТЫ ДЛЯ МАССОВЫХ ОПЕРАЦИЙ ---

// Копирование настроек контейнеров
router.post('/copy-settings', authMiddleware, async (req, res) => {
    const { ownerUserId } = req.user;
    const { sourceInternalId, destinationInternalIds } = req.body;

    if (!sourceInternalId || !Array.isArray(destinationInternalIds) || destinationInternalIds.length === 0) {
        return res.status(400).json({ success: false, error: 'Необходимы ID исходного и целевых терминалов.' });
    }
    
    const allTerminalIds = [sourceInternalId, ...destinationInternalIds];

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        const ownerCheck = await client.query(
            'SELECT id FROM terminals WHERE id = ANY($1::int[]) AND user_id = $2',
            [allTerminalIds, ownerUserId]
        );

        if (ownerCheck.rowCount !== allTerminalIds.length) {
            await client.query('ROLLBACK');
            return res.status(403).json({ success: false, error: 'Доступ к одному или нескольким терминалам запрещен.' });
        }
        
        const sourceSettingsRes = await client.query(
            `SELECT item_name, max_stock, critical_stock FROM inventories 
             WHERE terminal_id = $1 AND location = 'machine'`,
            [sourceInternalId]
        );
        const sourceSettings = sourceSettingsRes.rows;

        if (sourceSettings.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, error: 'У исходного терминала нет настроек контейнеров для копирования.' });
        }
        
        for (const destId of destinationInternalIds) {
            for (const setting of sourceSettings) {
                await client.query(
                    `INSERT INTO inventories (user_id, terminal_id, item_name, location, max_stock, critical_stock, updated_at)
                     VALUES ($1, $2, $3, 'machine', $4, $5, NOW())
                     ON CONFLICT (user_id, terminal_id, item_name, location) DO UPDATE SET
                        max_stock = EXCLUDED.max_stock,
                        critical_stock = EXCLUDED.critical_stock,
                        updated_at = NOW()`,
                    [ownerUserId, destId, setting.item_name, setting.max_stock, setting.critical_stock]
                );
            }
        }

        await client.query('COMMIT');
        res.json({ success: true, message: `Настройки успешно скопированы в ${destinationInternalIds.length} стойки.` });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error(`[POST /copy-settings] UserID: ${ownerUserId} - Error:`, err);
        sendErrorToAdmin({
             userId: ownerUserId, errorContext: `POST /copy-settings`, errorMessage: err.message, errorStack: err.stack,
        }).catch(console.error);
        res.status(500).json({ success: false, error: 'Ошибка сервера при копировании настроек.' });
    } finally {
        client.release();
    }
});

// Получить уникальные ID кнопок (напитков) для терминала из транзакций
router.get('/:internalId/machine-items', authMiddleware, async (req, res) => {
    const { ownerUserId } = req.user;
    const { internalId } = req.params;

    try {
        // Сначала убедимся, что терминал принадлежит этому пользователю, чтобы не утекали чужие данные
        const terminalCheck = await pool.query('SELECT vendista_terminal_id FROM terminals WHERE id = $1 AND user_id = $2', [internalId, ownerUserId]);
        if (terminalCheck.rowCount === 0) {
            return res.status(404).json({ success: false, error: 'Терминал не найден.' });
        }
        const vendistaId = terminalCheck.rows[0].vendista_terminal_id;

        const itemsRes = await pool.query(
            `SELECT DISTINCT machine_item_id FROM transactions
             WHERE user_id = $1 AND coffee_shop_id = $2 AND machine_item_id IS NOT NULL
             ORDER BY machine_item_id ASC`,
            [ownerUserId, vendistaId]
        );
        res.json({ success: true, machineItems: itemsRes.rows.map(row => row.machine_item_id) });
    } catch(err) {
        console.error(`[GET /api/terminals/:id/machine-items] UserID: ${ownerUserId} - Error:`, err);
        sendErrorToAdmin({
            userId: ownerUserId, errorContext: `GET /api/terminals/${internalId}/machine-items`,
            errorMessage: err.message, errorStack: err.stack,
        }).catch(console.error);
        res.status(500).json({ success: false, error: 'Ошибка сервера при получении списка напитков' });
    }
});


module.exports = router;