@echo off
title Raccoon Studio
net session >nul 2>&1
if errorlevel 1 (
  powershell.exe -Command "Start-Process -FilePath '%~f0' -Verb RunAs" 2>nul
  exit /b 0
)
powershell.exe -ExecutionPolicy Bypass -NoProfile -File "%~dp0installer\gui-windows.ps1"
