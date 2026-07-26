#Requires -Version 5.1
<#
  Raccoon Studio — one-shot Windows 11 bootstrap.

  Ensures Git is installed, makes sure the repo is present (clones it if you're
  not already inside it), runs the installer, and prints how to launch. Safe to
  re-run (idempotent). Intended to be invoked by the one-line command in the
  README, but also works if you clone manually and run it directly.
#>
$ErrorActionPreference = 'Stop'
$RepoUrl = 'https://github.com/Finoo125/raccoon-studio.git'

function Use-MachinePath {
    # winget puts new tools on the *persisted* PATH; pull it into this session so
    # we can use git right after installing it, without opening a new window.
    $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' +
                [Environment]::GetEnvironmentVariable('Path', 'User')
}

Write-Host ''
Write-Host '  == Raccoon Studio bootstrap ==' -ForegroundColor Magenta
Write-Host ''

# 1) Ensure Git
function Install-GitViaWinget {
    winget install --id Git.Git -e --source winget `
        --accept-package-agreements --accept-source-agreements --disable-interactivity
}
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Write-Host '  Installing Git via winget...' -ForegroundColor Cyan
    Install-GitViaWinget
    # winget's local package index corrupts often enough to be worth handling here
    # (0x8A15003F "the source data is corrupted or tampered"): every call fails in
    # under a second until the source is reset. Same repair as install-windows.ps1.
    if ($LASTEXITCODE -ne 0) {
        Write-Host '  winget failed — repairing its package source and retrying...' -ForegroundColor Yellow
        winget source reset --force
        winget source update
        Install-GitViaWinget
    }
    Use-MachinePath
}
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    throw ('Git is still not on PATH. If winget reported an error, install Git from ' +
           'https://git-scm.com/download/win, then open a new window and run bootstrap.ps1 again.')
}

# 2) Locate the repo (already inside it?) or clone it
if (Test-Path (Join-Path (Get-Location) 'install-windows.ps1')) {
    $Root = (Get-Location).Path
    Write-Host "  Using the repo in the current folder: $Root" -ForegroundColor Gray
} else {
    $Root = Join-Path (Get-Location) 'raccoon-studio'
    if (Test-Path (Join-Path $Root '.git')) {
        Write-Host '  Repo already cloned — pulling latest...' -ForegroundColor Cyan
        git -C $Root pull --ff-only
    } else {
        Write-Host '  Cloning Raccoon Studio...' -ForegroundColor Cyan
        git clone $RepoUrl $Root
    }
}

# 3) Run the installer (sets up ComfyUI + Python/Node deps, writes config, drops shortcuts)
Set-Location $Root
Write-Host ''
Write-Host '  Running the installer...' -ForegroundColor Cyan
& powershell -ExecutionPolicy Bypass -NoProfile -File (Join-Path $Root 'install-windows.ps1')

# 4) Done — tell the user how to launch
Write-Host ''
Write-Host '  ------------------------------------------------------------' -ForegroundColor Green
Write-Host '  Setup complete.' -ForegroundColor Green
Write-Host ("  Launch any time by double-clicking:  {0}\Raccoon Studio.bat" -f $Root) -ForegroundColor White
Write-Host '  (or the "Raccoon Studio" shortcut on your Desktop)' -ForegroundColor Gray
Write-Host '  ------------------------------------------------------------' -ForegroundColor Green
