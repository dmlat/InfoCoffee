// backend/scripts/import_history.js
require('../utils/envLoader');
const { pool } = require('../db');
const { decrypt } = require('../utils/security');
const { importTransactionsForPeriod } = require('../worker/vendista_import_worker');

async function importHistory() {
    const userId = 1; // Assuming User 1
    const dateFrom = '2025-09-01';
    const dateTo = '2025-12-31';

    console.log(`Starting historical import for User ${userId} from ${dateFrom} to ${dateTo}...`);

    try {
        const userRes = await pool.query('SELECT vendista_api_token FROM users WHERE id = $1', [userId]);
        if (userRes.rows.length === 0) {
            console.error('User not found');
            return;
        }

        const encryptedToken = userRes.rows[0].vendista_api_token;
        if (!encryptedToken) {
            console.error('No token found');
            return;
        }

        const token = decrypt(encryptedToken);
        if (!token) {
            console.error('Failed to decrypt token');
            return;
        }

        console.log('Token decrypted successfully. Launching import worker...');

        const result = await importTransactionsForPeriod({
            ownerUserId: userId,
            vendistaApiToken: token,
            dateFrom: dateFrom,
            dateTo: dateTo,
            fetchAllPages: true,
            isHistoricalImport: true // Skip inventory updates for history
        });

        console.log('Import result:', result);

    } catch (error) {
        console.error('Import failed:', error);
    } finally {
        pool.end();
    }
}

importHistory();


