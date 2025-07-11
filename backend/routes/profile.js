// backend/routes/profile.js
const path = require('path');
const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const pool = require('../db');
const { sendErrorToAdmin } = require('../utils/adminErrorNotifier'); // <--- НОВЫЙ ИМПОРТ

// --- Get User Profile Settings ---
router.get('/settings', authMiddleware, async (req, res) => {
    const { ownerUserId, telegramId } = req.user;
    console.log(`[GET /api/profile/settings] ActorTG: ${telegramId}, OwnerID: ${ownerUserId} - Fetching settings.`);
    try {
        const result = await pool.query(
            'SELECT id, setup_date, tax_system, acquiring, telegram_id, first_name, user_name FROM users WHERE id = $1',
            [ownerUserId] // Используем ownerUserId, так как настройки всегда принадлежат владельцу
        );
        if (result.rows.length === 0) {
            console.warn(`[GET /api/profile/settings] OwnerID: ${ownerUserId} - User profile not found.`);
            return res.status(404).json({ success: false, error: 'User profile not found.' });
        }
        const settings = {
            ...result.rows[0],
            acquiring: result.rows[0].acquiring !== null ? String(result.rows[0].acquiring) : null
        };
        // Удаляем telegram_id, first_name, user_name из ответа клиенту, если они не нужны там напрямую
        delete settings.telegram_id;
        delete settings.first_name;
        delete settings.user_name;
        delete settings.id; // userId и так есть в req.user

        res.json({ success: true, settings: settings });
    } catch (err) {
        console.error(`[GET /api/profile/settings] OwnerID: ${ownerUserId} - Error fetching profile settings:`, err);
        sendErrorToAdmin({
            userId: ownerUserId,
            errorContext: `GET /api/profile/settings - OwnerID: ${ownerUserId}`,
            errorMessage: err.message,
            errorStack: err.stack
        }).catch(notifyErr => console.error("Failed to send admin notification from GET /api/profile/settings:", notifyErr));
        res.status(500).json({ success: false, error: 'Server error fetching profile settings.' });
    }
});

