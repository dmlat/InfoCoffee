// backend/routes/inventory.js

// ... (существующий код файла ... /move и т.д.)

// --- НОВЫЙ ЭНДПОИНТ: Обработать продажу и списать остатки ---
router.post('/process-sale', authMiddleware, async (req, res) => {
    const userId = req.user.userId;
    const { transaction } = req.body; // Ожидаем объект транзакции

    if (!transaction || !transaction.term_id || !transaction.machine_item_id) {
        // Это не ошибка, а штатная ситуация (например, сервисная операция)
        return res.status(200).json({ success: true, message: 'No recipe to process.' });
    }
    
    const client = await pool.pool.connect();
    try {
        await client.query('BEGIN');
        
        // 1. Найти внутренний ID терминала
        const terminalRes = await client.query(
            'SELECT id FROM terminals WHERE user_id = $1 AND vendista_terminal_id = $2',
            [userId, transaction.term_id]
        );
        if (terminalRes.rowCount === 0) {
            // Терминал еще не синхронизирован, это нормально на старте
            await client.query('ROLLBACK');
            return res.status(200).json({ success: true, message: 'Terminal not found in DB yet.' });
        }
        const internalTerminalId = terminalRes.rows[0].id;

        // 2. Найти рецепт для этого напитка на этом терминале
        const recipeRes = await client.query(
            `SELECT id FROM recipes WHERE terminal_id = $1 AND machine_item_id = $2`,
            [internalTerminalId, transaction.machine_item_id]
        );
        if (recipeRes.rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(200).json({ success: true, message: 'Recipe not found for this item.' });
        }
        const recipeId = recipeRes.rows[0].id;

        // 3. Получить состав рецепта
        const itemsRes = await client.query('SELECT item_name, quantity FROM recipe_items WHERE recipe_id = $1', [recipeId]);
        if (itemsRes.rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(200).json({ success: true, message: 'Recipe is empty.' });
        }

        // 4. Списать каждый ингредиент из инвентаря кофемашины
        for (const item of itemsRes.rows) {
            if (item.quantity > 0) {
                await client.query(
                    `UPDATE inventories 
                     SET current_stock = current_stock - $1, updated_at = NOW()
                     WHERE terminal_id = $2 AND item_name = $3 AND location = 'machine'`,
                    [item.quantity, internalTerminalId, item.item_name]
                );
            }
        }
        
        await client.query('COMMIT');
        res.status(200).json({ success: true, message: 'Stock updated successfully.' });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error(`[POST /api/inventory/process-sale] UserID: ${userId} - Error:`, err);
        sendErrorToAdmin({
            userId, errorContext: `POST /api/inventory/process-sale`,
            errorMessage: err.message, errorStack: err.stack, additionalInfo: { body: req.body }
        }).catch(console.error);
        // Не отправляем 500, чтобы не прерывать основной воркер, если что-то пошло не так
        res.status(200).json({ success: false, error: 'Server error during stock deduction.' });
    } finally {
        client.release();
    }
});


module.exports = router;