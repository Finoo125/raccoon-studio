@echo off
title Raccoon Studio Installer

:: Re-launch as Administrator if not elevated
net session >nul 2>&1
if errorlevel 1 (
    echo.
    echo   Requesting administrator privileges...
    powershell.exe -Command "Start-Process -FilePath '%~f0' -Verb RunAs" 2>nul
    if errorlevel 1 (
        echo.
        echo   Could not elevate. Right-click this file and choose "Run as administrator".
        pause
        exit /b 1
    )
    exit /b 0
)

:: Check for PowerShell 5.1+
where powershell.exe >nul 2>&1
if errorlevel 1 (
    echo.
    echo   ERROR: PowerShell not found. This requires Windows 10 or Windows 11.
    pause
    exit /b 1
)

:: Launch the TUI PowerShell installer
powershell.exe -ExecutionPolicy Bypass -NoProfile -File "%~dp0install-windows.ps1" %*
if errorlevel 1 (
    echo.
    echo   Installation encountered an error.
    echo   Check logs\ folder for the install log and send it when reporting an issue.
    echo.
)
pause
