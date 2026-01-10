exports.up = (pgm) => {
  pgm.alterColumn('transactions', 'id', {
    type: 'bigint',
    notNull: true,
  });
};

exports.down = (pgm) => {
  // Обратите внимание: обратное преобразование может не сработать, 
  // если в базе уже есть ID > 2.14 млрд.
  pgm.alterColumn('transactions', 'id', {
    type: 'integer',
    notNull: true,
  });
};