// --- Update User Profile Settings ---
router.post('/settings', authMiddleware, async (req, res) => {
    const { ownerUserId, telegramId, accessLevel } = req.user;
    const { tax_system, acquiring, setup_date } = req.body;
    console.log(`[POST /api/profile/settings] ActorTG: ${telegramId}, OwnerID: ${ownerUserId}, Level: ${accessLevel} - Updating settings.`);

    if (accessLevel !== 'owner' && accessLevel !== 'admin') {
        return res.status(403).json({ success: false, error: 'Недостаточно прав для изменения настроек.' });
    }
    
    try {
        // ... (валидация остается прежней)
        const allowedTaxSystems = ['income_6', 'income_expense_15', null, ''];
        if (tax_system !== undefined && !allowedTaxSystems.includes(tax_system)) {
            return res.status(400).json({ success: false, error: 'Invalid tax system value.' });
        }

        let acquiringNum = null;
        if (acquiring !== undefined && acquiring !== null && String(acquiring).trim() !== '') {
            acquiringNum = parseFloat(String(acquiring).replace(',', '.'));
            if (isNaN(acquiringNum) || acquiringNum < 0 || acquiringNum > 100) {
                return res.status(400).json({ success: false, error: 'Invalid acquiring rate. Must be a number between 0 and 100.' });
            }
        }
        
        if (setup_date !== undefined && setup_date !== null && setup_date !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(setup_date)) {
            return res.status(400).json({ success: false, error: 'Invalid setup date format. Use YYYY-MM-DD.' });
        }
        // ... (конец валидации)


        const updateFields = [];
        const updateValues = [];
        let queryIndex = 1;

        if (tax_system !== undefined) {
            updateFields.push(`tax_system = $${queryIndex++}`);
            updateValues.push(tax_system === '' ? null : tax_system);
        }
        if (acquiring !== undefined) {
            updateFields.push(`acquiring = $${queryIndex++}`);
            updateValues.push(acquiringNum); 
        }
        if (setup_date !== undefined) {
            updateFields.push(`setup_date = $${queryIndex++}`);
            updateValues.push(setup_date === '' ? null : setup_date);
        }
        // first_name и user_name теперь обновляются через /complete-registration, здесь их нет

        if (updateFields.length === 0) {
            return res.status(400).json({ success: false, error: 'No settings provided to update.' });
        }

        updateFields.push(`updated_at = NOW()`);

        // Убрали first_name, user_name из RETURNING, если они не меняются здесь
        const queryText = `UPDATE users SET ${updateFields.join(', ')} WHERE id = $${queryIndex} RETURNING id, setup_date, tax_system, acquiring, updated_at`;
        updateValues.push(ownerUserId);
        
        console.log(`[POST /api/profile/settings] OwnerID: ${ownerUserId} - Executing update query.`);
        const result = await pool.query(queryText, updateValues);

        if (result.rowCount === 0) {
            console.warn(`[POST /api/profile/settings] OwnerID: ${ownerUserId} - User not found for update.`);
            return res.status(404).json({ success: false, error: 'User not found for update.' });
        }
        
        const updatedSettings = {
            ...result.rows[0],
            acquiring: result.rows[0].acquiring !== null ? String(result.rows[0].acquiring) : null
        };
        console.log(`[POST /api/profile/settings] OwnerID: ${ownerUserId} - Profile updated successfully.`);
        res.json({ success: true, message: 'Profile settings updated successfully.', settings: updatedSettings });

    } catch (err) {
        console.error(`[POST /api/profile/settings] OwnerID: ${ownerUserId} - Error updating profile settings:`, err);
        sendErrorToAdmin({
            userId: ownerUserId,
            errorContext: `POST /api/profile/settings - OwnerID: ${ownerUserId}`,
            errorMessage: err.message,
            errorStack: err.stack,
            additionalInfo: { body: req.body }
        }).catch(notifyErr => console.error("Failed to send admin notification from POST /api/profile/settings:", notifyErr));
        res.status(500).json({ success: false, error: 'Server error updating profile settings.' });
    }
});

// --- Get Sync Status ---
router.get('/sync-status', authMiddleware, async (req, res) => {
    const { ownerUserId, telegramId } = req.user;
    console.log(`[GET /api/profile/sync-status] ActorTG: ${telegramId}, OwnerID: ${ownerUserId} - Fetching sync status.`);
    try {
        const generalImportJobNames = [
            '15-Min Import', 
            'Daily Update (48h)', 'Daily Update (72h)', // Добавил новый вариант
            'Weekly Update (7d)', 'Weekly Update (8d)', // Добавил новый вариант
            'Manual Import (1d)', 'Manual Import (2d)', 'Manual Import (7d)', 'Manual Import (30d)',
            'Initial Import'
        ];
        
        const lastDownloadRes = await pool.query(
            `SELECT MAX(last_run_at) as last_successful_sync
             FROM worker_logs 
             WHERE user_id = $1 AND status = 'success' AND job_name LIKE ANY($2::TEXT[])`,
            [ownerUserId]
        );
        
        const lastSyncTime = lastDownloadRes.rows[0]?.last_successful_sync || null;

        const syncStatusData = {
            lastTransactionsUpdate: lastSyncTime,
            lastReturnsUpdate: lastSyncTime, 
            lastButtonsUpdate: lastSyncTime, 
        };
        res.json({ success: true, syncStatus: syncStatusData });

    } catch (err) {
        console.error(`[GET /api/profile/sync-status] OwnerID: ${ownerUserId} - Error fetching sync status:`, err);
        sendErrorToAdmin({
            userId: ownerUserId,
            errorContext: `GET /api/profile/sync-status - OwnerID: ${ownerUserId}`,
            errorMessage: err.message,
            errorStack: err.stack
        }).catch(notifyErr => console.error("Failed to send admin notification from GET /api/profile/sync-status:", notifyErr));
        res.status(500).json({ success: false, error: 'Server error fetching sync status.' });
    }
});

module.exports = router;