@echo off
title Workbench - One Click Start
REM ============================================
REM  start-workbench.cmd - one-click start for the
REM  personal workbench (008). ASCII only for cmd
REM  code page safety. Double-click to run.
REM ============================================
set "PORT=8080"
set "URL=http://127.0.0.1:%PORT%"

echo [workbench] checking %URL% ...
netstat -ano | findstr ":%PORT% " | findstr LISTENING >nul
if %errorlevel%==0 goto :ready

echo [workbench] server not running, starting ...
start "workbench-server" /min cmd /c "cd /d "%~dp0" && npm run server"

echo [workbench] waiting for port ...
for /l %%i in (1,1,30) do (
  netstat -ano | findstr ":%PORT% " | findstr LISTENING >nul && goto :ready
  %SystemRoot%\System32\timeout.exe /t 1 /nobreak >nul
)
echo [workbench] TIMEOUT after 30s - check server logs manually
pause
exit /b 1

:ready
echo [workbench] ready, opening browser ...
start "" "%URL%"
echo [workbench] done: %URL%
pause
