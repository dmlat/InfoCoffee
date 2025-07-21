// backend/worker/direct_import.js
const path = require('path');

// Загружаем переменные окружения
if (process.env.NODE_ENV === 'production') {
    console.log('[ENV] Production mode detected. Loading .env');
    require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
} else {
    process.env.NODE_ENV = 'development';
    console.log('[ENV] Defaulting to development mode. Loading .env.development');
    require('dotenv').config({ path: path.resolve(__dirname, '../.env.development') });
}

require('../utils/logger');
const { pool } = require('../db');
const { decrypt } = require('../utils/security');
const { importTransactionsForPeriod } = require('./vendista_import_worker');
const moment = require('moment-timezone');

async function directImport(userId, days, fullHistory = false) {
    console.log(`🔄 [Direct Import] Starting for User ${userId}...`);
    
    try {
        // Получаем данные пользователя
        const userRes = await pool.query(
            'SELECT id, vendista_api_token, setup_date, first_name, user_name FROM users WHERE id = $1',
            [userId]
        );
        
        if (userRes.rows.length === 0) {
            console.error(`❌ User ${userId} not found`);
            return;
        }
        
        const user = userRes.rows[0];
        console.log(`👤 User: ${user.first_name || 'N/A'} (@${user.user_name || 'N/A'})`);
        console.log(`📅 Setup date: ${user.setup_date}`);
        
        // Расшифровываем токен
        const plainToken = decrypt(user.vendista_api_token);
        if (!plainToken) {
            console.error(`❌ Failed to decrypt token for User ${userId}`);
            return;
        }
        console.log(`🔑 Token length: ${plainToken.length} characters`);
        
        // Вычисляем даты
        const dateTo = moment().tz('Europe/Moscow').format('YYYY-MM-DD');
        const dateFrom = fullHistory 
            ? moment(user.setup_date).format('YYYY-MM-DD')
            : moment().tz('Europe/Moscow').subtract(days, 'days').format('YYYY-MM-DD');
            
        console.log(`📊 Date range: ${dateFrom} to ${dateTo}`);
        
        // Проверяем количество транзакций ДО импорта
        const beforeRes = await pool.query(
            'SELECT COUNT(*) as count FROM transactions WHERE user_id = $1',
            [userId]
        );
        const beforeCount = parseInt(beforeRes.rows[0].count);
        console.log(`📈 Transactions in DB before: ${beforeCount}`);
        
        // Запускаем прямой импорт
        console.log(`🚀 Starting direct import...`);
        const startTime = Date.now();
        
        const result = await importTransactionsForPeriod({
            ownerUserId: userId,
            vendistaApiToken: plainToken,
            dateFrom,
            dateTo,
            fetchAllPages: true
        });
        
        const endTime = Date.now();
        const duration = Math.round((endTime - startTime) / 1000);
        
        console.log(`\n📊 IMPORT RESULTS:`);
        console.log(`⏱️  Duration: ${duration}s`);
        console.log(`✅ Success: ${result.success}`);
        console.log(`📄 Processed: ${result.processed || 0}`);
        console.log(`➕ Added: ${result.added || 0}`);
        console.log(`🔄 Updated: ${result.updated || 0}`);
        
        if (result.error) {
            console.log(`❌ Error: ${result.error}`);
        }
        
        // Проверяем количество транзакций ПОСЛЕ импорта
        const afterRes = await pool.query(
            'SELECT COUNT(*) as count FROM transactions WHERE user_id = $1',
            [userId]
        );
        const afterCount = parseInt(afterRes.rows[0].count);
        console.log(`📈 Transactions in DB after: ${afterCount}`);
        console.log(`📊 Net change: ${afterCount - beforeCount}`);
        
        // Показываем последние транзакции
        console.log(`\n🔍 LATEST TRANSACTIONS:`);
        const latestRes = await pool.query(
            `SELECT id, amount, transaction_time, result FROM transactions 
             WHERE user_id = $1 ORDER BY transaction_time DESC LIMIT 5`,
            [userId]
        );
        
        latestRes.rows.forEach(tx => {
            const amount = (parseFloat(tx.amount) / 100).toFixed(2);
            const time = moment(tx.transaction_time).tz('Europe/Moscow').format('DD.MM.YYYY HH:mm');
            console.log(`  ID: ${tx.id}, Amount: ${amount}₽, Time: ${time}, Result: ${tx.result}`);
        });
        
        return result;
        
    } catch (error) {
        console.error(`💥 Critical error in direct import:`, error.message);
        console.error(error.stack);
    }
}

async function showStats(userId) {
    console.log(`📊 [Stats] for User ${userId}:`);
    
    try {
        // Общая статистика
        const statsRes = await pool.query(`
            SELECT 
                COUNT(*) as total_transactions,
                MIN(transaction_time) as earliest,
                MAX(transaction_time) as latest,
                COUNT(DISTINCT coffee_shop_id) as terminals_count
            FROM transactions WHERE user_id = $1
        `, [userId]);
        
        const stats = statsRes.rows[0];
        console.log(`📄 Total transactions: ${stats.total_transactions}`);
        console.log(`📅 Date range: ${moment(stats.earliest).format('DD.MM.YYYY')} - ${moment(stats.latest).format('DD.MM.YYYY')}`);
        console.log(`🏪 Terminals: ${stats.terminals_count}`);
        
        // По месяцам
        console.log(`\n📈 BY MONTHS:`);
        const monthlyRes = await pool.query(`
            SELECT 
                DATE_TRUNC('month', transaction_time) as month,
                COUNT(*) as count
            FROM transactions 
            WHERE user_id = $1 
            GROUP BY month 
            ORDER BY month DESC 
            LIMIT 12
        `, [userId]);
        
        monthlyRes.rows.forEach(row => {
            const month = moment(row.month).format('MM/YYYY');
            console.log(`  ${month}: ${row.count} transactions`);
        });
        
    } catch (error) {
        console.error(`💥 Error getting stats:`, error.message);
    }
}

// CLI interface
if (require.main === module) {
    const args = process.argv.slice(2);
    
    if (args.length === 0 || args.includes('--help')) {
        console.log(`
🔧 Direct Import Tool

Commands:
  import <user-id> <days>           Import last N days
  import <user-id> full-history     Import full history  
  stats <user-id>                   Show transaction stats

Examples:
  node backend/worker/direct_import.js import 1 7
  node backend/worker/direct_import.js import 1 full-history
  node backend/worker/direct_import.js stats 1
        `);
        process.exit(0);
    }
    
    const command = args[0];
    const userId = parseInt(args[1]);
    
    if (!userId || isNaN(userId)) {
        console.error('❌ Valid user ID required');
        process.exit(1);
    }
    
    switch (command) {
        case 'import':
            const param = args[2];
            if (param === 'full-history') {
                directImport(userId, 0, true).then(() => process.exit(0));
            } else {
                const days = parseInt(param);
                if (!days || days <= 0) {
                    console.error('❌ Valid number of days required');
                    process.exit(1);
                }
                directImport(userId, days, false).then(() => process.exit(0));
            }
            break;
            
        case 'stats':
            showStats(userId).then(() => process.exit(0));
            break;
            
        default:
            console.error(`❌ Unknown command: ${command}`);
            process.exit(1);
    }
}

module.exports = { directImport, showStats }; 