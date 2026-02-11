#!/bin/bash
# deploy.sh - Script for deploying updates to the Production Server (VA)
# This script is designed to be run ON THE SERVER.

# Configuration
PROJECT_DIR="/root/VA"
BRANCH="master"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${YELLOW}Starting local deployment in ${PROJECT_DIR}...${NC}"

set -e # Exit on error

# 1. Pull changes from GitHub
echo -e "${YELLOW}1. Pulling changes from GitHub...${NC}"
cd ${PROJECT_DIR}
git pull origin ${BRANCH}

# 2. Update TELEGRAM_WEB_APP_URL in backend/.env
echo -e "${YELLOW}2. Updating TELEGRAM_WEB_APP_URL...${NC}"
bash ./update_app_version.sh
echo "   -> TELEGRAM_WEB_APP_URL now:"
grep "^TELEGRAM_WEB_APP_URL=" backend/.env

# 3. Backend update
echo -e "${YELLOW}3. Updating backend dependencies...${NC}"
cd backend
npm install --production

# 4. Frontend (TMA) update
echo -e "${YELLOW}4. Building and deploying TMA...${NC}"
cd ../frontend
npm install
npm run build
rsync -a --delete build/ /var/www/tma/

# 5. Site update
echo -e "${YELLOW}5. Building and deploying site...${NC}"
cd ../site
if [ -f package.json ]; then
    npm install
    npm run build
    rsync -a --delete build/ /var/www/site/
else
    echo -e "${YELLOW}   -> site package.json not found, skipping build, using placeholder.${NC}"
fi

# 6. Restart PM2
echo -e "${YELLOW}6. Restarting PM2 processes...${NC}"
pm2 reload ../ecosystem.config.js --update-env

echo -e "${GREEN}Deployment completed successfully!${NC}"
