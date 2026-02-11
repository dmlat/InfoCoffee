#!/bin/bash
# deploy.sh - Script for deploying updates to the Production Server (VA)

# Configuration
SERVER_ALIAS="ic"
REMOTE_DIR="/root/VA"
BRANCH="master"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${YELLOW}Starting deployment to ${SERVER_ALIAS} (${REMOTE_DIR})...${NC}"

# 1. Push local changes
echo -e "${YELLOW}1. Pushing local changes to GitHub...${NC}"
git push origin $BRANCH
if [ $? -ne 0 ]; then
    echo -e "${RED}Git push failed. Aborting.${NC}"
    exit 1
fi

# 2. SSH into server and update
echo -e "${YELLOW}2. Connecting to server to pull changes...${NC}"
ssh $SERVER_ALIAS "bash -s" << EOF
    set -e # Exit on error

    echo "   -> cd ${REMOTE_DIR}"
    cd ${REMOTE_DIR}

    echo "   -> git pull origin ${BRANCH}"
    git pull origin ${BRANCH}

    echo "   -> update TELEGRAM_WEB_APP_URL in backend/.env"
    bash ./update_app_version.sh
    echo "   -> TELEGRAM_WEB_APP_URL now:"
    grep "^TELEGRAM_WEB_APP_URL=" backend/.env

    echo "   -> npm install (in backend)"
    cd backend
    npm install --production

    echo "   -> Build and deploy frontend (TMA)"
    cd ../frontend
    npm install
    npm run build
    rsync -a --delete build/ /var/www/tma/

    echo "   -> Build and deploy site"
    cd ../site
    if [ -f package.json ]; then
        npm install
        npm run build
        rsync -a --delete build/ /var/www/site/
    else
        echo "      (site package.json not found, skipping build, using placeholder)"
    fi

    echo "   -> Restarting PM2 processes..."
    # Update process list just in case config changed
    pm2 reload ../ecosystem.config.js --update-env

    echo "   -> Deployment Success!"
EOF

if [ $? -eq 0 ]; then
    echo -e "${GREEN}Deployment completed successfully!${NC}"
else
    echo -e "${RED}Deployment failed on server.${NC}"
  exit 1
fi
