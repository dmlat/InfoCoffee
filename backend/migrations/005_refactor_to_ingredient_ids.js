exports.shorthands = undefined;

exports.up = async (pgm) => {
    // Начало транзакции
    await pgm.db.query('BEGIN');

    try {
        // --- Шаг 1: Добавить новые колонки ingredient_id (без NOT NULL пока) ---
        await pgm.db.query(`ALTER TABLE "inventories" ADD COLUMN "ingredient_id" INTEGER REFERENCES "ingredients"(id)`);
        await pgm.db.query(`ALTER TABLE "recipe_items" ADD COLUMN "ingredient_id" INTEGER REFERENCES "ingredients"(id)`);
        await pgm.db.query(`ALTER TABLE "inventory_change_log" ADD COLUMN "ingredient_id" INTEGER REFERENCES "ingredients"(id) ON DELETE SET NULL`);

        // --- Шаг 2: Создать персональные ингредиенты для существующих пользователей ---
        const usersResult = await pgm.db.query(`SELECT DISTINCT user_id FROM inventories WHERE user_id IS NOT NULL`);
        const ownerUserIds = usersResult.rows.map(r => r.user_id);
        const templatesResult = await pgm.db.query(`SELECT id, name, unit FROM ingredients WHERE owner_user_id IS NULL`);
        const ingredientTemplates = templatesResult.rows;

        for (const userId of ownerUserIds) {
            for (const template of ingredientTemplates) {
                await pgm.db.query(
                    `INSERT INTO ingredients (owner_user_id, name, unit) VALUES ($1, $2, $3) ON CONFLICT (owner_user_id, name) DO NOTHING`,
                    [userId, template.name, template.unit]
                );
            }
        }

        // --- Шаг 3: Обновить новые колонки, связав их с персональными ингредиентами ---
        await pgm.db.query(`
            UPDATE inventories inv
            SET ingredient_id = ing.id
            FROM ingredients ing
            WHERE inv.user_id = ing.owner_user_id AND inv.item_name = ing.name
        `);
        await pgm.db.query(`
            UPDATE recipe_items ri
            SET ingredient_id = ing.id
            FROM recipes r
            JOIN terminals t ON r.terminal_id = t.id
            JOIN ingredients ing ON t.user_id = ing.owner_user_id
            WHERE ri.recipe_id = r.id AND ri.item_name = ing.name
        `);
        await pgm.db.query(`
            UPDATE inventory_change_log icl
            SET ingredient_id = ing.id
            FROM ingredients ing
            WHERE icl.owner_user_id = ing.owner_user_id AND icl.item_name = ing.name
        `);

        // --- НОВЫЙ Шаг 3.1: Удалить "мусорные" записи, для которых не нашлось соответствия ---
        await pgm.db.query(`DELETE FROM "inventories" WHERE "ingredient_id" IS NULL`);
        await pgm.db.query(`DELETE FROM "recipe_items" WHERE "ingredient_id" IS NULL`);
        
        // --- Шаг 4: Удалить старые колонки и ПРИМЕНИТЬ ОГРАНИЧЕНИЯ ---
        await pgm.db.query(`ALTER TABLE "inventories" DROP CONSTRAINT IF EXISTS "inventories_user_id_terminal_id_item_name_location_key"`);
        await pgm.db.query(`ALTER TABLE "inventories" DROP COLUMN "item_name"`);
        await pgm.db.query(`ALTER TABLE "inventories" ALTER COLUMN "ingredient_id" SET NOT NULL`); // Теперь это безопасно
        await pgm.db.query(`ALTER TABLE "inventories" ADD CONSTRAINT inventories_user_id_terminal_id_ingredient_id_location_key UNIQUE (user_id, terminal_id, ingredient_id, location)`);

        await pgm.db.query(`ALTER TABLE "recipe_items" DROP CONSTRAINT IF EXISTS "recipe_items_recipe_id_item_name_key"`);
        await pgm.db.query(`ALTER TABLE "recipe_items" DROP COLUMN "item_name"`);
        await pgm.db.query(`ALTER TABLE "recipe_items" ALTER COLUMN "ingredient_id" SET NOT NULL`); // И здесь
        await pgm.db.query(`ALTER TABLE "recipe_items" ADD CONSTRAINT recipe_items_recipe_id_ingredient_id_key UNIQUE (recipe_id, ingredient_id)`);

        await pgm.db.query(`ALTER TABLE "inventory_change_log" DROP COLUMN "item_name"`);

        await pgm.db.query('COMMIT');
    } catch (e) {
        await pgm.db.query('ROLLBACK');
        throw e;
    }
};

exports.down = async (pgm) => {
    // Откат этой миграции сложен и не предполагается в рамках задачи
};