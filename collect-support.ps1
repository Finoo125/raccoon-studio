# Raccoon Studio — collect a support bundle for troubleshooting.
# Double-click collect-support.bat (or run this) any time something misbehaves;
# it zips the logs plus a fresh GPU report onto your Desktop as one file to send us.
$ErrorActionPreference = 'SilentlyContinue'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Logs = Join-Path $Root 'logs'

if (-not (Test-Path $Logs) -or -not (Get-ChildItem $Logs -File -ErrorAction SilentlyContinue)) {
    Write-Host ''
    Write-Host '  No logs to collect yet — start Raccoon Studio at least once first.' -ForegroundColor Yellow
    Write-Host ''
    return
}

# Fresh GPU/driver dump next to the logs so it lands inside the zip.
if (Get-Command nvidia-smi -ErrorAction SilentlyContinue) {
    & nvidia-smi 2>&1 | Set-Content -Path (Join-Path $Logs 'nvidia-smi.txt') -Encoding UTF8
}

$Desktop = [Environment]::GetFolderPath('Desktop')
if (-not $Desktop -or -not (Test-Path $Desktop)) { $Desktop = $Root }
$Zip = Join-Path $Desktop 'Raccoon-Studio-Support.zip'

try {
    Compress-Archive -Path (Join-Path $Logs '*') -DestinationPath $Zip -Force -ErrorAction Stop
    Write-Host ''
    Write-Host '  Support file created on your Desktop:' -ForegroundColor Green
    Write-Host "      $Zip" -ForegroundColor Cyan
    Write-Host '  Send us that one file and we can see exactly what went wrong.' -ForegroundColor Green
    Write-Host ''
} catch {
    Write-Host ''
    Write-Host "  Could not create the support file. Please send the contents of:" -ForegroundColor Yellow
    Write-Host "      $Logs" -ForegroundColor Cyan
    Write-Host ''
}
