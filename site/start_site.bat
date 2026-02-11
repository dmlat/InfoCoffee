@echo off
setlocal EnableDelayedExpansion

REM === НАСТРОЙКИ ПРОЕКТА ===
set "PROJECT_NAME=InfoCoffe"
set "FRONTEND_PORT=4321"
set "WAIT_SECONDS=1"
set "NODE_PROCESS_NAME=node.exe"

for %%i in ("%~dp0.") do set "ROOT_DIR=%%~fi"
set "FRONTEND_DIR=%ROOT_DIR%"
set "RUN_FRONTEND=%ROOT_DIR%\_run_frontend.bat"

REM === ОСТАНОВКА СТАРЫХ ПРОЦЕССОВ ===
for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| findstr :%FRONTEND_PORT% ^| findstr LISTENING') do (
    set "PID=%%a"
    if not "!PID!"=="" if not "!PID!"=="0" (
        taskkill /PID !PID! /T /F >nul 2>&1
    )
)

REM Если процессы у вас другие, замените на свои
taskkill /IM %NODE_PROCESS_NAME% /F >nul 2>&1

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "Get-Process cmd -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -like '*%PROJECT_NAME%*' } | Stop-Process -Force -ErrorAction SilentlyContinue"

taskkill /FI "WINDOWTITLE eq %PROJECT_NAME% Frontend" /T /F >nul 2>&1

timeout /t %WAIT_SECONDS% /nobreak >nul 2>&1

REM === ГЕНЕРАЦИЯ СКРИПТА ЗАПУСКА ===
(
    echo @echo off
    echo title %PROJECT_NAME% Frontend
    echo cd /d "%FRONTEND_DIR%"
    echo call npm run dev
    echo pause
) > "%RUN_FRONTEND%"

REM === ЗАПУСК В ОДНОМ ОКНЕ (WT) ===
where wt >nul 2>&1
set "WT_EXISTS=%ERRORLEVEL%"

if "%WT_EXISTS%"=="0" (
    start "" wt new-tab --title "%PROJECT_NAME% Frontend" cmd /c "%RUN_FRONTEND%"
) else (
    start "%PROJECT_NAME% Frontend" cmd /c "%RUN_FRONTEND%"
)

exit
