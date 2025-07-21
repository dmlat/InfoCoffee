// backend/utils/inventoryLogger.js
const { pool } = require('../db');

/**
 * Logs an inventory change to the database.
 * @param {object} logData - The data to log.
 * @param {import('pg').PoolClient} [client] - Optional. A pg Client to use for the query, for transactions.
 */
async function logInventoryChange(logData, client) {
  const {
    owner_user_id,
    changed_by_telegram_id,
    change_source,
    terminal_id = null,
    item_name,
    quantity_before,
    quantity_after,
  } = logData;

  const queryRunner = client || pool;

  try {
    await queryRunner.query(
      `INSERT INTO inventory_change_log (
        owner_user_id, changed_by_telegram_id, change_source, terminal_id, 
        item_name, quantity_before, quantity_after
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        owner_user_id,
        changed_by_telegram_id,
        change_source,
        terminal_id,
        item_name,
        quantity_before,
        quantity_after,
      ]
    );
  } catch (error) {
    console.error('Failed to log inventory change:', error);
    // В случае ошибки не прерываем основной процесс, просто логируем ошибку.
    // В реальном приложении здесь можно было бы добавить более надежный механизм обработки.
  }
}

module.exports = { logInventoryChange }; 