// backend/routes/warehouse.js
const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const { pool } = require('../db');
const { sendErrorToAdmin } = require('../utils/adminErrorNotifier');
const { logInventoryChange } = require('../utils/inventoryLogger');

// Получить остатки на центральном складе
router.get('/', authMiddleware, async (req, res) => {
    const { ownerUserId, telegramId } = req.user;
    console.log(`[GET /api/warehouse] ActorTG: ${telegramId}, OwnerID: ${ownerUserId} - Fetching warehouse stock.`);
    try {
        const result = await pool.query(
            `SELECT item_name, current_stock FROM inventories WHERE user_id = $1 AND location = 'warehouse' AND terminal_id IS NULL`,
            [ownerUserId]
        );
        res.json({ success: true, warehouseStock: result.rows });
    } catch (err) {
        console.error(`[GET /api/warehouse] UserID: ${ownerUserId} - Error:`, err);
        sendErrorToAdmin({
            userId: ownerUserId, errorContext: `GET /api/warehouse`,
            errorMessage: err.message, errorStack: err.stack
        }).catch(console.error);
        res.status(500).json({ success: false, error: 'Ошибка сервера при получении остатков склада.' });
    }
});

// "Приходовать" товар на склад (через модальное окно)
router.post('/stock-up', authMiddleware, async (req, res) => {
    const { ownerUserId, telegramId } = req.user;
    const { items } = req.body; // Ожидаем массив { item_name, quantity }
    console.log(`[POST /api/warehouse/stock-up] ActorTG: ${telegramId}, OwnerID: ${ownerUserId} - Stocking up ${items.length} items.`);

    if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ success: false, error: 'Не предоставлены товары для приходования.' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        for (const item of items) {
            const quantity = parseFloat(item.quantity);
            if (!item.item_name || isNaN(quantity) || quantity <= 0) continue;
            
            // 1. Получаем текущий остаток и блокируем строку
            const beforeRes = await client.query(
                `SELECT current_stock FROM inventories WHERE user_id = $1 AND location = 'warehouse' AND item_name = $2 AND terminal_id IS NULL FOR UPDATE`,
                [ownerUserId, item.item_name]
            );
            const quantityBefore = beforeRes.rows.length > 0 ? parseFloat(beforeRes.rows[0].current_stock) : 0;

            // 2. Обновляем или вставляем остаток
            const afterRes = await client.query(
                `INSERT INTO inventories (user_id, location, terminal_id, item_name, current_stock)
                 VALUES ($1, 'warehouse', NULL, $2, $3)
                 ON CONFLICT (user_id, terminal_id, item_name, location)
                 DO UPDATE SET
                    current_stock = inventories.current_stock + EXCLUDED.current_stock,
                    updated_at = NOW()
                 RETURNING current_stock`,
                [ownerUserId, item.item_name, quantity]
            );
            const quantityAfter = parseFloat(afterRes.rows[0].current_stock);
            
            // 3. Логируем изменение
            await logInventoryChange({
                owner_user_id: ownerUserId,
                changed_by_telegram_id: telegramId,
                change_source: 'warehouse_stockup',
                item_name: item.item_name,
                quantity_before: quantityBefore,
                quantity_after: quantityAfter
            }, client);
        }

        await client.query('COMMIT');
        res.status(201).json({ success: true, message: 'Товары успешно оприходованы.' });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error(`[POST /api/warehouse/stock-up] UserID: ${ownerUserId} - Error:`, err);
        sendErrorToAdmin({
            userId: ownerUserId, errorContext: `POST /api/warehouse/stock-up`,
            errorMessage: err.message, errorStack: err.stack, additionalInfo: { body: req.body }
        }).catch(console.error);
        res.status(500).json({ success: false, error: 'Ошибка сервера при приходовании товара.' });
    } finally {
        client.release();
    }
});

// Изменить количество товара на складе (для кнопок +/-)
router.post('/adjust', authMiddleware, async (req, res) => {
    const { ownerUserId, telegramId } = req.user;
    const { item_name, quantity } = req.body; // quantity может быть отрицательным для списания

    console.log(`[POST /api/warehouse/adjust] ActorTG: ${telegramId}, OwnerID: ${ownerUserId}, Item: ${item_name}, Quantity: ${quantity}`);

    if (!item_name || isNaN(parseFloat(quantity)) || quantity === 0) {
        return res.status(400).json({ success: false, error: 'Некорректные данные для изменения остатка.' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Проверяем, есть ли такая позиция на складе и блокируем строку
        const existingItem = await client.query(
            `SELECT id, current_stock FROM inventories WHERE user_id = $1 AND location = 'warehouse' AND item_name = $2 AND terminal_id IS NULL FOR UPDATE`,
            [ownerUserId, item_name]
        );

        const quantityBefore = existingItem.rows.length > 0 ? parseFloat(existingItem.rows[0].current_stock) : 0;
        let quantityAfter;

        if (existingItem.rows.length > 0) {
            // Если позиция есть, обновляем
            const newStock = quantityBefore + parseFloat(quantity);
            if (newStock < 0) {
                await client.query('ROLLBACK');
                return res.status(400).json({ success: false, error: `Недостаточно остатков "${item_name}" для списания.` });
            }

            const updateRes = await client.query(
                `UPDATE inventories SET current_stock = $1, updated_at = NOW() WHERE id = $2 RETURNING current_stock`,
                [newStock, existingItem.rows[0].id]
            );
            quantityAfter = parseFloat(updateRes.rows[0].current_stock);
            
        } else if (quantity > 0) {
            // Если позиции нет, то можем только добавить (приход)
            const insertRes = await client.query(
                `INSERT INTO inventories (user_id, location, terminal_id, item_name, current_stock)
                 VALUES ($1, 'warehouse', NULL, $2, $3) RETURNING current_stock`,
                [ownerUserId, item_name, quantity]
            );
            quantityAfter = parseFloat(insertRes.rows[0].current_stock);
        } else {
            // Если позиции нет и пытаемся списать - ошибка
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, error: `Товар "${item_name}" не найден на складе для списания.` });
        }
        
        // Логируем изменение
        await logInventoryChange({
            owner_user_id: ownerUserId,
            changed_by_telegram_id: telegramId,
            change_source: 'warehouse_adjust',
            item_name,
            quantity_before: quantityBefore,
            quantity_after: quantityAfter
        }, client);

        await client.query('COMMIT');
        res.json({ success: true, new_stock: quantityAfter });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error(`[POST /api/warehouse/adjust] UserID: ${ownerUserId} - Error:`, err);
        sendErrorToAdmin({
            userId: ownerUserId, errorContext: `POST /api/warehouse/adjust`,
            errorMessage: err.message, errorStack: err.stack, additionalInfo: { body: req.body }
        }).catch(console.error);
        res.status(500).json({ success: false, error: 'Ошибка сервера при изменении остатков.' });
    } finally {
        client.release();
    }
});


module.exports = router;