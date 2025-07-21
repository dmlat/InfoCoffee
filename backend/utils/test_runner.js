// backend/utils/test_runner.js
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const pool = require('../db');
const { sendNotification } = require('./botNotifier');

// --- Functions to be called ---

/**
 * Creates a new task in the database manually.
 * @param {string} type - 'cleaning' or 'restock'
 * @param {number} terminalId - The internal ID of the terminal.
 */
async function createTask(type, terminalId) {
    if (!['cleaning', 'restock'].includes(type)) {
        throw new Error('Invalid task type. Use "cleaning" or "restock".');
    }
    if (isNaN(terminalId)) {
        throw new Error('Invalid terminalId. Must be a number.');
    }

    console.log(`Creating '${type}' task for terminal ID ${terminalId}...`);

    // 1. Get terminal owner and assignees
    // ИСПРАВЛЕНО: Изменено поле согласно DB.txt схеме
    const settingsRes = await pool.query(
        `SELECT t.user_id, s.assignee_id_cleaning, s.assignee_id_restock 
         FROM terminals t
         LEFT JOIN stand_service_settings s ON t.id = s.terminal_id
         WHERE t.id = $1`,
        [terminalId]
    );

    if (settingsRes.rowCount === 0) {
        throw new Error(`Terminal with ID ${terminalId} not found.`);
    }

    const { user_id: ownerUserId, assignee_id_cleaning, assignee_id_restock } = settingsRes.rows[0];

    // ИСПРАВЛЕНО: Выбираем assignee_id в зависимости от типа задачи
    let assignee_id;
    if (type === 'cleaning') {
        assignee_id = assignee_id_cleaning;
    } else if (type === 'restock') {
        assignee_id = assignee_id_restock;
    }

    if (!assignee_id) {
        console.warn(`Terminal ${terminalId} has no assignee for ${type}. Task will be created but nobody will be notified.`);
    }

    // 2. Create task
    let details = null;
    if (type === 'restock') {
        details = { items: 'Тестовый набор, Ингредиент 2' }; // Generic details for testing
    }

    // ИСПРАВЛЕНО: Используем assignee_id (единичное поле) вместо assignee_ids
    const insertRes = await pool.query(
        `INSERT INTO service_tasks (terminal_id, task_type, status, details, assignee_id)
         VALUES ($1, $2, 'pending', $3, $4) RETURNING id`,
        [terminalId, type, JSON.stringify(details), assignee_id]
    );
    
    const newTaskId = insertRes.rows[0].id;
    console.log(`Successfully created task with ID: ${newTaskId}`);
    return newTaskId;
}

/**
 * Sends a test notification to a user.
 * @param {number} userId - The Telegram ID of the user.
 * @param {string} message - The message to send.
 */
async function sendTestNotification(userId, message) {
    if (isNaN(userId)) {
        throw new Error('Invalid userId. Must be a number (Telegram ID).');
    }
    if (!message) {
        throw new Error('Message cannot be empty.');
    }

    console.log(`Sending message to Telegram ID ${userId}...`);
    await sendNotification(userId, message);
    console.log('Message sent successfully.');
}


// --- Main Execution Logic ---

function parseArgs(args) {
    const parsed = {};
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg.startsWith('--')) {
            const key = arg.slice(2);
            const nextArg = args[i + 1];
            if (nextArg && !nextArg.startsWith('--')) {
                parsed[key] = nextArg;
                i++; // Skip next argument
            } else {
                parsed[key] = true;
            }
        }
    }
    return parsed;
}

async function main() {
    const args = process.argv.slice(2);
    if (args.length < 1) {
        console.log('Usage: node test_runner.js <command> [options]');
        console.log('\nCommands:');
        console.log('  createTask --type=<type> --terminalId=<id>');
        console.log('  sendNotification --userId=<id> --message="<text>"');
        return;
    }

    const command = args[0];
    const options = parseArgs(args.slice(1));

    try {
        switch (command) {
            case 'createTask':
                await createTask(options.type, parseInt(options.terminalId, 10));
                break;
            case 'sendNotification':
                await sendTestNotification(parseInt(options.userId, 10), options.message);
                break;
            default:
                console.error(`Unknown command: ${command}`);
                break;
        }
    } catch (error) {
        console.error('An error occurred:', error.message);
    } finally {
        await pool.end();
    }
}

main(); 