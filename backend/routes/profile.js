// backend/routes/profile.js
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const pool = require('../db');
// moment не используется в этой версии, но может понадобиться для другого форматирования
// const moment = require('moment-timezone');
// const TIMEZONE = 'Europe/Moscow';

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
        // Преобразуем числовое значение acquiring в строку для консистентности с тем, как оно сохраняется
        const settings = {
            ...result.rows[0],
            acquiring: result.rows[0].acquiring !== null ? String(result.rows[0].acquiring) : null
        };
        console.log(`[GET /api/profile/settings] Settings found for user ID: ${userId}:`, settings);
        res.json({ success: true, settings: settings });
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
        if (acquiring !== undefined) {
            updateFields.push(`acquiring = $${queryIndex++}`);
            updateValues.push(acquiringNum); 
        }
        if (setup_date !== undefined) {
            updateFields.push(`setup_date = $${queryIndex++}`);
            updateValues.push(setup_date === '' ? null : setup_date);
        }

        if (updateFields.length === 0) {
            // Если ничего не пришло на обновление, можно вернуть текущие настройки или ошибку
            // Для простоты вернем ошибку, если фронтенд не должен отправлять пустой запрос
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
        
        const updatedSettings = {
            ...result.rows[0],
            acquiring: result.rows[0].acquiring !== null ? String(result.rows[0].acquiring) : null
        };
        console.log(`[POST /api/profile/settings] Profile updated successfully for user ID: ${userId}:`, updatedSettings);
        res.json({ success: true, message: 'Profile settings updated successfully.', settings: updatedSettings });

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
        // Основные задачи импорта, которые обновляют все транзакции
        const generalImportJobNames = [
            '15-Min Import', 
            'Daily Update (48h)', 
            'Weekly Update (7d)',
            'Manual Import (1d)', 'Manual Import (2d)', 'Manual Import (7d)', 'Manual Import (30d)', // Добавь все варианты ручного импорта
            // Имя задачи из import_all.js, если оно логируется
            'Initial Import' // Предположим, что startImport при регистрации логирует с таким именем или похожим
        ];
         // Если первоначальный импорт из auth.js имеет другое имя в worker_logs, добавь его.
         // startImport вызываемый из auth.js использует importTransactionsForPeriod, который сам по себе не пишет в worker_logs.
         // Логирование для startImport нужно добавить, если его нет.
         // Для простоты, пока ориентируемся на job_name из schedule_imports.

        const lastDownloadRes = await pool.query(
            `SELECT MAX(last_run_at) as last_successful_sync
             FROM worker_logs 
             WHERE user_id = $1 AND status = 'success' AND job_name LIKE ANY($2::TEXT[])`, // Используем job_name LIKE ANY для большей гибкости с ручными импортами
            [userId, generalImportJobNames.map(name => `%${name}%`)] // Оборачиваем в % для LIKE
        );
        
        // Для "Обновление возвратов" и "Обновление кнопок" пока используем ту же дату,
        // так как все транзакции (включая эти поля) обновляются во время этих задач.
        const lastSyncTime = lastDownloadRes.rows[0]?.last_successful_sync || null;

        const syncStatusData = {
            lastTransactionsUpdate: lastSyncTime,
            lastReturnsUpdate: lastSyncTime, // Упрощенно
            lastButtonsUpdate: lastSyncTime, // Упрощенно
        };
        console.log(`[GET /api/profile/sync-status] Sync status for user ID: ${userId}:`, syncStatusData);
        res.json({ success: true, syncStatus: syncStatusData });

    } catch (err) {
        console.error("[GET /api/profile/sync-status] Error fetching sync status:", err);
        res.status(500).json({ success: false, error: 'Server error fetching sync status.' });
    }
});

module.exports = router;