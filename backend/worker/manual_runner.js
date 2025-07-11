// backend/worker/manual_runner.js
require('../utils/logger'); // Глобальное подключение логгера
const { pool } = require('../db');
const { decrypt } = require('../utils/security');
const { manualImportLastNDays } = require('./schedule_imports');
const { syncTerminalsForUser } = require('./terminal_sync_worker');
const moment = require('moment');

const COMMANDS = {
  IMPORT_TRANSACTIONS: 'import-transactions',
  SYNC_TERMINALS: 'sync-terminals'
};

function parseArgs(args) {
  const options = {
    userIds: [],
    allUsers: false,
  };
  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--user-id') {
      const ids = args[++i].split(',').map(id => parseInt(id.trim(), 10));
      options.userIds.push(...ids);
    } else if (arg === '--days') {
      options.days = parseInt(args[++i], 10);
    } else if (arg === '--full-history') {
      options.fullHistory = true;
    } else if (arg === '--all') {
      options.allUsers = true;
    }
  }
  options.command = args[0];
  return options;
}

function printHelp() {
    console.log(`
    InfoCoffee Manual Job Runner
    -----------------------------
    A script to manually trigger backend worker jobs for specific users.

    Usage:
      node backend/worker/manual_runner.js <command> [options]

    Commands:
      import-transactions   Imports transactions for users.
      sync-terminals        Syncs terminal lists for users.

    Options:
      --user-id <id1,id2,...>  (Required unless --all) Comma-separated list of user IDs from the 'users' table.
      --all                    Run the job for all active users.
      --days <number>          (For import-transactions) Number of past days to import.
      --full-history           (For import-transactions) Import all history since the user's setup_date. Overrides --days.

    Examples:
      # Import last 7 days of transactions for user 1
      node backend/worker/manual_runner.js import-transactions --user-id 1 --days 7

      # Sync terminals for users 5 and 8
      node backend/worker/manual_runner.js sync-terminals --user-id 5,8

      # Import full history for user 10
      node backend/worker/manual_runner.js import-transactions --user-id 10 --full-history

      # Sync terminals for ALL users
      node backend/worker/manual_runner.js sync-terminals --all
    `);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    printHelp();
    return;
  }
  
  const options = parseArgs(args);

  if (!options.command || !Object.values(COMMANDS).includes(options.command)) {
    console.error(`Error: Unknown command "${options.command}".`);
    printHelp();
    process.exit(1);
  }

  if (options.userIds.length === 0 && !options.allUsers) {
    console.error("Error: You must specify at least one user with --user-id <id> or use --all.");
    process.exit(1);
  }

  console.log(`[Manual Runner] Starting job "${options.command}"...`);

  let usersToProcess = [];
  try {
    let query = 'SELECT id, vendista_api_token, setup_date FROM users WHERE vendista_api_token IS NOT NULL AND setup_date IS NOT NULL';
    const queryParams = [];
    if (!options.allUsers) {
      query += ` AND id = ANY($1::int[])`;
      queryParams.push(options.userIds);
    }
    const userRes = await pool.query(query, queryParams);
    usersToProcess = userRes.rows;
    if (usersToProcess.length === 0) {
      console.warn('[Manual Runner] No users found for the specified criteria.');
      return;
    }
  } catch(e) {
    console.error('[Manual Runner] Failed to fetch users from DB:', e.message);
    process.exit(1);
  }
  
  for (const user of usersToProcess) {
    console.log(`\n[Manual Runner] Processing User ID: ${user.id}`);
    const plainToken = decrypt(user.vendista_api_token);
    if (!plainToken) {
        console.error(`  -> Failed to decrypt token for User ID ${user.id}. Skipping.`);
        continue;
    }

    switch(options.command) {
      case COMMANDS.IMPORT_TRANSACTIONS:
        let daysToImport = options.days;
        if (options.fullHistory) {
          daysToImport = moment().diff(moment(user.setup_date), 'days') + 1; // +1 to include today
          console.log(`  -> Full history import selected. Calculated days: ${daysToImport}`);
        }
        
        if (!daysToImport || daysToImport <= 0) {
          console.error('  -> Error: For transaction imports, you must specify --days <number> or --full-history.');
          continue;
        }
        console.log(`  -> Starting import for last ${daysToImport} days.`);
        await manualImportLastNDays(daysToImport, user.id);
        break;

      case COMMANDS.SYNC_TERMINALS:
        console.log('  -> Starting terminal sync.');
        await syncTerminalsForUser(user.id, plainToken);
        break;
    }
  }

  console.log('\n[Manual Runner] All requested jobs have been queued or executed.');
  // Give some time for queued jobs to be processed before exiting
  setTimeout(() => {
    console.log('[Manual Runner] Exiting.');
    process.exit(0);
  }, 15000); 
}

main().catch(e => {
  console.error('[Manual Runner] A critical error occurred:', e);
  process.exit(1);
}); 