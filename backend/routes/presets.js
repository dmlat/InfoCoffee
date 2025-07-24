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
            `SELECT id, name, items FROM recipe_presets WHERE user_id = $1 ORDER BY created_at ASC`,
            [ownerUserId]
        );
        res.json({ success: true, presets: presetsRes.rows });
    } catch (err) {
        sendErrorToAdmin({ userId: ownerUserId, errorContext: `GET /api/presets`, errorMessage: err.message, errorStack: err.stack }).catch(console.error);
        res.status(500).json({ success: false, error: 'Ошибка сервера при получении пресетов' });
    }
});

module.exports = router; 