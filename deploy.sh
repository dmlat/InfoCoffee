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

# --- Шаг 1: Установка зависимостей БЭКЕНДА ---
echo "[1/7] Checking backend dependencies..."
# Мы сравниваем package.json и package-lock.json с файлом-меткой .install-stamp
# Это надежнее, чем сравнивать с папкой node_modules, чье время изменения не всегда обновляется.
if [ ! -d "backend/node_modules" ] || [ "backend/package.json" -nt "backend/node_modules/.install-stamp" ] || [ "backend/package-lock.json" -nt "backend/node_modules/.install-stamp" ]; then
    echo "      Backend dependencies are missing or outdated. Installing..."
    (cd backend && npm install --omit=dev)
    touch backend/node_modules/.install-stamp # Создаем или обновляем файл-метку
    echo "      Backend dependencies installed."
else
    echo "      Backend dependencies are up-to-date. Skipping."
fi

# --- Шаг 2: Установка зависимостей и сборка ФРОНТЕНДА ---
echo "[2/7] Checking frontend dependencies and building..."
if [ ! -d "frontend/node_modules" ] || [ "frontend/package.json" -nt "frontend/node_modules/.install-stamp" ] || [ "frontend/package-lock.json" -nt "frontend/node_modules/.install-stamp" ]; then
    echo "      Frontend dependencies are missing or outdated. Installing..."
    (cd frontend && npm install)
    touch frontend/node_modules/.install-stamp # Создаем или обновляем файл-метку
    echo "      Frontend dependencies installed."
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