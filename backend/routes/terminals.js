// backend/routes/terminals.js
const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const pool = require('../db');
const axios = require('axios');
const { sendErrorToAdmin } = require('../utils/adminErrorNotifier');
const crypto = require('crypto');

const GRAM_ITEMS = ['Кофе', 'Сливки', 'Какао', 'Раф'];
const PIECE_ITEMS = ['Стаканы', 'Крышки', 'Размеш.', 'Сахар', 'Трубочки'];
const ALL_MACHINE_ITEMS = [...GRAM_ITEMS, 'Вода', ...PIECE_ITEMS];


const VENDISTA_API_URL = process.env.VENDISTA_API_URL || 'https://api.vendista.ru:99';
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;
const ALGORITHM = 'aes-256-cbc';

function decrypt(text) {
    if (!ENCRYPTION_KEY) {
        console.error('ENCRYPTION_KEY is not set. Cannot decrypt.');
        throw new Error('Encryption key not set for decrypt function.');
    }
    if (!text || typeof text !== 'string' || !text.includes(':')) {
        console.error('Invalid text format for decryption:', text);
        return null;
    }
    try {
        const key = Buffer.from(ENCRYPTION_KEY, 'hex');
        const textParts = text.split(':');
        const iv = Buffer.from(textParts.shift(), 'hex');
        const encryptedText = Buffer.from(textParts.join(':'), 'hex');
        const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
        let decrypted = decipher.update(encryptedText);
        decrypted = Buffer.concat([decrypted, decipher.final()]);
        return decrypted.toString('utf8');
    } catch (error) {
        console.error('Decryption failed:', error);
        return null;
    }
}

// --- ИЗМЕНЕННАЯ ФУНКЦИЯ ---
// Вспомогательная функция для поиска или создания терминала в нашей БД
async function findOrCreateTerminal(client, ownerUserId, vendistaId, details = {}) {
    // Сначала пытаемся просто найти существующий терминал
    let terminalRes = await client.query('SELECT id FROM terminals WHERE vendista_terminal_id = $1 AND user_id = $2', [vendistaId, ownerUserId]);

    if (terminalRes.rows.length > 0) {
        return terminalRes.rows[0].id;
    }

    // Если не нашли, то пытаемся создать, используя ON CONFLICT для безопасности
    try {
        const { name, serial_number } = details;
        const insertQuery = `
            INSERT INTO terminals (user_id, vendista_terminal_id, name, serial_number) 
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (user_id, vendista_terminal_id) DO NOTHING
            RETURNING id;
        `;
        const insertRes = await client.query(insertQuery, [ownerUserId, vendistaId, name || `Терминал ${vendistaId}`, serial_number || '']);

        if (insertRes.rows.length > 0) {
            // Успешно создали новый
            return insertRes.rows[0].id;
        } else {
            // Не создали, потому что он уже существовал (сработал ON CONFLICT).
            // Повторно запрашиваем его ID.
            const finalRes = await client.query('SELECT id FROM terminals WHERE vendista_terminal_id = $1 AND user_id = $2', [vendistaId, ownerUserId]);
            if (finalRes.rows.length === 0) {
                // Это очень маловероятный сценарий (race condition), но лучше его обработать
                throw new Error(`Failed to find or create terminal for vendistaId ${vendistaId}`);
            }
            return finalRes.rows[0].id;
        }
    } catch (err) {
        // Логируем ошибку и пробрасываем ее дальше, чтобы основной обработчик мог ее поймать
        console.error(`Error in findOrCreateTerminal for vendistaId ${vendistaId}:`, err);
        throw err;
    }
}


