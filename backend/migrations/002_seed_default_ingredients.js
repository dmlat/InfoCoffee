exports.shorthands = undefined;

exports.up = async (pgm) => {
    const defaultIngredients = [
        { name: 'Кофе', unit: 'г' },
        { name: 'Вода', unit: 'мл' },
        { name: 'Сливки', unit: 'г' },
        { name: 'Какао', unit: 'г' },
        { name: 'Раф', unit: 'г' },
        { name: 'Стаканы', unit: 'шт' },
        { name: 'Крышки', unit: 'шт' },
        { name: 'Размешиватели', unit: 'шт' },
        { name: 'Сахар', unit: 'шт' },
        { name: 'Трубочки', unit: 'шт' },
        { name: 'Сироп 1', unit: 'мл' },
        { name: 'Сироп 2', unit: 'мл' },
        { name: 'Сироп 3', unit: 'мл' },
    ];

    for (const ingredient of defaultIngredients) {
        // Проверяем, существует ли уже такой шаблонный ингредиент
        const result = await pgm.db.query(
            `SELECT id FROM ingredients WHERE name = $1 AND owner_user_id IS NULL`,
            [ingredient.name]
        );

        // Если не существует, добавляем его
        if (result.rows.length === 0) {
            await pgm.db.query(
                `INSERT INTO ingredients (name, unit, owner_user_id) VALUES ($1, $2, NULL)`,
                [ingredient.name, ingredient.unit]
            );
        }
    }
};

exports.down = (pgm) => {
    const defaultIngredientNames = [
        'Кофе', 'Вода', 'Сливки', 'Какао', 'Раф', 'Стаканы',
        'Крышки', 'Размешиватели', 'Сахар', 'Трубочки',
        'Сироп 1', 'Сироп 2', 'Сироп 3'
    ];
    
    pgm.sql(`
        DELETE FROM ingredients 
        WHERE owner_user_id IS NULL 
        AND name IN ('${defaultIngredientNames.join("','")}')
    `);
};