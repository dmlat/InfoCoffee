const { PgLiteral } = require('node-pg-migrate');

exports.shorthands = undefined;

exports.up = pgm => {
    pgm.createTable('ingredients', {
        id: 'id',
        owner_user_id: {
            type: 'integer',
            references: '"users"',
            onDelete: 'CASCADE',
            comment: 'ID пользователя-владельца. NULL для стандартных ингредиентов-шаблонов.'
        },
        name: {
            type: 'varchar(100)',
            notNull: true
        },
        unit: {
            type: 'varchar(20)',
            notNull: true
        },
        created_at: {
            type: 'timestamptz',
            notNull: true,
            default: pgm.func('now()')
        }
    }, {
        ifNotExists: true,
        constraints: {
            unique: ['owner_user_id', 'name']
        },
        comment: 'Таблица для хранения стандартных и кастомных ингредиентов.'
    });
};

exports.down = pgm => {
    pgm.dropTable('ingredients');
};