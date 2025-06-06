// backend/utils/botHelpers.js
const moment = require('moment-timezone');
const TIMEZONE = 'Europe/Moscow';

const MONTHS = {
    'январь': 0, 'янв': 0, 'февраль': 1, 'фев': 1, 'март': 2, 'мар': 2,
    'апрель': 3, 'апр': 3, 'май': 4, 'июнь': 5, 'июл': 6, 'июль': 6,
    'август': 7, 'авг': 7, 'сентябрь': 8, 'сен': 8, 'октябрь': 9, 'окт': 9,
    'ноябрь': 10, 'ноя': 10, 'декабрь': 11, 'дек': 11
};

// --- ИНСТРУКЦИЯ ДЛЯ ПОЛЬЗОВАТЕЛЯ ---
const EXPENSE_INSTRUCTION = `
💸 **Как быстро записать расходы?**

Отправьте сообщение боту в одном из форматов:

*1️⃣  Просто сумма (запишется на сегодня):*
\`\`\`
1500
450.50
\`\`\`

*2️⃣  Сумма + Дата + Комментарий:*
(Комментарий не обязателен, год можно опустить)
\`\`\`
3000 05.05.2025
549,45 01.06 Аренда
\`\`\`

*3️⃣  Несколько расходов за разные даты:*
(Каждый расход с новой строки)
\`\`\`
1200
850 04.06 Кофе
3200 01.06
\`\`\`

*4️⃣  Несколько расходов за один день/месяц:*
(Укажите дату или месяц первой строкой)
\`\`\`
05.06.2025
3000
4000 бензин
\`\`\`
_Все расходы будут записаны на 5 июня 2025_

\`\`\`
Август
7000
1250,50 закупка
\`\`\`
_Все расходы будут записаны на 1 августа_
`;

/**
 * Разбирает сообщение пользователя на массив расходов.
 * @param {string} text - Текст сообщения.
 * @returns {object} Результат парсинга.
 */
function parseExpenseMessage(text) {
    const lines = text.trim().split('\n').filter(line => line.trim() !== '');
    if (lines.length === 0) {
        return { success: false, error: 'Сообщение пустое.' };
    }

    let baseDate = null;
    let expenses = [];
    const firstLine = lines[0].trim().toLowerCase();
    let lineOffset = 0;

    // --- Проверяем, является ли первая строка датой-заголовком ---
    const dateMatch = firstLine.match(/^(\d{1,2})[.,](\d{1,2})([.,](\d{2,4}))?$/);
    const monthNameKeys = Object.keys(MONTHS);
    const monthName = monthNameKeys.find(m => firstLine.startsWith(m));

    if (dateMatch) {
        const day = dateMatch[1];
        const month = dateMatch[2];
        const year = dateMatch[4] || moment().tz(TIMEZONE).format('YYYY');
        baseDate = moment.tz(`${year}-${month}-${day}`, "YYYY-MM-DD", TIMEZONE);
        if (!baseDate.isValid()) return { success: false, error: 'Некорректная дата в первой строке.' };
        lineOffset = 1;
    } else if (monthName) {
        const monthIndex = MONTHS[monthName];
        const currentYear = moment().tz(TIMEZONE).year();
        const currentMonth = moment().tz(TIMEZONE).month();
        
        if (monthIndex > currentMonth && !/ \d{4}$/.test(firstLine)) {
            return {
                success: true,
                needsClarification: true,
                month: monthName,
                monthIndex: monthIndex,
                expensesData: lines.slice(1),
                yearOptions: [currentYear - 1, currentYear]
            };
        }
        const yearMatch = firstLine.match(/(\d{4})$/);
        const year = yearMatch ? yearMatch[1] : currentYear;
        baseDate = moment().tz(TIMEZONE).year(year).month(monthIndex).startOf('month');
        lineOffset = 1;
    }

    const expenseLines = lines.slice(lineOffset);
    if(expenseLines.length === 0 && baseDate) {
        return { success: false, error: 'После указания даты необходимо ввести хотя бы один расход.' };
    }

    for (const line of expenseLines) {
        const expenseRegex = /^\s*(\d+([.,]\d+)?)\s*(.*)?$/;
        const match = line.trim().match(expenseRegex);

        if (!match) return { success: false, error: `Не удалось распознать формат строки: "${line}"` };

        const amount = parseFloat(match[1].replace(',', '.'));
        let expenseDate = baseDate;
        let comment = (match[3] || '').trim();
        
        const dateInLineMatch = comment.match(/^(\d{1,2}[.,]\d{1,2}([.,]\d{2,4})?)\s*/);

        if (baseDate && dateInLineMatch) {
             return { success: false, error: 'Если дата указана в первой строке, не указывайте ее в строках с расходами.' };
        }
        
        if (!baseDate && dateInLineMatch) {
            const dateStr = dateInLineMatch[1];
            const dateParts = dateStr.split(/[.,]/);
            const day = dateParts[0];
            const month = dateParts[1];
            const year = dateParts[2] || moment().tz(TIMEZONE).format('YYYY');
            
            expenseDate = moment.tz(`${year}-${month}-${day}`, "YYYY-MM-DD", TIMEZONE);
            if (!expenseDate.isValid()) return { success: false, error: `Некорректная дата в строке: "${line}"` };
            
            comment = comment.replace(dateInLineMatch[0], '').trim();
        }

        expenses.push({
            amount,
            comment,
            date: expenseDate ? expenseDate.toDate() : moment().tz(TIMEZONE).toDate()
        });
    }

    if (expenses.length === 0) {
        return { success: false, error: 'Не найдено корректных строк с расходами.' };
    }

    return { success: true, expenses };
}

module.exports = {
    EXPENSE_INSTRUCTION,
    parseExpenseMessage,
};