// Получить список всех терминалов (стоек) для пользователя
router.get('/', authMiddleware, async (req, res) => {
    const { ownerUserId } = req.user;

    try {
        const userRes = await pool.query('SELECT vendista_api_token FROM users WHERE id = $1', [ownerUserId]);
        if (userRes.rows.length === 0 || !userRes.rows[0].vendista_api_token) {
            return res.status(403).json({ success: false, error: 'API токен Vendista не найден для этого пользователя.' });
        }

        const encryptedToken = userRes.rows[0].vendista_api_token;
        const vendistaToken = decrypt(encryptedToken);

        if (!vendistaToken) {
            return res.status(500).json({ success: false, error: 'Не удалось дешифровать API токен.' });
        }

        const vendistaResponse = await axios.get(`${VENDISTA_API_URL}/terminals`, {
            params: { token: vendistaToken, ItemsOnPage: 500 },
            timeout: 20000
        });

        if (!vendistaResponse.data.success || !vendistaResponse.data.items) {
             return res.status(502).json({ success: false, error: 'Ошибка от API Vendista: ' + (vendistaResponse.data.error || 'Нет данных') });
        }

        let terminals = vendistaResponse.data.items;
        let unconfiguredRecipesCount = 0;
        let unconfiguredContainersCount = 0;

        const client = await pool.pool.connect();
        try {
            const vendistaIds = terminals.map(t => t.id);
            if (vendistaIds.length > 0) {
                const internalTerminalsRes = await client.query(
                    'SELECT id, vendista_terminal_id FROM terminals WHERE user_id = $1 AND vendista_terminal_id = ANY($2::int[])',
                    [ownerUserId, vendistaIds]
                );
                const internalIdMap = new Map(internalTerminalsRes.rows.map(row => [String(row.vendista_terminal_id), row.id]));
                const internalIds = Array.from(internalIdMap.values());

                if (internalIds.length > 0) {
                    const stockQuery = `
                        WITH RankedStock AS (
                            SELECT
                                terminal_id,
                                item_name,
                                current_stock,
                                critical_stock,
                                ROW_NUMBER() OVER(PARTITION BY terminal_id, 
                                    CASE 
                                        WHEN item_name = 'Вода' THEN 1 
                                        WHEN item_name = ANY($2::text[]) THEN 2 
                                        WHEN item_name = ANY($3::text[]) THEN 3 
                                    END 
                                ORDER BY (current_stock / NULLIF(max_stock, 0)) ASC, current_stock ASC) as rn
                            FROM inventories
                            WHERE terminal_id = ANY($1::int[]) AND location = 'machine' AND max_stock > 0
                        )
                        SELECT terminal_id, item_name, current_stock, critical_stock,
                            CASE 
                                WHEN item_name = 'Вода' THEN 'water'
                                WHEN item_name = ANY($2::text[]) THEN 'grams'
                                WHEN item_name = ANY($3::text[]) THEN 'pieces'
                            END as category
                        FROM RankedStock 
                        WHERE rn = 1;
                    `;
                    const minStocksRes = await client.query(stockQuery, [internalIds, GRAM_ITEMS, PIECE_ITEMS]);
                    
                    const containerConfigRes = await client.query(
                        `SELECT terminal_id, COUNT(DISTINCT item_name) as configured_count 
                         FROM inventories 
                         WHERE terminal_id = ANY($1::int[]) AND location = 'machine' AND max_stock IS NOT NULL AND max_stock > 0
                         GROUP BY terminal_id`, [internalIds]);

                    const recipeConfigRes = await client.query(
                        `WITH terminal_drinks AS (
                            SELECT DISTINCT
                                t.id as terminal_id,
                                tr.machine_item_id
                            FROM transactions tr
                            JOIN terminals t ON tr.coffee_shop_id = t.vendista_terminal_id
                            WHERE t.id = ANY($1::int[]) AND tr.machine_item_id IS NOT NULL
                        ), recipe_counts AS (
                            SELECT terminal_id, COUNT(*) as count FROM recipes WHERE terminal_id = ANY($1::int[]) GROUP BY terminal_id
                        ), drink_counts AS (
                            SELECT terminal_id, COUNT(*) as count FROM terminal_drinks GROUP BY terminal_id
                        )
                        SELECT id, COALESCE(dc.count, 0) > COALESCE(rc.count, 0) as needs_config
                        FROM terminals t
                        LEFT JOIN recipe_counts rc ON t.id = rc.terminal_id
                        LEFT JOIN drink_counts dc ON t.id = dc.terminal_id
                        WHERE t.id = ANY($1::int[])`, [internalIds]);

                    const stockMap = new Map();
                    minStocksRes.rows.forEach(r => {
                        if (!stockMap.has(r.terminal_id)) stockMap.set(r.terminal_id, {});
                        stockMap.get(r.terminal_id)[r.category] = { 
                            item_name: r.item_name, 
                            current_stock: r.current_stock,
                            critical_stock: r.critical_stock 
                        };
                    });

                    const containerMap = new Map(containerConfigRes.rows.map(r => [r.terminal_id, r.configured_count]));
                    const recipeMap = new Map(recipeConfigRes.rows.map(r => [r.id, r.needs_config]));
                    
                    terminals.forEach(t => {
                        const internalId = internalIdMap.get(String(t.id));
                        if (internalId) {
                            t.internalId = internalId;
                            t.stock_summary = stockMap.get(internalId) || {};
                            
                            const needsContainersConfig = (containerMap.get(internalId) || 0) < ALL_MACHINE_ITEMS.length;
                            const needsRecipesConfig = !!recipeMap.get(internalId);

                            t.needs_containers_config = needsContainersConfig;
                            t.needs_recipes_config = needsRecipesConfig;
                            t.is_configuration_pending = needsContainersConfig || needsRecipesConfig;
                        }
                    });
                }
            }
        } finally {
            client.release();
        }

        terminals.sort((a, b) => {
            const aOnline = (a.last_hour_online || 0) > 0;
            const bOnline = (b.last_hour_online || 0) > 0;
            if (aOnline && !bOnline) return -1;
            if (!aOnline && bOnline) return 1;
            return (a.comment || '').localeCompare(b.comment || '');
        });

        res.json({ success: true, terminals: terminals });

    } catch (err) {
        console.error(`[GET /api/terminals] UserID: ${ownerUserId} - Error:`, err);
        sendErrorToAdmin({
            userId: ownerUserId, errorContext: `GET /api/terminals`, errorMessage: err.message, errorStack: err.stack
        }).catch(console.error);
        res.status(500).json({ success: false, error: 'Ошибка сервера при получении списка стоек' });
    }
});

