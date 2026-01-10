// backend/utils/envLoader.js
const path = require('path');
const fs = require('fs');

function loadEnv() {
    // Determine environment
    const nodeEnv = process.env.NODE_ENV || 'development';
    
    // Define paths
    const rootDir = path.resolve(__dirname, '..');
    const envPaths = {
        production: path.join(rootDir, '.env'),
        development: path.join(rootDir, '.env.development')
    };

    const targetPath = nodeEnv === 'production' ? envPaths.production : envPaths.development;

    console.log(`[EnvLoader] Loading configuration for: ${nodeEnv}`);
    console.log(`[EnvLoader] Target path: ${targetPath}`);

    // Check if file exists
    if (!fs.existsSync(targetPath)) {
        console.warn(`[EnvLoader] Warning: .env file not found at ${targetPath}`);
        if (nodeEnv === 'production') {
            console.error('[EnvLoader] CRITICAL: Production .env missing!');
        }
    }

    // Load environment variables
    const result = require('dotenv').config({ path: targetPath });

    if (result.error) {
        console.error('[EnvLoader] Error loading .env file:', result.error);
        throw result.error;
    }

    // Verify critical variables
    const criticalVars = ['PGHOST', 'PGUSER', 'PGDATABASE', 'TELEGRAM_BOT_TOKEN'];
    const missingVars = criticalVars.filter(key => !process.env[key]);

    if (missingVars.length > 0) {
        console.error(`[EnvLoader] Missing critical environment variables: ${missingVars.join(', ')}`);
        // In production, this should likely throw, but we'll just warn for now to avoid breaking existing setups immediately
        if (nodeEnv === 'production') {
             console.warn('[EnvLoader] Application may not function correctly.');
        }
    } else {
        console.log('[EnvLoader] Environment variables loaded successfully.');
    }
}

// Execute immediately upon require
loadEnv();

module.exports = { loadEnv };
