require('dotenv').config();
const express = require('express');
const pool = require('../db');
const authMiddleware = require('../middleware/auth'); // Assuming your JWT middleware is here

const router = express.Router();

// --- Get User Profile Settings ---
router.get('/settings', authMiddleware, async (req, res) => {
    const userId = req.user.userId;
    try {
        const result = await pool.query(
            'SELECT setup_date, tax_system, acquiring FROM users WHERE id = $1',
            [userId]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'User profile not found.' });
        }
        res.json({ success: true, settings: result.rows[0] });
    } catch (err) {
        console.error("Error fetching profile settings:", err);
        res.status(500).json({ success: false, error: 'Server error fetching profile settings.' });
    }
});

// --- Update User Profile Settings ---
router.post('/settings', authMiddleware, async (req, res) => {
    const userId = req.user.userId;
    const { tax_system, acquiring, setup_date } = req.body; // Added setup_date

    // Basic validation
    const allowedTaxSystems = ['income_6', 'income_expense_15', null, ''];
    if (tax_system !== undefined && !allowedTaxSystems.includes(tax_system)) {
        return res.status(400).json({ success: false, error: 'Invalid tax system value.' });
    }

    const acquiringNum = parseFloat(acquiring);
    if (acquiring !== undefined && acquiring !== null && acquiring !== '' && (isNaN(acquiringNum) || acquiringNum < 0 || acquiringNum > 100)) {
        return res.status(400).json({ success: false, error: 'Invalid acquiring rate. Must be a number between 0 and 100.' });
    }
    
    // Validate setup_date if provided
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
            updateValues.push(acquiring === '' || acquiring === null ? null : acquiringNum);
        }
        if (setup_date !== undefined) { // Allow updating setup_date
            updateFields.push(`setup_date = $${queryIndex++}`);
            updateValues.push(setup_date === '' ? null : setup_date);
        }


        if (updateFields.length === 0) {
            return res.status(400).json({ success: false, error: 'No settings provided to update.' });
        }

        updateFields.push(`updated_at = NOW()`); // Always update updated_at

        const query = `UPDATE users SET ${updateFields.join(', ')} WHERE id = $${queryIndex} RETURNING setup_date, tax_system, acquiring`;
        updateValues.push(userId);
        
        const result = await pool.query(query, updateValues);

        if (result.rowCount === 0) {
            return res.status(404).json({ success: false, error: 'User not found for update.' });
        }
        
        res.json({ success: true, message: 'Profile settings updated successfully.', settings: result.rows[0] });

    } catch (err) {
        console.error("Error updating profile settings:", err);
        res.status(500).json({ success: false, error: 'Server error updating profile settings.' });
    }
});

module.exports = router;