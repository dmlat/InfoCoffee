// backend/scripts/manual_sync_token.js
const path = require('path');

// Централизованная загрузка окружения
require('../utils/envLoader');
require('../utils/logger'); // Глобальное подключение логгера

const { pool } = require('../db');
const { importTransactionsForPeriod } = require('../worker/vendista_import_worker');
const { syncTerminalsForUser } = require('../worker/terminal_sync_worker');
const moment = require('moment-timezone');

function printHelp() {
    console.log(`
    Manual Sync with Token Tool
    ---------------------------
    Syncs data from Vendista using a provided API token directly, bypassing the worker and DB stored token.
    Useful for local development when you have a real token but don't want to store it in the local DB or run the worker.

    Usage:
      node backend/scripts/manual_sync_token.js --token <token> [options]

    Options:
      --token <token>          (Required) The raw Vendista API token.
      --user-id <id>           (Optional) User ID to associate data with. Defaults to 1.
      --days <number>          (Optional) Number of past days to import transactions for. Defaults to 1.
      --full-history           (Optional) Import full transaction history (overrides --days).
      --skip-terminals         (Optional) Skip terminal synchronization.
      --skip-transactions      (Optional) Skip transaction import.

    Examples:
      # Sync everything for user 1 (default) with token
      node backend/scripts/manual_sync_token.js --token "YOUR_TOKEN_HERE"

      # Sync only terminals
      node backend/scripts/manual_sync_token.js --token "..." --skip-transactions

      # Sync transactions for last 7 days
      node backend/scripts/manual_sync_token.js --token "..." --days 7

      # Sync full history for user 2
      node backend/scripts/manual_sync_token.js --token "..." --user-id 2 --full-history
    `);
}

function parseArgs(args) {
    const options = {
        userId: 1, // Default to user 1 for dev
        days: 1,
        fullHistory: false,
        skipTerminals: false,
        skipTransactions: false,
        token: null,
        dateFrom: null,
        dateTo: null
    };

    let i = 0;
    while (i < args.length) {
        const arg = args[i];
        if (arg === '--token') {
            options.token = args[i + 1];
            i += 2;
        } else if (arg === '--user-id') {
            options.userId = parseInt(args[i + 1], 10);
            i += 2;
        } else if (arg === '--days') {
            options.days = parseInt(args[i + 1], 10);
            i += 2;
        } else if (arg === '--date-from') {
            options.dateFrom = args[i + 1];
            i += 2;
        } else if (arg === '--date-to') {
            options.dateTo = args[i + 1];
            i += 2;
        } else if (arg === '--full-history') {
            options.fullHistory = true;
            i++;

        } else if (arg === '--skip-terminals') {
            options.skipTerminals = true;
            i++;
        } else if (arg === '--skip-transactions') {
            options.skipTransactions = true;
            i++;
        } else if (arg === '--help' || arg === '-h') {
            printHelp();
            process.exit(0);
        } else {
            console.warn(`Warning: Unknown argument "${arg}"`);
            i++;
        }
    }
    return options;
}

async function main() {
    const args = process.argv.slice(2);
    if (args.length === 0) {
        printHelp();
        process.exit(0);
    }

    const options = parseArgs(args);

    if (!options.token && process.env.VENDISTA_API_TOKEN) {
        options.token = process.env.VENDISTA_API_TOKEN;
        console.log('ℹ️  Using VENDISTA_API_TOKEN from environment.');
    }

    if (!options.token) {
        console.error('Error: --token is required (or VENDISTA_API_TOKEN env var).');
        process.exit(1);
    }

    // Check if user exists
    try {
        const userCheck = await pool.query('SELECT id FROM users WHERE id = $1', [options.userId]);
        if (userCheck.rows.length === 0) {
            console.error(`❌ Error: User with ID ${options.userId} does not exist in the local database.`);
            console.error('   Please create the user first or use --user-id to specify an existing user.');
            process.exit(1);
        }
    } catch (dbError) {
        console.error('❌ Error checking user in database:', dbError.message);
        process.exit(1);
    }

    console.log(`🚀 Starting Manual Sync with Token...`);
    console.log(`👤 User ID: ${options.userId}`);
    console.log(`🔑 Token: ${options.token.substring(0, 10)}... (length: ${options.token.length})`);

    try {
        // 1. Sync Terminals
        if (!options.skipTerminals) {
            console.log('\n[1/2] Syncing Terminals...');
            const termResult = await syncTerminalsForUser(options.userId, options.token);
            if (termResult.success) {
                console.log(`✅ Terminals synced successfully. Count: ${termResult.count}`);
            } else {
                console.error(`❌ Terminal sync failed: ${termResult.error}`);
            }
        } else {
            console.log('\n[1/2] Skipping Terminals sync.');
        }

        // 2. Import Transactions
        if (!options.skipTransactions) {
            console.log('\n[2/2] Importing Transactions...');
            
            let dateFrom;
            let dateTo = moment().tz('Europe/Moscow').format('YYYY-MM-DD');

            if (options.dateFrom) {
                dateFrom = options.dateFrom;
                if (options.dateTo) {
                    dateTo = options.dateTo;
                }
                console.log(`📅 Custom date range mode. Start date: ${dateFrom}, End date: ${dateTo}`);
            } else if (options.fullHistory) {
                // Get setup_date from DB to determine start date, or default to a reasonable past
                const userRes = await pool.query('SELECT setup_date FROM users WHERE id = $1', [options.userId]);
                if (userRes.rows.length > 0 && userRes.rows[0].setup_date) {
                    dateFrom = moment(userRes.rows[0].setup_date).format('YYYY-MM-DD');
                    console.log(`📅 Full history mode. Start date from DB: ${dateFrom}`);
                } else {
                    dateFrom = '2023-01-01'; // Fallback
                    console.log(`📅 Full history mode. Start date fallback: ${dateFrom}`);
                }
            } else {
                dateFrom = moment().tz('Europe/Moscow').subtract(options.days, 'days').format('YYYY-MM-DD');
                console.log(`📅 Last ${options.days} days mode. Start date: ${dateFrom}`);
            }

            console.log(`📅 Date range: ${dateFrom} to ${dateTo}`);

            const txResult = await importTransactionsForPeriod({
                ownerUserId: options.userId,
                vendistaApiToken: options.token,
                dateFrom,
                dateTo,
                fetchAllPages: true,
                isHistoricalImport: options.fullHistory // If full history, treat as historical (no inventory deduction for old items potentially)
            });

            if (txResult.success) {
                console.log(`✅ Transactions imported successfully.`);
                console.log(`   Processed: ${txResult.processed}`);
                console.log(`   Added: ${txResult.added}`);
                console.log(`   Updated: ${txResult.updated}`);
            } else {
                console.error(`❌ Transaction import failed: ${txResult.error}`);
            }
        } else {
            console.log('\n[2/2] Skipping Transactions import.');
        }

        console.log('\n✨ All operations completed.');

    } catch (error) {
        console.error('\n💥 Critical Error:', error);
    } finally {
        await pool.end();
    }
}

main().catch(err => {
    console.error('Unhandled Rejection:', err);
    process.exit(1);
});
