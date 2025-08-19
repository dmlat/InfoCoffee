// backend/worker/manual_runner.js
const path = require('path');

// ВАЖНО: Загружаем переменные окружения ПЕРЕД всеми остальными импортами
if (process.env.NODE_ENV === 'production') {
    console.log('[ENV] Production mode detected. Loading .env');
    require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
} else {
    process.env.NODE_ENV = 'development'; // Принудительно устанавливаем для надежности
    console.log('[ENV] Defaulting to development mode. Loading .env.development');
    require('dotenv').config({ path: path.resolve(__dirname, '../.env.development') });
}

require('../utils/logger'); // Глобальное подключение логгера
const { pool } = require('../db');
const { decrypt, encrypt } = require('../utils/security');
const { getNewVendistaToken } = require('../utils/vendista');
const { manualImportLastNDays, runScheduledJob } = require('./schedule_imports');
const { syncTerminalsForUser } = require('./terminal_sync_worker');
const { directImport, showStats } = require('./direct_import');
const moment = require('moment');
const axios = require('axios');
const { checkPaymentStatus } = require('./payment_status_checker_worker'); // Импортируем

const COMMANDS = {
  IMPORT_TRANSACTIONS: 'import-transactions',
  SYNC_TERMINALS: 'sync-terminals',
  UPDATE_CREDS: 'update-creds',
  TEST_TOKEN: 'test-token',
  DIRECT_IMPORT: 'direct-import',
  SHOW_STATS: 'show-stats',
  TEST_SCHEDULE: 'test-schedule',
  CHECK_PAYMENT_STATUS: 'check-payment-status' // Новая команда
};

function parseArgs(args) {
    const options = {
        userIds: [],
        allUsers: false,
    };
    let i = 0;
    while (i < args.length) {
        const arg = args[i];
        if (arg.startsWith('--')) {
            const key = arg.slice(2);
            // Handle flags without values
            if (key === 'full-history' || key === 'all') {
                const camelCaseKey = key.replace(/-([a-z])/g, g => g[1].toUpperCase());
                options[camelCaseKey] = true;
                i++;
            } else { // Handle args with values
                const value = args[i + 1];
                if (value && !value.startsWith('--')) {
                    const camelCaseKey = key.replace(/-([a-z])/g, g => g[1].toUpperCase());
                    options[camelCaseKey] = value;
                    i += 2;
                } else {
                    // It's a flag without a value, or something is wrong
                    i++;
                }
            }
        } else {
            if (!options.command) {
                options.command = arg;
            }
            i++;
        }
    }
    // Specific handling for user-id as it can be a list
    if (options.userId) {
        options.userIds = String(options.userId).split(',').map(id => parseInt(id.trim(), 10));
    }
    return options;
}

async function testVendistaToken(userId, vendistaToken) {
  const VENDISTA_API_URL = process.env.VENDISTA_API_BASE_URL || 'https://api.vendista.ru:99';
  
  console.log(`    -> Testing token for User ID: ${userId}`);
  console.log(`    -> API URL: ${VENDISTA_API_URL}`);
  console.log(`    -> Token length: ${vendistaToken.length} characters`);
  console.log(`    -> Token (first 8 chars): ${vendistaToken.substring(0, 8)}...`);
  
  try {
    // Тест 1: Проверяем базовую валидность токена через простой API вызов
    console.log(`    -> Test 1: Basic token validation...`);
    const tokenTestResponse = await axios.get(`${VENDISTA_API_URL}/coffee_shop`, {
      params: { token: vendistaToken },
      timeout: 15000,
    });
    
    if (tokenTestResponse.status === 200 && tokenTestResponse.data) {
      console.log(`    -> ✅ Token is VALID! Found ${tokenTestResponse.data.length || 0} coffee shops.`);
      
      // Показываем информацию о кофейнях
      if (tokenTestResponse.data.length > 0) {
        console.log(`    -> Coffee shops found:`);
        tokenTestResponse.data.forEach((shop, index) => {
          console.log(`       ${index + 1}. ID: ${shop.id}, Name: ${shop.name || 'Unknown'}`);
        });
      }
    } else {
      console.log(`    -> ⚠️ Unexpected response format.`);
    }
    
    // Тест 2: Проверяем transactions endpoint с коротким периодом
    console.log(`    -> Test 2: Testing transactions endpoint...`);
    const today = moment().format('YYYY-MM-DD');
    const yesterday = moment().subtract(1, 'days').format('YYYY-MM-DD');
    
    const transactionTestResponse = await axios.get(`${VENDISTA_API_URL}/transactions`, {
      params: {
        token: vendistaToken,
        PageNumber: 1,
        ItemsOnPage: 10,
        DateFrom: `${yesterday}T00:00:00`,
        DateTo: `${today}T23:59:59`,
      },
      timeout: 15000,
    });
    
    if (transactionTestResponse.status === 200) {
      console.log(`    -> ✅ Transactions endpoint is accessible!`);
      console.log(`    -> Response structure: ${Object.keys(transactionTestResponse.data || {}).join(', ')}`);
      if (transactionTestResponse.data?.items) {
        console.log(`    -> Found ${transactionTestResponse.data.items.length} transactions for ${yesterday} - ${today}`);
      }
    }
    
  } catch (error) {
    console.log(`    -> ❌ Token test FAILED!`);
    console.error(`    -> Error: ${error.message}`);
    
    if (error.response) {
      console.error(`    -> Status: ${error.response.status}`);
      console.error(`    -> Response: ${JSON.stringify(error.response.data || {})}`);
      
      if (error.response.status === 404) {
        console.error(`    -> 🔍 404 Error suggests:`);
        console.error(`       - Token might be invalid or expired`);
        console.error(`       - API endpoint might be incorrect`);
        console.error(`       - User might need to renew their Vendista subscription`);
      } else if (error.response.status === 401 || error.response.status === 403) {
        console.error(`    -> 🔍 Authentication Error suggests:`);
        console.error(`       - Token is invalid or expired`);
        console.error(`       - User needs to re-authenticate with Vendista`);
      } else if (error.response.status === 402) {
        console.error(`    -> 🔍 Payment Required Error suggests:`);
        console.error(`       - User's Vendista subscription needs payment`);
        console.error(`       - Service is suspended due to billing issues`);
      }
    }
  }
}

