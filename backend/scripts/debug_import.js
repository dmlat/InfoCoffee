// backend/scripts/debug_import.js
const axios = require('axios');
const crypto = require('crypto');

// Конфигурация с сервера
const ENCRYPTION_KEY = 'aea5ddcb5271e0af6b0a950b5c68bebda29f93d5aba8de21494e9d7aaedec420';
const VENDISTA_API_URL = 'https://api.vendista.ru:99';

// Данные пользователя ID 1
const ENCRYPTED_TOKEN = 'e9c0f850b17699645883d9372c53a844:8e2b4a0bb815639c22143cef967bac20bfb2dbeca5e5fb78105a9b6d1f270b87';

// Функция расшифровки (копия из backend/utils/security.js)
function decrypt(text) {
    if (!text) return null;
    try {
        const textParts = text.split(':');
        const iv = Buffer.from(textParts.shift(), 'hex');
        const encryptedText = Buffer.from(textParts.join(':'), 'hex');
        // ПРАВКА: Ключ передается как hex-строка, преобразуем в Buffer
        const keyBuffer = Buffer.from(ENCRYPTION_KEY, 'hex'); 
        const decipher = crypto.createDecipheriv('aes-256-cbc', keyBuffer, iv);
        let decrypted = decipher.update(encryptedText);
        decrypted = Buffer.concat([decrypted, decipher.final()]);
        return decrypted.toString();
    } catch (error) {
        console.error('Decryption error:', error.message);
        return null;
    }
}

async function debugImport() {
    console.log('🔓 Decrypting token...');
    const token = decrypt(ENCRYPTED_TOKEN);
    if (!token) return;

    console.log('📡 Fetching transactions from Vendista (Jan 1, 2026 - Now)...');
    
    let allTransactions = [];
    let page = 1;
    let hasMore = true;

    while (hasMore) {
        try {
            console.log(`Requesting page ${page}...`);
            const response = await axios.get(`${VENDISTA_API_URL}/transactions`, {
                params: {
                    token: token,
                    DateFrom: '2026-01-01T00:00:00',
                    DateTo: new Date().toISOString(),
                    PageNumber: page,
                    ItemsOnPage: 1000 // Берем максимум
                },
                timeout: 30000
            });

            const items = response.data.items || [];
            allTransactions = allTransactions.concat(items);
            console.log(`  Received ${items.length} items.`);

            if (items.length < 1000) {
                hasMore = false;
            } else {
                page++;
            }
        } catch (error) {
            console.error('API Error:', error.message);
            break;
        }
    }

    console.log('---------------------------------------------------');
    console.log(`TOTAL Transactions fetched: ${allTransactions.length}`);
    
    const totalSum = allTransactions.reduce((acc, tx) => acc + (tx.sum || 0), 0);
    const totalAmount = allTransactions.reduce((acc, tx) => acc + (tx.amount || 0), 0);
    
    console.log(`Total 'sum' (raw): ${totalSum}`);
    console.log(`Total 'amount' (raw): ${totalAmount}`);
    console.log(`Total Sum (Rubles, if sum is kopecks): ${totalSum / 100}`);
    
    // Проверка на дубликаты ID
    const uniqueIds = new Set(allTransactions.map(tx => tx.id));
    console.log(`Unique IDs: ${uniqueIds.size}`);

    console.log('---------------------------------------------------');
    console.log('Checking first 5 transactions for field mapping:');
    allTransactions.slice(0, 5).forEach(tx => {
        console.log(`ID: ${tx.id}, Sum: ${tx.sum}, Amount: ${tx.amount}, Time: ${tx.time}`);
    });
}

debugImport();

