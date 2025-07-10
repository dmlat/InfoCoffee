const crypto = require('crypto');

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;
const ALGORITHM = 'aes-256-cbc';
const IV_LENGTH = 16;

if (process.env.NODE_ENV !== 'test' && !ENCRYPTION_KEY) {
    console.error('FATAL ERROR: ENCRYPTION_KEY is not defined in the environment variables.');
    process.exit(1);
}

function encrypt(text) {
    if (!text) return null;
    const key = Buffer.from(ENCRYPTION_KEY, 'hex');
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return iv.toString('hex') + ':' + encrypted;
}

function decrypt(text) {
    if (!text || typeof text !== 'string' || !text.includes(':')) {
        console.warn('Invalid text format for decryption, returning null.', { text });
        return null;
    }
    try {
        const textParts = text.split(':');
        const iv = Buffer.from(textParts.shift(), 'hex');
        const encryptedText = Buffer.from(textParts.join(':'), 'hex');
        const key = Buffer.from(ENCRYPTION_KEY, 'hex');
        const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
        let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
    } catch (error) {
        console.error('Decryption failed. Returning null.', {
            // Log only a portion of the text to avoid leaking sensitive data
            textSnippet: text.substring(0, 10) + '...', 
            error: error.message 
        });
        return null;
    }
}

module.exports = { encrypt, decrypt }; 