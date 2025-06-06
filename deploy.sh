#!/bin/bash

# --- CONFIGURATION ---
PM2_APP_NAME="infocoffee-backend"
PM2_BOT_NAME="infocoffee-bot"
PM2_SCHEDULER_NAME="infocoffee-scheduler"
WEB_ROOT="/var/www/va"
# --- END CONFIGURATION ---

# Exit immediately if a command exits with a non-zero status.
set -e

echo " "
echo "--- [START] Deployment for InfoCoffee ---"
echo " "

# Step 1: Build the frontend application
echo "[1/6] Building frontend..."
(cd frontend && npm run build)
echo "      Done."

# Step 2: Verify that the build directory exists
if [ ! -d "frontend/build" ]; then
  echo "      ERROR: 'frontend/build' directory not found. Build failed. Aborting."
  exit 1
fi
echo "      Build verified."

# Step 3: Update the web app version for cache busting
echo "[2/6] Updating application version..."
./update_app_version.sh
echo "      Done."

# Step 4: Synchronize files to the web root
echo "[3/6] Syncing files to ${WEB_ROOT}..."
sudo rsync -a --delete frontend/build/ ${WEB_ROOT}/
echo "      Done."

# Step 5: Set correct file permissions
echo "[4/6] Setting file permissions..."
sudo chown -R www-data:www-data ${WEB_ROOT}
sudo find ${WEB_ROOT} -type d -exec chmod 755 {} \;
sudo find ${WEB_ROOT} -type f -exec chmod 644 {} \;
echo "      Done."

# Step 6: Restart PM2 services
echo "[5/6] Restarting backend services..."
pm2 reload ${PM2_APP_NAME} --update-env
echo "      '${PM2_APP_NAME}' reloaded."
pm2 reload ${PM2_BOT_NAME} --update-env
echo "      '${PM2_BOT_NAME}' reloaded."
pm2 reload ${PM2_SCHEDULER_NAME} --update-env
echo "      '${PM2_SCHEDULER_NAME}' reloaded."

echo " "
echo "--- [SUCCESS] Deployment finished! ---"
echo " "

exit 0