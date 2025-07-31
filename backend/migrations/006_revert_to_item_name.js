exports.shorthands = undefined;

exports.up = async (pgm) => {
    // Начало транзакции
    await pgm.db.query('BEGIN');

    try {
        // === Шаг 1: Возвращаем столбцы item_name ===
        await pgm.db.query(`ALTER TABLE "inventories" ADD COLUMN "item_name" VARCHAR(100)`);
        await pgm.db.query(`ALTER TABLE "recipe_items" ADD COLUMN "item_name" VARCHAR(100)`);
        await pgm.db.query(`ALTER TABLE "inventory_change_log" ADD COLUMN "item_name" VARCHAR(100)`);

        // === Шаг 2: Заполняем новые столбцы item_name данными из таблицы ingredients ===
        // Обновляем inventories
        await pgm.db.query(`
            UPDATE inventories inv
            SET item_name = ing.name
            FROM ingredients ing
            WHERE inv.ingredient_id = ing.id
        `);
        // Обновляем recipe_items
        await pgm.db.query(`
            UPDATE recipe_items ri
            SET item_name = ing.name
            FROM ingredients ing
            WHERE ri.ingredient_id = ing.id
        `);
        // Обновляем inventory_change_log
        await pgm.db.query(`
            UPDATE inventory_change_log icl
            SET item_name = ing.name
            FROM ingredients ing
            WHERE icl.ingredient_id = ing.id
        `);
        
        // === Шаг 3: Удаляем ограничения, связанные с ingredient_id, и сами столбцы ===
        // --- inventories ---
        await pgm.db.query(`ALTER TABLE "inventories" DROP CONSTRAINT IF EXISTS "inventories_user_id_terminal_id_ingredient_id_location_key"`);
        await pgm.db.query(`ALTER TABLE "inventories" DROP COLUMN "ingredient_id"`);

        // --- recipe_items ---
        await pgm.db.query(`ALTER TABLE "recipe_items" DROP CONSTRAINT IF EXISTS "recipe_items_recipe_id_ingredient_id_key"`);
        await pgm.db.query(`ALTER TABLE "recipe_items" DROP COLUMN "ingredient_id"`);
        
        // --- inventory_change_log ---
        await pgm.db.query(`ALTER TABLE "inventory_change_log" DROP COLUMN "ingredient_id"`);

        // === Шаг 4: Устанавливаем NOT NULL для новых столбцов item_name ===
        // Делаем это после заполнения, чтобы не было проблем с существующими строками
        await pgm.db.query(`ALTER TABLE "inventories" ALTER COLUMN "item_name" SET NOT NULL`);
        await pgm.db.query(`ALTER TABLE "recipe_items" ALTER COLUMN "item_name" SET NOT NULL`);
        await pgm.db.query(`ALTER TABLE "inventory_change_log" ALTER COLUMN "item_name" SET NOT NULL`);

        // === Шаг 5: Воссоздаем старые уникальные ограничения для item_name ===
        await pgm.db.query(`ALTER TABLE "inventories" ADD CONSTRAINT "inventories_user_id_terminal_id_item_name_location_key" UNIQUE (user_id, terminal_id, item_name, location)`);
        await pgm.db.query(`ALTER TABLE "recipe_items" ADD CONSTRAINT "recipe_items_recipe_id_item_name_key" UNIQUE (recipe_id, item_name)`);

        // === Шаг 6: Удаляем таблицу ingredients ===
        // Это откатывает миграции 001 и 002
        await pgm.db.query(`DROP TABLE "ingredients"`);

        // Фиксируем транзакцию
        await pgm.db.query('COMMIT');
    } catch (e) {
        await pgm.db.query('ROLLBACK');
        console.error("Ошибка во время миграции, изменения отменены.", e);
        throw e;
    }
};

exports.down = async (pgm) => {
    // Откат этой миграции не предполагается, так как она сама является откатом.
    // Для возврата к схеме с ingredient_id нужно заново применить миграции 001, 002 и 005.
    console.log("Откат миграции 006_revert_to_item_name не поддерживается.");
};
