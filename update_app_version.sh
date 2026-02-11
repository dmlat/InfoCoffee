#!/bin/bash

ENV_FILE="./backend/.env"

BASE_WEB_APP_URL="https://app.infocoffee.ru/" 

if [ ! -f "$ENV_FILE" ]; then
    echo "Ошибка: Файл .env не найден по пути $ENV_FILE"
    echo "Убедитесь, что скрипт запущен из корневой директории проекта MyCoffeeAnalytics/"
    echo "Или исправьте путь в переменной ENV_FILE внутри скрипта."
    exit 1
fi

# Генерация нового timestamp'а для версии
NEW_VERSION=$(date +%Y%m%d%H%M%S)
NEW_WEB_APP_URL="${BASE_WEB_APP_URL}?v=${NEW_VERSION}"

# Временный файл для безопасного редактирования
TEMP_ENV_FILE=$(mktemp)

# Обновление или добавление TELEGRAM_WEB_APP_URL
if grep -q "^TELEGRAM_WEB_APP_URL=" "$ENV_FILE"; then
    # Строка существует, обновляем ее
    sed "s|^TELEGRAM_WEB_APP_URL=.*|TELEGRAM_WEB_APP_URL=${NEW_WEB_APP_URL}|" "$ENV_FILE" > "$TEMP_ENV_FILE"
else
    # Строка не существует, добавляем ее в конец файла
    cp "$ENV_FILE" "$TEMP_ENV_FILE"
    echo "" >> "$TEMP_ENV_FILE" # Добавляем пустую строку для отделения, если файл не заканчивался новой строкой
    echo "TELEGRAM_WEB_APP_URL=${NEW_WEB_APP_URL}" >> "$TEMP_ENV_FILE"
fi

# Заменяем старый .env новым, если sed отработал успешно
if [ $? -eq 0 ]; then
    mv "$TEMP_ENV_FILE" "$ENV_FILE"
    echo "Файл $ENV_FILE успешно обновлен."
    echo "TELEGRAM_WEB_APP_URL установлен в: ${NEW_WEB_APP_URL}"
    echo ""
    echo "ВАЖНО: Не забудьте перезапустить вашего Telegram бота (backend/bot.js),"
    echo "чтобы он начал использовать новый URL!"
    echo "Пример команды для перезапуска (зависит от вашего менеджера процессов, например, pm2):"
    echo "  pm2 restart botAppName"
    echo "Или если вы запускаете его напрямую:"
    echo "  (Остановите текущий процесс бота и запустите его заново: node backend/bot.js)"
else
    echo "Ошибка при обновлении файла $ENV_FILE с помощью sed."
    rm "$TEMP_ENV_FILE" # Удаляем временный файл
    exit 1
fi

exit 0