// Получить детали конкретного терминала по его VENDISTA ID
router.get('/vendista/:vendistaId/details', authMiddleware, async (req, res) => {
    const { ownerUserId } = req.user;
    const { vendistaId } = req.params;

    if (!vendistaId || isNaN(parseInt(vendistaId))) {
        return res.status(400).json({ success: false, error: 'Некорректный ID терминала' });
    }

    const client = await pool.pool.connect();
    try {
        const internalTerminalId = await findOrCreateTerminal(client, ownerUserId, vendistaId, req.query);
        
        const inventoryRes = await client.query(
            "SELECT item_name, location, current_stock, max_stock, critical_stock FROM inventories WHERE user_id = $1 AND terminal_id = $2 ORDER BY item_name",
            [ownerUserId, internalTerminalId]
        );
        
        res.json({
            success: true,
            internalId: internalTerminalId,
            details: { inventory: inventoryRes.rows }
        });

    } catch (err) {
        console.error(`[GET /api/terminals/vendista/:id/details] UserID: ${ownerUserId} - Error:`, err);
        sendErrorToAdmin({
            ownerUserId, errorContext: `GET /api/terminals/vendista/${vendistaId}/details`,
            errorMessage: err.message, errorStack: err.stack,
        }).catch(console.error);
        res.status(500).json({ success: false, error: 'Ошибка сервера при получении деталей стойки' });
    } finally {
        client.release();
    }
});

