@echo off
setlocal

if not defined SESSION_ID set "SESSION_ID=debug-session"
if not defined RUN_ID set "RUN_ID=run2"
set "LOG_PATH=c:\InfoCoffe\.cursor\debug.log"

:: #region agent log
call :log H6 "backend.cmd:8" "start" "cwd=%cd%"
:: #endregion

exit /b 0

:log
set "HYP=%~1"
set "LOC=%~2"
set "MSG=%~3"
set "INFO=%~4"
for /f %%t in ('powershell -NoProfile -Command "[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()"') do set "TS=%%t"
powershell -NoProfile -Command "$payload=@{sessionId='%SESSION_ID%';runId='%RUN_ID%';hypothesisId='%HYP%';location='%LOC%';message='%MSG%';data=@{info='%INFO%'};timestamp=%TS%} | ConvertTo-Json -Compress; Add-Content -Path '%LOG_PATH%' -Value $payload"
exit /b 0
