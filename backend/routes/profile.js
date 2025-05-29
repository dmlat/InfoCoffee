// backend/routes/profile.js
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') }); 
const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const pool = require('../db');

// --- Get User Profile Settings ---
router.get('/settings', authMiddleware, async (req, res) => {
    const userId = req.user.userId;
    console.log(`[GET /api/profile/settings] User ID: ${userId}`);
    try {
        const result = await pool.query(
            'SELECT setup_date, tax_system, acquiring FROM users WHERE id = $1',
            [userId]
        );
        if (result.rows.length === 0) {
            console.log(`[GET /api/profile/settings] User profile not found for ID: ${userId}`);
            return res.status(404).json({ success: false, error: 'User profile not found.' });
        }
        console.log(`[GET /api/profile/settings] Settings found for user ID: ${userId}:`, result.rows[0]);
        res.json({ success: true, settings: result.rows[0] });
    } catch (err) {
        console.error("[GET /api/profile/settings] Error fetching profile settings:", err);
        res.status(500).json({ success: false, error: 'Server error fetching profile settings.' });
    }
});

// --- Update User Profile Settings ---
router.post('/settings', authMiddleware, async (req, res) => {
    const userId = req.user.userId;
    const { tax_system, acquiring, setup_date } = req.body;
    console.log(`[POST /api/profile/settings] User ID: ${userId}, Body:`, req.body);

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

    try {
        const updateFields = [];
        const updateValues = [];
        let queryIndex = 1;

        if (tax_system !== undefined) {
            updateFields.push(`tax_system = $${queryIndex++}`);
            updateValues.push(tax_system === '' ? null : tax_system);
        }
        if (acquiring !== undefined) { // Allows setting to null if passed as null or empty string
            updateFields.push(`acquiring = $${queryIndex++}`);
            updateValues.push(acquiringNum); // Will be null if not provided or empty
        }
        if (setup_date !== undefined) {
            updateFields.push(`setup_date = $${queryIndex++}`);
            updateValues.push(setup_date === '' ? null : setup_date);
        }

        if (updateFields.length === 0) {
            return res.status(400).json({ success: false, error: 'No settings provided to update.' });
        }

        updateFields.push(`updated_at = NOW()`);

        const queryText = `UPDATE users SET ${updateFields.join(', ')} WHERE id = $${queryIndex} RETURNING id, setup_date, tax_system, acquiring, updated_at`;
        updateValues.push(userId);
        
        console.log(`[POST /api/profile/settings] Executing query: ${queryText} with values:`, updateValues);
        const result = await pool.query(queryText, updateValues);

        if (result.rowCount === 0) {
            console.log(`[POST /api/profile/settings] User not found for update, ID: ${userId}`);
            return res.status(404).json({ success: false, error: 'User not found for update.' });
        }
        
        console.log(`[POST /api/profile/settings] Profile updated successfully for user ID: ${userId}:`, result.rows[0]);
        res.json({ success: true, message: 'Profile settings updated successfully.', settings: result.rows[0] });

    } catch (err) {
        console.error("[POST /api/profile/settings] Error updating profile settings:", err);
        res.status(500).json({ success: false, error: 'Server error updating profile settings.' });
    }
});

// --- Get Sync Status ---
router.get('/sync-status', authMiddleware, async (req, res) => {
    const userId = req.user.userId;
    console.log(`[GET /api/profile/sync-status] User ID: ${userId}`);
    try {
        const relevantJobNames = [
            '15-Min Import', 'Daily Update (48h)', 'Weekly Update (7d)', 
            'Manual Import (1d)', 'Manual Import (2d)', 'Manual Import (7d)', // Include manual import job names from schedule_imports.js
            // Add other job names that signify a full data download if necessary
        ];

        const lastDownloadRes = await pool.query(
            `SELECT MAX(last_run_at) as last_download_at 
             FROM worker_logs 
             WHERE user_id = $1 AND status = 'success' AND job_name = ANY($2::TEXT[])`,
            [userId, relevantJobNames]
        );
        
        const syncStatusData = {
            lastDownloadAt: lastDownloadRes.rows[0]?.last_download_at || null,
            lastReverseIdUpdateAt: null, // Placeholder - requires more specific logging or logic
            lastMachineItemIdUpdateAt: null, // Placeholder - requires more specific logging or logic
        };
        console.log(`[GET /api/profile/sync-status] Sync status for user ID: ${userId}:`, syncStatusData);
        res.json({ success: true, syncStatus: syncStatusData });

    } catch (err) {
        console.error("[GET /api/profile/sync-status] Error fetching sync status:", err);
        res.status(500).json({ success: false, error: 'Server error fetching sync status.' });
    }
});


module.exports = router;