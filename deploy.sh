#!/bin/bash
# --- CONFIGURATION ---
PM2_APP_NAME="infocoffee-backend"
PM2_BOT_NAME="infocoffee-bot"
PM2_SCHEDULER_NAME="infocoffee-scheduler"
WEB_ROOT="/var/www/va"
# --- END CONFIGURATION ---

set -e # Exit immediately if a command exits with a non-zero status.

echo " "
echo "--- [START] Deployment for InfoCoffee ---"
echo " "

# --- Умная установка зависимостей ---
NEEDS_INSTALL=false
if [ ! -d "backend/node_modules" ]; then
    echo "[1/7] 'node_modules' not found in backend. Dependencies will be installed."
    NEEDS_INSTALL=true
elif [ "backend/package.json" -nt "backend/node_modules" ] || [ "backend/package-lock.json" -nt "backend/node_modules" ]; then
    echo "[1/7] 'package.json' or 'package-lock.json' is newer. Dependencies will be re-installed."
    NEEDS_INSTALL=true
else
    echo "[1/7] Backend dependencies are up-to-date. Skipping installation."
fi

if [ "$NEEDS_INSTALL" = true ]; then
    (cd backend && npm install --omit=dev)
fi
# --- Конец умной установки ---

# Шаг 2: Сборка фронтенда
echo "[2/7] Building frontend..."
(cd frontend && REACT_APP_API_BASE_URL="https://infocoffee.ru/api" npm install && npm run build)
echo "      Done."

# Шаг 3: Проверка директории сборки
if [ ! -d "frontend/build" ]; then
  echo "      ERROR: 'frontend/build' directory not found. Build failed. Aborting."
  exit 1
fi
echo "      Build verified."

# Шаг 4: Обновление версии приложения (для сброса кеша)
echo "[4/7] Updating application version..."
./update_app_version.sh
echo "      Done."

# Шаг 5: Синхронизация файлов в корень веб-сервера
echo "[5/7] Syncing files to ${WEB_ROOT}..."
sudo rsync -a --delete frontend/build/ ${WEB_ROOT}/
echo "      Done."

# Шаг 6: Установка прав на файлы
echo "[6/7] Setting file permissions..."
sudo chown -R www-data:www-data ${WEB_ROOT}
sudo find ${WEB_ROOT} -type d -exec chmod 755 {} \;
sudo find ${WEB_ROOT} -type f -exec chmod 644 {} \;
echo "      Done."

# Шаг 7: Перезапуск PM2 сервисов с NODE_ENV=production
echo "[7/7] Restarting backend services in PRODUCTION mode..."
pm2 restart ${PM2_APP_NAME} --update-env
echo "      '${PM2_APP_NAME}' restarted."
pm2 restart ${PM2_BOT_NAME} --update-env
echo "      '${PM2_BOT_NAME}' restarted."
pm2 restart ${PM2_SCHEDULER_NAME} --update-env
echo "      '${PM2_SCHEDULER_NAME}' restarted."

echo " "
echo "--- [SUCCESS] Deployment finished! ---"
echo " "
exit 0