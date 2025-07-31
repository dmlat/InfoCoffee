// backend/routes/presets.js
const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const { pool } = require('../db');
const { sendErrorToAdmin } = require('../utils/adminErrorNotifier');

// GET-запрос для получения всех пресетов пользователя
router.get('/', authMiddleware, async (req, res) => {
    const { ownerUserId, telegramId } = req.user;
    console.log(`[GET /api/presets] ActorTG: ${telegramId}, OwnerID: ${ownerUserId} - Fetching presets.`);
    try {
        const presetsRes = await pool.query(
            `SELECT id, name, items, user_id FROM recipe_presets WHERE user_id = $1 OR user_id IS NULL ORDER BY user_id DESC, created_at ASC`,
            [ownerUserId]
        );
        
        // Normalize preset items format - convert objects to arrays if needed
        const normalizedPresets = presetsRes.rows.map(preset => {
            let items = preset.items;
            
            // Ingredient name mapping for legacy presets
            const ingredientNameMap = {
                'Стакан': 'Стаканы',
                'Крышка': 'Крышки',
                'Размешиватель': 'Размешиватели'
            };
            
            // If items is an object (old format), convert to array format
            if (items && typeof items === 'object' && !Array.isArray(items)) {
                items = Object.entries(items).map(([item_name, quantity]) => ({
                    item_name: ingredientNameMap[item_name] || item_name,
                    quantity
                }));
            } else if (Array.isArray(items)) {
                // Also normalize array format items
                items = items.map(item => ({
                    ...item,
                    item_name: ingredientNameMap[item.item_name] || item.item_name
                }));
            }
            
            return {
                ...preset,
                items: items || []
            };
        });
        
        res.json({ success: true, presets: normalizedPresets });
    } catch (err) {
        sendErrorToAdmin({ userId: ownerUserId, errorContext: `GET /api/presets`, errorMessage: err.message, errorStack: err.stack }).catch(console.error);
        res.status(500).json({ success: false, error: 'Ошибка сервера при получении пресетов' });
    }
});

module.exports = router; 