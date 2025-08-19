// backend/utils/test_runner.js
// ИСПРАВЛЕНО: Используем централизованную загрузку переменных окружения
require('./envLoader');

const pool = require('../db');
const { sendNotification } = require('./botNotifier');

// --- Functions to be called ---

/**
 * Creates a manual service task for a given terminal.
 * This is a test utility and should not be used in production.
 * @param {number} terminalId - The ID of the terminal.
 * @param {string} type - 'restock'
 * @param {string} [comment='Тестовая задача'] - An optional comment for the task.
 */
async function createTestTask(terminalId, type, comment = 'Тестовая задача') {
    if (type !== 'restock') {
        throw new Error('Invalid task type. Use "restock".');
    }

    let client;
    try {
        // 1. Get owner ID and assignee IDs from the database
        const settingsRes = await client.query(
            `SELECT t.user_id, s.assignee_id_restock
             FROM terminals t
             LEFT JOIN stand_service_settings s ON t.id = s.terminal_id
             WHERE t.id = $1`,
            [terminalId]
        );

        if (settingsRes.rowCount === 0) {
            throw new Error(`Terminal with ID ${terminalId} not found.`);
        }

        const { user_id: ownerUserId, assignee_id_restock } = settingsRes.rows[0];
        let assignee_id = null;

        assignee_id = assignee_id_restock;

        if (!assignee_id) {
            throw new Error(`No assignee found for task type '${type}' on terminal ${terminalId}.`);
        }

        // 2. Create task
        let details = null;
        if (type === 'restock') {
            details = { items: 'Тестовый набор, Ингредиент 2' }; // Generic details for testing
        }

        // ИСПРАВЛЕНО: Используем assignee_id (единичное поле) вместо assignee_ids
        const insertRes = await client.query(
            `INSERT INTO service_tasks (terminal_id, task_type, status, details, assignee_id)
             VALUES ($1, $2, 'pending', $3, $4) RETURNING id`,
            [terminalId, type, JSON.stringify(details), assignee_id]
        );
        
        const newTaskId = insertRes.rows[0].id;
        console.log(`Successfully created task with ID: ${newTaskId}`);
        return newTaskId;
    } catch (error) {
        console.error('Error creating test task:', error.message);
        process.exit(1);
    }
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
                await createTestTask(parseInt(options.terminalId, 10), options.type);
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