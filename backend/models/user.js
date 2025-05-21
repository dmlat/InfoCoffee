const db = require('../db');

async function findByEmail(email) {
    const res = await db.query('SELECT * FROM users WHERE email = $1', [email]);
    return res.rows[0];
}

async function createUser(email, passwordHash, firstCoffeeDate, taxMode, acquiringCommission) {
    const res = await db.query(
        `INSERT INTO users (email, password_hash, first_coffee_date, tax_mode, acquiring_commission)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [email, passwordHash, firstCoffeeDate, taxMode, acquiringCommission]
    );
    return res.rows[0];
}

module.exports = {
    findByEmail,
    createUser,
};
