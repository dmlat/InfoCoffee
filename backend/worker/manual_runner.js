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
const { manualImportLastNDays } = require('./schedule_imports');
const { syncTerminalsForUser } = require('./terminal_sync_worker');
const moment = require('moment');
const axios = require('axios');

const COMMANDS = {
  IMPORT_TRANSACTIONS: 'import-transactions',
  SYNC_TERMINALS: 'sync-terminals',
  UPDATE_CREDS: 'update-creds',
  TEST_TOKEN: 'test-token'
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
    
    const transactionTestResponse = await axios.get(`${VENDISTA_API_URL}/transaction/report`, {
      params: {
        token: vendistaToken,
        page: 1,
        date_from: yesterday,
        date_to: today,
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
      import-transactions   Imports transactions for users.
      sync-terminals        Syncs terminal lists for users.
      update-creds          Updates Vendista login and password for a user.
      test-token           Tests Vendista token validity.

    Options:
      --user-id <id1,id2,...>  (Required unless --all) Comma-separated list of user IDs from the 'users' table.
      --all                    Run the job for all active users.
      --days <number>          (For import-transactions) Number of past days to import.
      --full-history           (For import-transactions) Import all history since the user's setup_date. Overrides --days.

    Examples:
      # Import last 7 days of transactions for user 1
      node backend/worker/manual_runner.js import-transactions --user-id 1 --days 7

      # Import full history from setup_date for user 10
      node backend/worker/manual_runner.js import-transactions --user-id 10 --full-history

      # Import last 30 days for multiple users
      node backend/worker/manual_runner.js import-transactions --user-id 1,2,3 --days 30

      # Sync terminals for users 5 and 8
      node backend/worker/manual_runner.js sync-terminals --user-id 5,8

      # Sync terminals for ALL users
      node backend/worker/manual_runner.js sync-terminals --all

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
        
        await manualImportLastNDays(daysToImport, user.id);
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
        const newToken = await getNewVendistaToken(login, password);
        if (!newToken) {
            console.error('ERROR: Failed to fetch a new token with the provided credentials. Are they correct? Aborting.');
            process.exit(1);
        }
        console.log('  -> Successfully fetched new token with provided credentials.');
        const encryptedToken = encrypt(newToken);

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
    }
  }

  console.log('\n[Manual Runner] All requested jobs have been queued or executed.');
  
  // Для import-transactions ждем завершения обработки очереди
  if (options.command === COMMANDS.IMPORT_TRANSACTIONS) {
    console.log('[Manual Runner] Waiting for import queue to complete...');
    
    // Ждем пока очередь не опустеет (максимум 10 минут)
    let waitTime = 0;
    const maxWaitTime = 10 * 60 * 1000; // 10 минут
    const checkInterval = 5000; // 5 секунд
    
    while (waitTime < maxWaitTime) {
      await new Promise(resolve => setTimeout(resolve, checkInterval));
      waitTime += checkInterval;
      
      // Проверяем статус импорта через логи или можно добавить проверку очереди
      if (waitTime % 30000 === 0) { // Каждые 30 секунд
        console.log(`[Manual Runner] Still waiting... (${Math.floor(waitTime/1000)}s elapsed)`);
      }
    }
    
    console.log('[Manual Runner] Import queue processing timeout reached or completed.');
  }
  
  console.log('[Manual Runner] Exiting.');
  process.exit(0); 
}

main().catch(e => {
  console.error('[Manual Runner] A critical error occurred:', e);
  process.exit(1);
}); 