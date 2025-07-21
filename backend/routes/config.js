const express = require('express');
const router = express.Router();

// Эндпоинт для получения конфигурации для разработки
router.get('/dev-config', (req, res) => {
    console.log('[DEV-CONFIG] Received request to /api/dev-config');
    // Этот эндпоинт должен работать только в режиме разработки
    if (process.env.NODE_ENV !== 'development') {
        console.error('[DEV-CONFIG ERROR] Attempted to access in production mode.');
        return res.status(403).json({ error: 'This endpoint is only available in development mode.' });
    }

    const requiredKeys = [
        'DEV_OWNER_TELEGRAM_ID',
        'DEV_ADMIN_TELEGRAM_ID',
        'DEV_SERVICE_TELEGRAM_ID'
    ];

    const missingKeys = requiredKeys.filter(key => !process.env[key]);

    if (missingKeys.length > 0) {
        const errorMessage = `Missing required environment variables in .env.development: ${missingKeys.join(', ')}`;
        console.error(`[DEV-CONFIG ERROR] ${errorMessage}`);
        return res.status(500).json({ 
            error: 'Failed to load development configuration.',
            details: errorMessage
        });
    }

    console.log('[DEV-CONFIG] Successfully loaded all dev IDs. Sending to frontend.');
    res.json({
        ownerTelegramId: process.env.DEV_OWNER_TELEGRAM_ID,
        adminTelegramId: process.env.DEV_ADMIN_TELEGRAM_ID,
        serviceTelegramId: process.env.DEV_SERVICE_TELEGRAM_ID,
    });
});

module.exports = router; 