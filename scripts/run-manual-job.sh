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

echo "Executing manual job..."
echo ""

# Запускаем Node.js скрипт, передавая ему все аргументы, полученные этим скриптом ($@)
node backend/worker/manual_runner.js "$@"

echo ""
echo "Manual job script finished." 