#!/bin/bash

# Скрипт-обертка для удобного запуска ручных задач из командной строки.
# Все переданные аргументы будут напрямую переданы в Node.js скрипт.
#
# Использование:
# ./scripts/run-manual-job.sh <command> [options]
#
# Примеры:
# ./scripts/run-manual-job.sh import-transactions --user-id 1 --days 7
# ./scripts/run-manual-job.sh sync-terminals --all
# ./scripts/run-manual-job.sh test-token --user-id 1

set -e  # Exit on any error

# Проверяем что скрипт запущен из корневой директории проекта
if [ ! -f "backend/worker/manual_runner.js" ]; then
    echo "❌ Error: This script must be run from the project root directory."
    echo "   Current directory: $(pwd)"
    echo "   Expected file: backend/worker/manual_runner.js"
    exit 1
fi

# Если нет аргументов или запрошена помощь
if [ $# -eq 0 ] || [ "$1" = "--help" ] || [ "$1" = "-h" ]; then
    echo "🔧 InfoCoffee Manual Job Runner"
    echo "================================"
    echo ""
    echo "This script runs manual backend jobs for InfoCoffee."
    echo ""
    echo "Usage: ./scripts/run-manual-job.sh <command> [options]"
    echo ""
    echo "Quick examples:"
    echo "  ./scripts/run-manual-job.sh test-token --user-id 1"
    echo "  ./scripts/run-manual-job.sh direct-import --user-id 1 --days 1     # Quick test"
    echo "  ./scripts/run-manual-job.sh direct-import --user-id 1 --full-history"
    echo "  ./scripts/run-manual-job.sh show-stats --user-id 1"
    echo "  ./scripts/run-manual-job.sh test-schedule --job 15min"
    echo "  ./scripts/run-manual-job.sh import-transactions --user-id 1 --days 7"
    echo ""
    echo "For detailed help: ./scripts/run-manual-job.sh --detailed-help"
    echo ""
    exit 0
fi

# Детальная помощь
if [ "$1" = "--detailed-help" ]; then
    node backend/worker/manual_runner.js --help
    exit 0
fi

echo "🚀 InfoCoffee Manual Job Runner"
echo "==============================="
echo ""
echo "Command: $*"
echo "Time: $(date '+%Y-%m-%d %H:%M:%S')"
echo ""

# Запускаем Node.js скрипт, передавая ему все аргументы
if node backend/worker/manual_runner.js "$@"; then
    echo ""
    echo "✅ Manual job completed successfully!"
    echo "Time: $(date '+%Y-%m-%d %H:%M:%S')"
else
    exit_code=$?
    echo ""
    echo "❌ Manual job failed with exit code: $exit_code"
    echo "Time: $(date '+%Y-%m-%d %H:%M:%S')"
    exit $exit_code
fi 