// Сохранить/обновить настройки остатков
router.post('/vendista/:vendistaId/settings', authMiddleware, async (req, res) => {
    const { ownerUserId } = req.user;
    const { vendistaId } = req.params;
    const { inventorySettings } = req.body; 

    if (!vendistaId || isNaN(parseInt(vendistaId)) || !Array.isArray(inventorySettings)) {
        return res.status(400).json({ success: false, error: 'Неверный формат данных' });
    }

    const client = await pool.pool.connect();
    try {
        await client.query('BEGIN');

        const internalTerminalId = await findOrCreateTerminal(client, ownerUserId, vendistaId);

        for (const item of inventorySettings) {
            const { item_name, location, max_stock, critical_stock } = item;
            
            if (!item_name || !location) continue;
            // Логика позволяет сохранять max_stock для любого товара, что нам и нужно.
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
                [ownerUserId, internalTerminalId, item_name, location, max, critical]
            );
        }

        await client.query('COMMIT');
        res.json({ success: true, message: 'Настройки успешно сохранены!' });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error(`[POST /api/terminals/vendista/:id/settings] UserID: ${ownerUserId} - Error:`, err);
        sendErrorToAdmin({
            ownerUserId, errorContext: `POST /api/terminals/vendista/${vendistaId}/settings`,
            errorMessage: err.message, errorStack: err.stack,
        }).catch(console.error);
        res.status(500).json({ success: false, error: 'Ошибка сервера при сохранении настроек' });
    } finally {
        client.release();
    }
});

// --- НОВЫЙ ЭНДПОИНТ ДЛЯ КОПИРОВАНИЯ НАСТРОЕК КОНТЕЙНЕРОВ ---
router.post('/copy-settings', authMiddleware, async (req, res) => {
    const { ownerUserId } = req.user;
    const { sourceInternalId, destinationInternalIds } = req.body;

    if (!sourceInternalId || !Array.isArray(destinationInternalIds) || destinationInternalIds.length === 0) {
        return res.status(400).json({ success: false, error: 'Необходимы ID исходного и целевых терминалов.' });
    }
    
    const allTerminalIds = [sourceInternalId, ...destinationInternalIds];

    const client = await pool.pool.connect();
    try {
        await client.query('BEGIN');
        
        // 1. Проверить, что все терминалы принадлежат пользователю
        const ownerCheck = await client.query(
            'SELECT id FROM terminals WHERE id = ANY($1::int[]) AND user_id = $2',
            [allTerminalIds, ownerUserId]
        );

        if (ownerCheck.rowCount !== allTerminalIds.length) {
            await client.query('ROLLBACK');
            return res.status(403).json({ success: false, error: 'Доступ к одному или нескольким терминалам запрещен.' });
        }
        
        // 2. Получить настройки контейнеров из исходного терминала
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
        
        // 3. Скопировать каждую настройку в целевые терминалы
        for (const destId of destinationInternalIds) {
            for (const setting of sourceSettings) {
                await client.query(
                    `INSERT INTO inventories (user_id, terminal_id, item_name, location, max_stock, critical_stock, updated_at)
                     VALUES ($1, $2, $3, 'machine', $4, $5, NOW())
                     ON CONFLICT (user_id, terminal_id, item_name, location)
                     DO UPDATE SET
                        max_stock = EXCLUDED.max_stock,
                        critical_stock = EXCLUDED.critical_stock,
                        updated_at = NOW()`,
                    [ownerUserId, destId, setting.item_name, setting.max_stock, setting.critical_stock]
                );
            }
        }
        
        await client.query('COMMIT');
        res.json({ success: true, message: `Настройки успешно скопированы в ${destinationInternalIds.length} терминал(а/ов).` });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error(`[POST /api/terminals/copy-settings] UserID: ${ownerUserId} - Error:`, err);
        sendErrorToAdmin({
            ownerUserId,
            errorContext: `POST /api/terminals/copy-settings`,
            errorMessage: err.message, errorStack: err.stack, additionalInfo: { body: req.body }
        }).catch(console.error);
        res.status(500).json({ success: false, error: 'Ошибка сервера при копировании настроек.' });
    } finally {
        client.release();
    }
});

// Получить уникальные ID кнопок (напитков) для терминала из транзакций
router.get('/vendista/:vendistaId/machine-items', authMiddleware, async (req, res) => {
    const { ownerUserId } = req.user;
    const { vendistaId } = req.params;

    try {
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
            ownerUserId, errorContext: `GET /api/terminals/vendista/${vendistaId}/machine-items`,
            errorMessage: err.message, errorStack: err.stack,
        }).catch(console.error);
        res.status(500).json({ success: false, error: 'Ошибка сервера при получении списка напитков' });
    }
});

module.exports = router;