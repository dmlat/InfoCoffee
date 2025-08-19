# Работа с PowerShell в Windows

В данном проекте основной средой для выполнения команд является **PowerShell** в Windows. Это накладывает некоторые особенности на то, как нужно запускать скрипты.

### 1. Запуск скриптов

Файлы с расширением `.sh` (например, `run-manual-job.sh`) предназначены для Linux-систем и **не будут работать** напрямую в PowerShell. Вместо них нужно вызывать исполняемый файл `node.js` и передавать ему путь к скрипту.

-   **Неправильно (не сработает):**
    ```powershell
    ./scripts/run-manual-job.sh direct-import --user-id 1
    ```

-   **Правильно:**
    ```powershell
    node backend/worker/manual_runner.js direct-import --user-id 1
    ```
    По сути, мы заменяем ` ./scripts/run-manual-job.sh` на `node backend/worker/manual_runner.js`.

### 2. Объединение команд

В PowerShell нельзя объединять несколько команд в одну строку с помощью оператора `&&`, как это принято в `bash` (Linux). Вместо этого используется точка с запятой `;`.

-   **Неправильно (не сработает):**
    ```powershell
    docker stop my-container && docker-compose down
    ```

-   **Правильно:**
    ```powershell
    docker stop my-container; docker-compose down
    ```