function printHelp() {
    console.log(`
    InfoCoffee Manual Job Runner
    -----------------------------
    A script to manually trigger backend worker jobs for specific users.

    Usage:
      node backend/worker/manual_runner.js <command> [options]

    Commands:
      import-transactions   Imports transactions for users (via queue).
      direct-import         Direct import without queue (for debugging).
      sync-terminals        Syncs terminal lists for users.
      update-creds          Updates Vendista login and password for a user.
      test-token           Tests Vendista token validity.
      show-stats           Shows transaction statistics for a user.
      test-schedule        Tests scheduled import jobs immediately.
      check-payment-status  (New) Manually run the payment status checker.

    Options:
      --user-id <id1,id2,...>  (Required unless --all) Comma-separated list of user IDs from the 'users' table.
      --all                    Run the job for all active users.
      --days <number>          Number of past days to import.
      --full-history           Import all history since the user's setup_date. Overrides --days.
      --job <name>             (For test-schedule) Job name: '15min', 'daily', 'weekly'.

    Examples:
      # Queue import for user 1 (full history)
      node backend/worker/manual_runner.js import-transactions --user-id 1 --full-history

      # Direct import for debugging (bypasses queue)
      node backend/worker/manual_runner.js direct-import --user-id 1 --full-history
      node backend/worker/manual_runner.js direct-import --user-id 1 --days 7
      node backend/worker/manual_runner.js direct-import --user-id 1 --days 1  # Quick test

      # Show transaction statistics
      node backend/worker/manual_runner.js show-stats --user-id 1

      # Test scheduled jobs immediately
      node backend/worker/manual_runner.js test-schedule --job 15min
      node backend/worker/manual_runner.js test-schedule --job daily

      # Sync terminals for users 5 and 8
      node backend/worker/manual_runner.js sync-terminals --user-id 5,8

      # Test Vendista token validity for user 1
      node backend/worker/manual_runner.js test-token --user-id 1
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

  // Команды, которые не требуют пользователей
  if (options.command === COMMANDS.TEST_SCHEDULE) {
    console.log(`[Manual Runner] Testing scheduled job...`);
    const jobName = options.job || '15min';
    
    switch (jobName) {
      case '15min':
        console.log('Testing 15-minute import job...');
        await runScheduledJob('Test 15-Min Import', [1, 'days'], false);
        break;
      case 'daily':
        console.log('Testing daily import job...');
        await runScheduledJob('Test Daily Import', [3, 'days'], true);
        break;
      case 'weekly':
        console.log('Testing weekly import job...');
        await runScheduledJob('Test Weekly Import', [8, 'days'], true);
        break;
      default:
        console.error(`Unknown job type: ${jobName}. Use: 15min, daily, or weekly`);
        process.exit(1);
    }
    console.log('[Manual Runner] Test completed.');
    process.exit(0);
  }

  if (options.command === COMMANDS.CHECK_PAYMENT_STATUS) {
    console.log('[Manual Runner] Manually running Payment Status Checker...');
    await checkPaymentStatus();
    console.log('[Manual Runner] Payment Status Checker finished.');
    process.exit(0);
  }

  if (options.userIds.length === 0 && !options.allUsers) {
    console.error("Error: You must specify at least one user with --user-id <id> or use --all.");
    process.exit(1);
  }

  console.log(`[Manual Runner] Starting job "${options.command}"...`);

  let usersToProcess = [];
  try {
    let query = 'SELECT id, vendista_api_token, setup_date FROM users';
    const queryParams = [];
    
    // ИСПРАВЛЕНИЕ: Для команды update-creds не требуем наличия токена или даты
    if (options.command === COMMANDS.UPDATE_CREDS) {
        query += ' WHERE 1=1'
    } else {
        query += ' WHERE vendista_api_token IS NOT NULL AND setup_date IS NOT NULL'
    }

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
    
    let plainToken = null;
    // ИСПРАВЛЕНИЕ: Не пытаемся расшифровать токен для команды update-creds
    if (options.command !== COMMANDS.UPDATE_CREDS) {
        plainToken = decrypt(user.vendista_api_token);
        if (!plainToken) {
            console.error(`  -> Failed to decrypt token for User ID ${user.id}. Skipping.`);
            continue;
        }
    }

    switch(options.command) {
      case COMMANDS.IMPORT_TRANSACTIONS:
        let daysToImport = options.days;
        const isFullHistory = !!options.fullHistory;

        if (isFullHistory) {
          const setupDate = moment(user.setup_date);
          daysToImport = moment().diff(setupDate, 'days') + 1; // +1 to include today
          console.log(`  -> Full history import selected.`);
          console.log(`  -> Setup date: ${setupDate.format('YYYY-MM-DD')}`);
          console.log(`  -> Calculated days: ${daysToImport}`);
        }
        
        if (!daysToImport || daysToImport <= 0) {
          console.error('  -> Error: For transaction imports, you must specify --days <number> or --full-history.');
          continue;
        }
        
        console.log(`  -> Starting import for last ${daysToImport} days.`);
        console.log(`  -> Date range: ${moment().subtract(daysToImport, 'days').format('YYYY-MM-DD')} to ${moment().format('YYYY-MM-DD')}`);
        console.log(`  -> Token length: ${plainToken.length} characters`);
        console.log(`  -> Vendista API URL: ${process.env.VENDISTA_API_BASE_URL || 'https://api.vendista.ru:99'}`);
        
        await manualImportLastNDays(daysToImport, user.id, isFullHistory);
        break;

      case COMMANDS.SYNC_TERMINALS:
        console.log('  -> Starting terminal sync.');
        await syncTerminalsForUser(user.id, plainToken);
        break;

      case COMMANDS.UPDATE_CREDS:
        const { login, password } = options;
        if (!login || !password) {
            console.error('ERROR: --login and --password are required for update-creds command.');
            process.exit(1);
        }
        console.log(`  -> Updating Vendista credentials for user ${user.id}.`);
        
        const encryptedLogin = encrypt(login);
        const encryptedPassword = encrypt(password);

        // Also fetch a new token with the new credentials to ensure they are valid
        const newTokenResponse = await getNewVendistaToken(login, password);
        if (!newTokenResponse.success) {
            console.error(`ERROR: Failed to fetch a new token with the provided credentials. Are they correct? Aborting. Details: ${newTokenResponse.error}`);
            process.exit(1);
        }
        console.log('  -> Successfully fetched new token with provided credentials.');
        const encryptedToken = encrypt(newTokenResponse.token);

        await pool.query(
            `UPDATE users 
             SET vendista_login = $1, vendista_password = $2, vendista_api_token = $3, vendista_token_status = 'valid'
             WHERE id = $4`,
            [encryptedLogin, encryptedPassword, encryptedToken, user.id]
        );
        console.log(`  -> Credentials and new token for user ${user.id} successfully updated in the database.`);
        break;

      case COMMANDS.TEST_TOKEN:
        console.log('  -> Testing Vendista token validity.');
        await testVendistaToken(user.id, plainToken);
        break;

      case COMMANDS.DIRECT_IMPORT:
        let directDays = options.days;
        const directIsFullHistory = !!options.fullHistory;

        if (directIsFullHistory) {
          const setupDate = moment(user.setup_date);
          directDays = moment().diff(setupDate, 'days') + 1;
          console.log('  -> Direct import: full history selected.');
        } else if (!directDays || directDays <= 0) {
          console.error('  -> Error: For direct import, you must specify --days <number> or --full-history.');
          continue;
        }
        
        console.log(`  -> Starting direct import for ${directDays} days.`);
        await directImport(user.id, directDays, directIsFullHistory);
        break;

      case COMMANDS.SHOW_STATS:
        console.log('  -> Showing transaction statistics.');
        await showStats(user.id);
        break;
    }
  }

  console.log('\n[Manual Runner] All requested jobs have been queued or executed.');
  
  // Для import-transactions задачи уже переданы в очередь schedule_imports.js
  if (options.command === COMMANDS.IMPORT_TRANSACTIONS) {
    console.log('[Manual Runner] Import jobs have been queued in schedule_imports worker.');
    console.log('[Manual Runner] Check the logs or worker_logs table for import status.');
  }
  
  console.log('[Manual Runner] Exiting.');
  process.exit(0); 
}

main().catch(e => {
  console.error('[Manual Runner] A critical error occurred:', e);
  process.exit(1);
}); 