@echo off
title Workbench - Stop
REM ============================================
REM  stop-workbench.cmd - stop the workbench server
REM  (8080). ASCII only for cmd code page safety.
REM  Double-click to run.
REM ============================================
set "PORT=8080"

echo [workbench] finding process on :%PORT% ...
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":%PORT% " ^| findstr LISTENING') do (
  echo [workbench] killing PID %%p ...
  taskkill /PID %%p /F >nul 2>&1
  goto :done
)
echo [workbench] no server running on :%PORT%

:done
echo [workbench] done.
pause
