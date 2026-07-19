#Requires -Version 5.1
<#
.SYNOPSIS
    Raccoon Studio uninstaller (Windows).
    Removes the desktop/Start-Menu shortcuts, the "Installed apps" registration,
    the generated launch scripts, and the installed ComfyUI runtime + app deps.
    Leaves the source folder intact so you can reinstall with install-windows.

    Invoked by the Programs-list "Uninstall" button (see Register-InstalledApp in
    install-windows.ps1), or run directly. Use -Quiet for no prompts, -DryRun to
    preview what would be removed.
#>
param([switch] $Quiet, [switch] $DryRun)
$ErrorActionPreference = 'Continue'
$RootDir = Split-Path -Parent $MyInvocation.MyCommand.Path

function Remove-IfExists([string]$path) {
    if (-not (Test-Path $path)) { return }
    if ($DryRun) { Write-Host "    [DryRun] would remove  $path" -ForegroundColor DarkGray; return }
    try { Remove-Item -Path $path -Recurse -Force -ErrorAction Stop; Write-Host "    removed  $path" -ForegroundColor Gray }
    catch { Write-Host "    ! could not remove $path : $_" -ForegroundColor Yellow }
}

Write-Host ''
Write-Host '  Raccoon Studio - Uninstall' -ForegroundColor Cyan
Write-Host ''
if (-not $Quiet -and -not $DryRun) {
    $yn = 'y'
    try { $yn = Read-Host '  Remove Raccoon Studio (ComfyUI, downloaded models, shortcuts)? [y/N]' }
    catch { $yn = 'y' }
    if ($yn -notmatch '^[Yy]') { Write-Host '  Cancelled.' -ForegroundColor DarkGray; exit 0 }
}

# 1) Stop running services first (web app :3000 + ComfyUI :8188)
$stopPs1 = Join-Path $RootDir 'stop.ps1'
if ((Test-Path $stopPs1) -and (-not $DryRun)) {
    try { & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $stopPs1 2>&1 | Out-Null } catch {}
}

# 2) Desktop shortcuts
$desktop = [Environment]::GetFolderPath('Desktop')
foreach ($n in 'Raccoon Studio','Start Raccoon Studio','Stop Raccoon Studio') {
    Remove-IfExists (Join-Path $desktop "$n.lnk")
}

# 3) Start Menu folder
Remove-IfExists (Join-Path ([Environment]::GetFolderPath('Programs')) 'Raccoon Studio')

# 4) "Installed apps" / Programs-list registration
Remove-IfExists 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\RaccoonStudio'

# 5) Generated launch scripts, icons, env, logs
foreach ($f in 'start-comfyui.ps1','start-comfyui.bat','start.bat','stop.ps1','stop.bat','raccoon-studio.ico') {
    Remove-IfExists (Join-Path $RootDir $f)
}
Remove-IfExists (Join-Path $RootDir 'app\public\raccoon-studio.ico')
Remove-IfExists (Join-Path $RootDir 'app\.env.local')
Remove-IfExists (Join-Path $RootDir 'app\.env.local.bak')
Remove-IfExists (Join-Path $RootDir 'logs')

# 6) Installed runtime (heavy, fully reinstallable)
Remove-IfExists (Join-Path $RootDir 'comfyui\ComfyUI')
Remove-IfExists (Join-Path $RootDir 'app\node_modules')

Write-Host ''
Write-Host '  Raccoon Studio has been uninstalled.' -ForegroundColor Green
Write-Host '  The source folder was kept - run install-windows.bat to reinstall.' -ForegroundColor DarkGray
Write-Host ''
if (-not $Quiet -and -not $DryRun) { try { Read-Host '  Press Enter to close' | Out-Null } catch {} }
