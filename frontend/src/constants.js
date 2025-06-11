// frontend/src/constants.js
export const PERIODS = [
    { label: 'СЕГОДНЯ', getRange: () => { const d = new Date(); const from = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0); const to = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999); return [from, to]; }},
    { label: 'ВЧЕРА', getRange: () => { const d = new Date(); const from = new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1, 0, 0, 0, 0); const to = new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1, 23, 59, 59, 999); return [from, to]; }},
    { label: 'С НАЧАЛА НЕДЕЛИ', getRange: () => {
      const d = new Date(); const day = d.getDay();
      const diff = d.getDate() - day + (day === 0 ? -6 : 1);
      const from = new Date(d.setDate(diff)); from.setHours(0,0,0,0);
      const to = new Date(); to.setHours(23,59,59,999); return [from, to];
    }},
    { label: 'С НАЧАЛА МЕСЯЦА', getRange: () => { const d = new Date(); const from = new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0); const to = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999); return [from, to]; }},
    { label: 'ЗА 7 ДНЕЙ', getRange: () => { const d = new Date(); const from = new Date(d.getFullYear(), d.getMonth(), d.getDate() - 6, 0, 0, 0, 0); const to = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999); return [from, to]; }},
    { label: 'ЗА 30 ДНЕЙ', getRange: () => { const d = new Date(); const from = new Date(d.getFullYear(), d.getMonth(), d.getDate() - 29, 0, 0, 0, 0); const to = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999); return [from, to]; }},
    { label: 'С НАЧАЛА ГОДА', getRange: () => { const d = new Date(); const from = new Date(d.getFullYear(), 0, 1, 0, 0, 0, 0); const to = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999); return [from, to]; }},
    { label: 'ВАШ ПЕРИОД', getRange: () => [null, null] }
];

export function formatDateForInput(date) {
    if (!date) return '';
    const d = new Date(date);
    const year = d.getFullYear();
    const month = (`0${d.getMonth() + 1}`).slice(-2);
    const day = (`0${d.getDate()}`).slice(-2);
    return `${year}-${month}-${day}`;
}

// Новый унифицированный список товаров
export const ALL_ITEMS = [
    { name: 'Кофе', unit: 'кг', multiplier: 1000, type: 'ingredient' },
    { name: 'Вода', unit: 'л', multiplier: 1000, type: 'ingredient' },
    { name: 'Сливки', unit: 'кг', multiplier: 1000, type: 'ingredient' },
    { name: 'Какао', unit: 'кг', multiplier: 1000, type: 'ingredient' },
    { name: 'Раф', unit: 'кг', multiplier: 1000, type: 'ingredient' },
    { name: 'Стаканы', unit: 'шт', multiplier: 1, type: 'consumable', fullName: 'Стаканы' },
    { name: 'Крышки', unit: 'шт', multiplier: 1, type: 'consumable', fullName: 'Крышки' },
    { name: 'Размеш.', unit: 'шт', multiplier: 1, type: 'consumable', fullName: 'Размешиватели' },
    { name: 'Сахар', unit: 'шт', multiplier: 1, type: 'consumable', fullName: 'Сахар' },
    { name: 'Трубочки', unit: 'шт', multiplier: 1, type: 'consumable', fullName: 'Трубочки' },
];