#!/bin/bash
# test_dev_startup.sh - Скрипт для проверки запуска в dev режиме

echo "=== Тестирование запуска в DEV режиме ==="
echo ""

# Проверяем зависимости
echo "1. Проверка зависимостей..."
cd backend
if [ ! -d "node_modules" ]; then
    echo "   ❌ Backend node_modules отсутствует. Устанавливаем..."
    npm install
else
    echo "   ✅ Backend node_modules найден"
fi

cd ../frontend
if [ ! -d "node_modules" ]; then
    echo "   ❌ Frontend node_modules отсутствует. Устанавливаем..."
    npm install
else
    echo "   ✅ Frontend node_modules найден"
fi

cd ..

# Проверяем корневые зависимости (для dev режима)
if [ ! -d "node_modules" ]; then
    echo "   ❌ Root node_modules отсутствует. Устанавливаем..."
    npm install
else
    echo "   ✅ Root node_modules найден"
fi

echo ""
echo "2. Проверка .env файлов..."
if [ -f "backend/.env.development" ]; then
    echo "   ✅ backend/.env.development найден"
else
    echo "   ❌ backend/.env.development ОТСУТСТВУЕТ!"
fi

if [ -f "frontend/.env" ]; then
    echo "   ✅ frontend/.env найден"
else
    echo "   ❌ frontend/.env ОТСУТСТВУЕТ!"
fi

echo ""
echo "3. Проверка Docker для базы данных..."
if docker ps | grep -q "ic-db-1"; then
    echo "   ✅ Docker контейнер базы данных запущен"
else
    echo "   ❌ Docker контейнер базы данных НЕ запущен"
    echo "   Запускаем: docker-compose up -d"
    docker-compose up -d
fi

echo ""
echo "4. Тестовый запуск бэкенда (5 секунд)..."
cd backend
timeout 5 node app.js &
BACKEND_PID=$!
sleep 6
if kill -0 $BACKEND_PID 2>/dev/null; then
    echo "   ✅ Бэкенд запустился успешно"
    kill $BACKEND_PID
else
    echo "   ❌ Бэкенд упал при запуске"
fi

cd ..
echo ""
echo "=== Тест завершен ==="
echo ""
echo "Для запуска полного dev-сервера используйте:"
echo "npm run dev"
