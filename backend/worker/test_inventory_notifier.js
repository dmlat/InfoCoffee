// backend/worker/test_inventory_notifier.js
process.env.NODE_ENV = 'development';
require('dotenv').config({ path: __dirname + '/../.env.development' });

const { pool } = require('../db');
const { processInventoryChanges } = require('./inventory_notifier_worker');

async function runTest() {
    if (process.env.NODE_ENV !== 'development') {
        console.error('This test script can only be run in development mode.');
        return;
    }

    const client = await pool.connect();
    console.log('Running inventory notifier test...');

    try {
        // --- 1. Подготовка тестовых данных ---
        console.log('Preparing test data...');

        // Находим тестового пользователя (владельца) и сервисного исполнителя
        const ownerRes = await client.query(`SELECT id FROM users ORDER BY id ASC LIMIT 1`);
        if (ownerRes.rows.length === 0) throw new Error('No owner user found. Please register an owner first.');
        const ownerId = ownerRes.rows[0].id;
        
        const serviceUserRes = await client.query(`SELECT shared_with_telegram_id FROM user_access_rights WHERE owner_user_id = $1 AND access_level = 'service' LIMIT 1`, [ownerId]);
        if (serviceUserRes.rows.length === 0) throw new Error('No service user found for owner. Please create one.');
        const serviceTelegramId = serviceUserRes.rows[0].shared_with_telegram_id;

        // Находим тестовую стойку
        const terminalRes = await client.query(`SELECT id FROM terminals WHERE user_id = $1 LIMIT 1`, [ownerId]);
        if (terminalRes.rows.length === 0) throw new Error('No terminals found for owner. Please sync terminals first.');
        const terminalId = terminalRes.rows[0].id;

        // Очищаем предыдущие тестовые логи, если они есть
        await client.query(`DELETE FROM inventory_change_log WHERE owner_user_id = $1`, [ownerId]);

        // Создаем новые тестовые логи
        const testLogs = [
            // Склад
            { itemName: 'Кофе', terminalId: null, before: 10000, after: 12500 }, // +2500
            { itemName: 'Вода', terminalId: null, before: 20000, after: 18000 }, // -2000
            { itemName: 'Кофе', terminalId: null, before: 12500, after: 12000 }, // -500
            // Стойка
            { itemName: 'Кофе', terminalId: terminalId, before: 500, after: 1500 },    // +1000
            { itemName: 'Сливки', terminalId: terminalId, before: 800, after: 1200 },  // +400
            { itemName: 'Какао', terminalId: terminalId, before: 700, after: 650 },    // -50
        ];

        for (const log of testLogs) {
            await client.query(
                `INSERT INTO inventory_change_log 
                 (owner_user_id, changed_by_telegram_id, change_source, item_name, terminal_id, quantity_before, quantity_after, is_notified) 
                 VALUES ($1, $2, 'test_script', $3, $4, $5, $6, false)`,
                [ownerId, serviceTelegramId, log.itemName, log.terminalId, log.before, log.after]
            );
        }
        console.log(`${testLogs.length} test log entries created.`);

        // --- 2. Запуск воркера ---
        console.log('Running the inventory_notifier_worker...');
        await processInventoryChanges();
        console.log('Worker finished processing.');

        // --- 3. Проверка результата ---
        const checkRes = await client.query(`SELECT COUNT(*) FROM inventory_change_log WHERE owner_user_id = $1 AND is_notified = false`, [ownerId]);
        if (parseInt(checkRes.rows[0].count, 10) === 0) {
            console.log('✅ TEST PASSED: All test logs have been marked as notified.');
        } else {
            console.error('❌ TEST FAILED: Some test logs were not processed.');
        }

    } catch (error) {
        console.error('An error occurred during the test:', error);
    } finally {
        client.release();
        await pool.end();
        console.log('Test finished.');
    }
}

runTest(); 