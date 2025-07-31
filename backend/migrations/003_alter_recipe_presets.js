exports.shorthands = undefined;

exports.up = pgm => {
    pgm.alterColumn('recipe_presets', 'user_id', {
        allowNull: true
    });
};

exports.down = pgm => {
    pgm.alterColumn('recipe_presets', 'user_id', {
        allowNull: false
    });
};