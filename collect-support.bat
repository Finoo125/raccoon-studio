@echo off
title Raccoon Studio - Collect Support Info
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0collect-support.ps1"
echo.
pause
