#Requires -Version 5.1
<#
  Raccoon Studio — one-shot Windows 11 bootstrap.

  Ensures Git is installed, makes sure the repo is present (clones it if you're
  not already inside it), runs the installer, and prints how to launch. Safe to
  re-run (idempotent). Intended to be invoked by the one-line command in the
  README, but also works if you clone manually and run it directly. Extra
  arguments are passed through to install-windows.ps1 (e.g. -Gpu amd).
#>
param([Parameter(ValueFromRemainingArguments = $true)] [string[]] $InstallerArgs = @())
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

# 0) Refuse to install into a Windows system folder.
# An elevated Command Prompt opens in C:\Windows\System32, and everything below
# is relative to the current folder — a user whose `cd` silently failed (an
# unquoted path with a space is enough) would otherwise install ~50 GB there.
# Checked before Git, so a mis-launch doesn't cost a 62 MB download first.
$cwd = (Get-Location).Path
if ($env:SystemRoot -and $cwd.StartsWith($env:SystemRoot, [StringComparison]::OrdinalIgnoreCase)) {
    throw ("This window is inside a Windows system folder ($cwd), which is not a place to " +
           'install anything. Open the folder you want Raccoon Studio in, type cmd in its ' +
           'address bar, and paste the command again. (If you prefer to type it: ' +
           'cd /d "E:\my folder" - quotes matter when the path has spaces.)')
}

# 1) Ensure Git
# Git being absent from PATH does not mean Git is absent: winget reports the
# install fine while leaving PATH untouched (a re-install reuses the previous
# "Git from Git Bash only" choice, and per-user installs land in LOCALAPPDATA).
# Look where it actually lands before concluding anything.
function Add-GitToPath {
    if (Get-Command git -ErrorAction SilentlyContinue) { return }
    foreach ($base in @($env:ProgramFiles, ${env:ProgramFiles(x86)}, "$env:LOCALAPPDATA\Programs")) {
        if (-not $base) { continue }
        foreach ($sub in @('Git\cmd', 'Git\bin')) {
            $dir = Join-Path $base $sub
            if (Test-Path (Join-Path $dir 'git.exe')) {
                Write-Host "  Found Git at $dir (it was not on PATH)" -ForegroundColor Gray
                $env:Path = "$dir;$env:Path"
                return
            }
        }
    }
}
function Install-GitViaWinget {
    winget install --id Git.Git -e --source winget `
        --accept-package-agreements --accept-source-agreements --disable-interactivity
}
Add-GitToPath
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
    Add-GitToPath
}
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    throw ('Git could not be found or installed. Install it from ' +
           'https://git-scm.com/download/win (accept the default options), then open a ' +
           'new window and paste the same command again.')
}

# 2) Locate the repo (already inside it?) or clone it
if (Test-Path (Join-Path (Get-Location) 'install-windows.ps1')) {
    $Root = (Get-Location).Path
    Write-Host "  Using the repo in the current folder: $Root" -ForegroundColor Gray
} else {
    $Root = Join-Path (Get-Location) 'raccoon-studio'
    if (Test-Path (Join-Path $Root '.git')) {
        Write-Host '  Repo already cloned — pulling latest...' -ForegroundColor Cyan
        # `npm install` rewrites the tracked app/package-lock.json when it disagrees
        # with package.json, so the pull would abort on a file nobody edited. It is
        # generated - the installer below rebuilds it. No 2>&1 here: under EAP=Stop
        # a redirected native stderr is a fatal NativeCommandError in WinPS 5.1.
        git -C $Root checkout -- app/package-lock.json
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
& powershell -ExecutionPolicy Bypass -NoProfile -File (Join-Path $Root 'install-windows.ps1') @InstallerArgs

# 4) Done — tell the user how to launch
Write-Host ''
Write-Host '  ------------------------------------------------------------' -ForegroundColor Green
Write-Host '  Setup complete.' -ForegroundColor Green
Write-Host ("  Launch any time by double-clicking:  {0}\Raccoon Studio.bat" -f $Root) -ForegroundColor White
Write-Host '  (or the "Raccoon Studio" shortcut on your Desktop)' -ForegroundColor Gray
Write-Host '  ------------------------------------------------------------' -ForegroundColor Green
