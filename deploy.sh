#!/bin/bash
# --- CONFIGURATION ---
WEB_ROOT="/var/www/va"
# --- END CONFIGURATION ---

set -e # Exit immediately if a command exits with a non-zero status.

echo " "
echo "--- [START] Deployment for InfoCoffee ---"
echo " "

# --- Шаг 1: Установка зависимостей БЭКЕНДА ---
echo "[1/7] Checking backend dependencies..."

# Улучшенная проверка зависимостей backend
BACKEND_NEEDS_INSTALL=false

# Проверяем существование node_modules
if [ ! -d "backend/node_modules" ]; then
    echo "      Backend node_modules not found."
    BACKEND_NEEDS_INSTALL=true
fi

# Проверяем наличие .install-stamp
if [ ! -f "backend/node_modules/.install-stamp" ]; then
    echo "      Backend install stamp missing."
    BACKEND_NEEDS_INSTALL=true
fi

# Проверяем актуальность package.json
if [ -f "backend/node_modules/.install-stamp" ] && [ "backend/package.json" -nt "backend/node_modules/.install-stamp" ]; then
    echo "      Backend package.json is newer than install stamp."
    BACKEND_NEEDS_INSTALL=true
fi

# Проверяем актуальность package-lock.json
if [ -f "backend/node_modules/.install-stamp" ] && [ "backend/package-lock.json" -nt "backend/node_modules/.install-stamp" ]; then
    echo "      Backend package-lock.json is newer than install stamp."
    BACKEND_NEEDS_INSTALL=true
fi

if [ "$BACKEND_NEEDS_INSTALL" = true ]; then
    echo "      Backend dependencies need to be installed..."
    (cd backend && npm install --omit=dev)
    # Создаем директорию если не существует и обновляем метку
    mkdir -p backend/node_modules
    touch backend/node_modules/.install-stamp
    echo "      Backend dependencies installed and stamp updated."
else
    echo "      Backend dependencies are up-to-date. Skipping."
fi

# ДИАГНОСТИКА: Проверим ключевые зависимости
echo "[DIAGNOSTIC] Checking critical backend dependencies..."
if [ -d "backend/node_modules/dotenv" ]; then
    echo "      ✅ dotenv is installed"
else
    echo "      ❌ dotenv is MISSING - this will cause crashes!"
fi
if [ -d "backend/node_modules/node-telegram-bot-api" ]; then
    echo "      ✅ node-telegram-bot-api is installed"
else
    echo "      ❌ node-telegram-bot-api is MISSING"
fi

# --- Шаг 2: Установка зависимостей и сборка ФРОНТЕНДА ---
echo "[2/7] Checking frontend dependencies and building..."

# Улучшенная проверка зависимостей frontend
FRONTEND_NEEDS_INSTALL=false

# Проверяем существование node_modules
if [ ! -d "frontend/node_modules" ]; then
    echo "      Frontend node_modules not found."
    FRONTEND_NEEDS_INSTALL=true
fi

# Проверяем наличие .install-stamp
if [ ! -f "frontend/node_modules/.install-stamp" ]; then
    echo "      Frontend install stamp missing."
    FRONTEND_NEEDS_INSTALL=true
fi

# Проверяем актуальность package.json
if [ -f "frontend/node_modules/.install-stamp" ] && [ "frontend/package.json" -nt "frontend/node_modules/.install-stamp" ]; then
    echo "      Frontend package.json is newer than install stamp."
    FRONTEND_NEEDS_INSTALL=true
fi

# Проверяем актуальность package-lock.json
if [ -f "frontend/node_modules/.install-stamp" ] && [ "frontend/package-lock.json" -nt "frontend/node_modules/.install-stamp" ]; then
    echo "      Frontend package-lock.json is newer than install stamp."
    FRONTEND_NEEDS_INSTALL=true
fi

if [ "$FRONTEND_NEEDS_INSTALL" = true ]; then
    echo "      Frontend dependencies need to be installed..."
    (cd frontend && npm install)
    # Создаем директорию если не существует и обновляем метку
    mkdir -p frontend/node_modules
    touch frontend/node_modules/.install-stamp
    echo "      Frontend dependencies installed and stamp updated."
else
    echo "      Frontend dependencies are up-to-date. Skipping."
fi

echo "      Building frontend..."
(cd frontend && REACT_APP_API_BASE_URL="https://infocoffee.ru/api" npm run build)
echo "      Frontend built."


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

# ИСПРАВЛЕНИЕ: Корневые зависимости не нужны на проде, только для dev-режима
echo "[SKIP] Root dependencies not needed in production."

echo "Setting script permissions..."
chmod +x scripts/run-manual-job.sh

# Шаг 7: Перезапуск PM2 сервисов через ecosystem.config.js
echo "[7/7] Restarting backend services via ecosystem.config.js..."

# Проверяем наличие существующих PM2 процессов
if pm2 list 2>/dev/null | grep -q "infocoffee-backend\|infocoffee-scheduler"; then
    echo "      Found existing PM2 processes. Restarting with latest code and environment..."
    pm2 restart ecosystem.config.js --update-env
    echo "      ✅ PM2 processes restarted successfully."
else
    echo "      No existing PM2 processes found. Starting fresh from ecosystem.config.js..."
    pm2 start ecosystem.config.js
    echo "      ✅ PM2 processes started successfully."
fi

# Сохраняем конфигурацию PM2 для автозапуска при перезагрузке сервера
pm2 save
echo "      ✅ PM2 configuration saved for auto-startup."

# Показываем итоговый статус
echo " "
echo "📊 Final PM2 Status:"
pm2 list
echo " "
echo "      All backend services are running in PRODUCTION mode! 🚀"

echo " "
echo "--- [SUCCESS] Deployment finished! ---"
echo " "
exit 0