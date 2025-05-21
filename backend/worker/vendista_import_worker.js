const axios = require('axios');
const db = require('../db');

/**
 * Запуск фонового импорта транзакций пользователя Vendista
 * @param {Object} params - { user_id, vendistaLogin, vendistaPass, first_coffee_date }
 */
async function startImport({ user_id, vendistaLogin, vendistaPass, first_coffee_date }) {
    try {
        const tokenResp = await axios.get('https://api.vendista.ru:99/token', {
            params: { login: vendistaLogin, password: vendistaPass }
        });
        const token = tokenResp.data.token;
        if (!token) {
            console.log('Vendista импорт: не удалось получить токен');
            return;
        }
        let fromDate = new Date(first_coffee_date);
        let toDate = new Date();
        let current = new Date(fromDate);
        while (current < toDate) {
            let rangeStart = current;
            let rangeEnd = new Date(current);
            rangeEnd.setDate(rangeEnd.getDate() + 7);
            if (rangeEnd > toDate) rangeEnd = new Date(toDate);

            const resp = await axios.get('https://api.vendista.ru:99/transactions', {
                params: {
                    token,
                    DateFrom: rangeStart.toISOString().slice(0,10) + 'T00:00:00',
                    DateTo: rangeEnd.toISOString().slice(0,10) + 'T23:59:59',
                    PageNumber: 1,
                    ItemsOnPage: 1000
                }
            });

            if (resp.data.items && resp.data.items.length) {
                for (let tr of resp.data.items) {
                    await db.query(`
                        INSERT INTO transactions
                        (id, coffee_shop_id, amount, transaction_time, result, reverse_id, terminal_comment, card_number, status, bonus, left_sum, left_bonus, user_id)
                        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
                        ON CONFLICT (id) DO NOTHING
                    `, [
                        tr.id,
                        tr.term_id || null,
                        tr.sum || 0,
                        tr.time,
                        tr.result || 0,
                        tr.reverse_id || 0,
                        tr.terminal_comment || '',
                        tr.card_number || '',
                        tr.status || 0,
                        tr.bonus || 0,
                        tr.left_sum || 0,
                        tr.left_bonus || 0,
                        user_id
                    ]);
                }
            }
            current = rangeEnd;
        }
        console.log('Vendista импорт: завершено для пользователя', user_id);
    } catch (e) {
        console.error('Vendista импорт: ошибка', e.message);
    }
}

module.exports = { startImport };
