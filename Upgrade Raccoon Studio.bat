@echo off
rem ---------------------------------------------------------------------------
rem  Upgrade Raccoon Studio - self-extracting.
rem
rem  Everything after the marker line at the bottom is PowerShell. This header
rem  writes that part out to %TEMP% and runs it from there.
rem
rem  One file is the whole point: this is posted as a single download for users
rem  whose Update button is dead, so it must not fetch anything to get started -
rem  security software that blocks the install one-liner would block that too.
rem
rem  Run with -File, never by piping into -Command: a pipe consumes stdin, and
rem  every prompt in the script would then read EOF instead of the user.
rem ---------------------------------------------------------------------------
setlocal
set "PS1=%TEMP%\upgrade-raccoon-studio.ps1"
rem The marker is concatenated at runtime so this line does not contain it -
rem otherwise IndexOf would find the header instead of the payload.
powershell -NoProfile -ExecutionPolicy Bypass -Command "$m='#PS'+'CODE'; $s=[IO.File]::ReadAllText('%~f0'); [IO.File]::WriteAllText($env:TEMP+'\upgrade-raccoon-studio.ps1', $s.Substring($s.IndexOf($m)+$m.Length))"
if not exist "%PS1%" (
  echo.
  echo   Could not unpack the upgrade script. Is PowerShell available?
  echo.
  pause
  exit /b 1
)
rem -LaunchedFrom: the payload runs from %TEMP%, so $PSCommandPath cannot tell it
rem where the user actually put this file - and "next to the .bat" is one of the
rem places we look for the installation. The trailing "." keeps the closing quote
rem from being escaped by %~dp0's trailing backslash.
powershell -NoProfile -ExecutionPolicy Bypass -File "%PS1%" -LaunchedFrom "%~dp0." %*
set "RC=%ERRORLEVEL%"
del "%PS1%" >nul 2>&1
exit /b %RC%
#PSCODE
#Requires -Version 5.1
<#
  Upgrade Raccoon Studio - repairs an installation whose Update button is dead.

  Releases v1.0.18-v1.0.34 shipped an `engines` block in app/package.json but not
  in app/package-lock.json. Every install ran `npm install`, npm wrote the missing
  block into the tracked lockfile, and from v1.0.35 on - the first release whose
  diff touches that lock - `git pull --ff-only` aborts on a file nobody edited.

  Those installs have no working button left: Update runs the machine's own old
  engine (no lockfile guard), Reinstall runs its own old installer (re-creates the
  dirty lock), and Repair never pulls. Every fix ships inside the update they
  cannot pull. This script arrives out of band and breaks that loop.

  Deliberately does NOT go through bootstrap.ps1: that calls install-windows.ps1
  with no arguments, so it would stop on an interactive prompt in a double-clicked
  window, and would reinstall CUDA wheels over a working ROCm venv. installer/
  engine.ps1 already passes -NonInteractive, an explicit ControlNet flag, and
  preserves the existing GPU stack, so the install is delegated there instead.

  -Path     rescue this folder instead of searching for it
  -DryRun   do everything except the actual install (used by the tests)
  -NoPause  do not wait for a keypress at the end (used by the tests)
#>
[CmdletBinding()]
param(
    [string] $Path,
    [string] $LaunchedFrom,
    [switch] $DryRun,
    [switch] $NoPause
)

# git writes ordinary progress to stderr, and under WinPS 5.1 a redirected native
# stderr with EAP=Stop becomes a fatal NativeCommandError. Every git call below is
# checked by exit code instead. Same trap as install-windows.ps1.
$ErrorActionPreference = 'Continue'

# Overridable so the tests can point at a local repo instead of GitHub. Never set
# in a real install.
$PublicRepo   = if ($env:RACCOON_PUBLIC_REPO) { $env:RACCOON_PUBLIC_REPO } else { 'https://github.com/Finoo125/raccoon-studio.git' }
$ReportName   = 'Raccoon Studio Upgrade Report.txt'
$TranscriptTo = Join-Path $env:TEMP ('raccoon-upgrade-{0}.log' -f (Get-Date -Format 'yyyyMMdd-HHmmss'))

# ── Output ───────────────────────────────────────────────────────────────────
$script:StepNo = 0
function Write-Step   ([string]$m) { $script:StepNo++; Write-Host ''; Write-Host ("  [{0}/6] {1}" -f $script:StepNo, $m) -ForegroundColor Cyan }
function Write-Detail ([string]$m) { Write-Host "        $m" -ForegroundColor Gray }
function Write-Note   ([string]$m) { Write-Host "        $m" -ForegroundColor Yellow }

# ── git ──────────────────────────────────────────────────────────────────────
# Returns exit code + combined output rather than throwing, so callers decide what
# a failure means. Nothing here may stop the script by itself: a failed git call
# still has to reach the report.
function Invoke-GitRaw {
    param([Parameter(Mandatory)][string[]] $Arguments)
    $out = & git @Arguments 2>&1 | ForEach-Object { "$_" }
    [pscustomobject]@{ ExitCode = $LASTEXITCODE; Output = (($out) -join [Environment]::NewLine) }
}

function Get-RepoVersion([string]$Root) {
    $d = Invoke-GitRaw @('-C', $Root, 'describe', '--tags', '--abbrev=0')
    if ($d.ExitCode -eq 0 -and $d.Output.Trim()) { return $d.Output.Trim() }
    # No tag reachable (a shallow or hand-made clone). The SHA still identifies it.
    $s = Invoke-GitRaw @('-C', $Root, 'rev-parse', '--short', 'HEAD')
    if ($s.ExitCode -eq 0 -and $s.Output.Trim()) { return "commit $($s.Output.Trim())" }
    return 'unknown'
}

# ── Finding the installation ─────────────────────────────────────────────────
# A folder counts only with both markers. .git alone matches any clone; the
# installer alone matches an unzipped copy with no history, which cannot be pulled.
function Test-RaccoonRoot([string]$Dir) {
    if (-not $Dir) { return $false }
    (Test-Path -LiteralPath (Join-Path $Dir '.git')) -and
    (Test-Path -LiteralPath (Join-Path $Dir 'install-windows.ps1'))
}

# install-windows.ps1 points the shortcut's WorkingDirectory at the install root,
# so the shortcut is an exact answer - no disk scan, no guessing.
function Resolve-ShortcutRoot([string]$Lnk) {
    if (-not (Test-Path -LiteralPath $Lnk)) { return $null }
    try {
        $sc = (New-Object -ComObject WScript.Shell).CreateShortcut($Lnk)
        foreach ($cand in @($sc.WorkingDirectory, (Split-Path -Parent $sc.TargetPath))) {
            if (Test-RaccoonRoot $cand) { return (Resolve-Path -LiteralPath $cand).Path }
        }
    } catch { }   # a broken .lnk must not stop the search
    return $null
}

function Find-RaccoonRoots {
    param([string[]] $Shortcuts = @(), [string[]] $Guesses = @())
    $found = New-Object System.Collections.Generic.List[string]
    foreach ($lnk in $Shortcuts) {
        $r = Resolve-ShortcutRoot $lnk
        if ($r) { [void]$found.Add($r) }
    }
    foreach ($g in $Guesses) {
        if (-not $g) { continue }
        foreach ($cand in @($g, (Join-Path $g 'raccoon-studio'))) {
            if (Test-RaccoonRoot $cand) { [void]$found.Add((Resolve-Path -LiteralPath $cand).Path) }
        }
    }
    @($found | Select-Object -Unique)
}

# Last resort only. Depth-limited and directories-only on purpose: an install sits
# a few levels down, while the tens of gigabytes of model files under it do not
# need to be walked to find it.
function Search-RaccoonRoots {
    $hits = New-Object System.Collections.Generic.List[string]
    foreach ($drive in [IO.DriveInfo]::GetDrives()) {
        if ($drive.DriveType -ne 'Fixed' -or -not $drive.IsReady) { continue }
        $root = $drive.RootDirectory.FullName
        Write-Detail ("searching {0} - this can take a minute..." -f $root)
        $dirs = Get-ChildItem -LiteralPath $root -Directory -Depth 3 -Force -ErrorAction SilentlyContinue
        foreach ($d in $dirs) {
            if ($env:SystemRoot -and $d.FullName.StartsWith($env:SystemRoot, [StringComparison]::OrdinalIgnoreCase)) { continue }
            if (Test-RaccoonRoot $d.FullName) { [void]$hits.Add($d.FullName) }
        }
    }
    @($hits | Select-Object -Unique)
}

function Select-RaccoonRoot([string[]] $Roots) {
    if ($Roots.Count -eq 1) { return $Roots[0] }
    Write-Host ''
    Write-Note 'More than one installation found:'
    for ($i = 0; $i -lt $Roots.Count; $i++) { Write-Host ("          {0}) {1}" -f ($i + 1), $Roots[$i]) }
    Write-Host ''
    $answer = Read-Host '        Which one should be upgraded? (number)'
    $idx = 0
    if (-not [int]::TryParse($answer, [ref]$idx) -or $idx -lt 1 -or $idx -gt $Roots.Count) {
        throw 'No installation chosen. Run the file again and enter one of the listed numbers.'
    }
    $Roots[$idx - 1]
}

# ── Git availability ─────────────────────────────────────────────────────────
# Git missing from PATH does not mean Git is missing: winget reports a successful
# install while leaving PATH untouched, and per-user installs land in LOCALAPPDATA.
# Look where it actually lands before concluding anything. (Same probe as
# bootstrap.ps1 - kept here so this file stays a single self-contained download.)
function Add-GitToPath {
    if (Get-Command git -ErrorAction SilentlyContinue) { return }
    foreach ($base in @($env:ProgramFiles, ${env:ProgramFiles(x86)}, "$env:LOCALAPPDATA\Programs")) {
        if (-not $base) { continue }
        foreach ($sub in @('Git\cmd', 'Git\bin')) {
            $dir = Join-Path $base $sub
            if (Test-Path (Join-Path $dir 'git.exe')) {
                Write-Detail "found Git at $dir (it was not on PATH)"
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

function Assert-Git {
    Add-GitToPath
    if (Get-Command git -ErrorAction SilentlyContinue) { return }
    Write-Detail 'Git is not installed - installing it with winget...'
    Install-GitViaWinget
    # winget's local package index corrupts often enough to be worth handling here
    # (0x8A15003F "the source data is corrupted or tampered"): every call fails in
    # under a second until the source is reset.
    if ($LASTEXITCODE -ne 0) {
        Write-Note 'winget failed - repairing its package source and retrying...'
        winget source reset --force
        winget source update
        Install-GitViaWinget
    }
    # winget puts new tools on the *persisted* PATH; pull it into this session so
    # git is usable right away, without opening a new window.
    $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' +
                [Environment]::GetEnvironmentVariable('Path', 'User')
    Add-GitToPath
    if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
        throw ('Git could not be installed automatically. Install it from ' +
               'https://git-scm.com/download/win (accept the default options), then run this file again.')
    }
}

# ── Failure report ───────────────────────────────────────────────────────────
function Write-UpgradeReport {
    param([string] $Reason, [string] $Root, [string] $Before, [string] $After)
    $desktop = [Environment]::GetFolderPath('Desktop')   # follows a OneDrive-redirected Desktop
    if (-not $desktop -or -not (Test-Path -LiteralPath $desktop)) { $desktop = $env:USERPROFILE }
    $file = Join-Path $desktop $ReportName

    $lines = New-Object System.Collections.Generic.List[string]
    $lines.Add('Raccoon Studio - upgrade report')
    $lines.Add('Generated: ' + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'))
    $lines.Add('Windows:   ' + [Environment]::OSVersion.VersionString)
    $lines.Add('Failed at: ' + $Reason)
    $lines.Add('Install:   ' + $(if ($Root) { $Root } else { '(not found)' }))
    $lines.Add('HEAD before / after: ' + $(if ($Before) { $Before } else { '?' }) + ' / ' + $(if ($After) { $After } else { '?' }))
    $lines.Add('')

    if ($Root) {
        $lines.Add('--- git status ---')
        $lines.Add((Invoke-GitRaw @('-C', $Root, 'status')).Output)
        $lines.Add('')
        # The installer's own log is where a real failure lands - the transcript
        # below usually only shows that the installer exited non-zero.
        $logDir = Join-Path $Root 'logs'
        $newest = Get-ChildItem -LiteralPath $logDir -Filter 'install-*.log' -ErrorAction SilentlyContinue |
                  Sort-Object LastWriteTime -Descending | Select-Object -First 1
        if ($newest) {
            $lines.Add('--- last 200 lines of ' + $newest.Name + ' ---')
            $lines.Add(((Get-Content -LiteralPath $newest.FullName -Tail 200) -join [Environment]::NewLine))
            $lines.Add('')
        }
    }

    $lines.Add('--- upgrade script transcript ---')
    if (Test-Path -LiteralPath $TranscriptTo) {
        $lines.Add(((Get-Content -LiteralPath $TranscriptTo) -join [Environment]::NewLine))
    } else {
        $lines.Add('(no transcript captured)')
    }

    Set-Content -LiteralPath $file -Value ($lines -join [Environment]::NewLine) -Encoding UTF8
    $file
}

# ── Main ─────────────────────────────────────────────────────────────────────
try { Start-Transcript -Path $TranscriptTo -Force | Out-Null } catch { }

$Root = $null; $Before = ''; $After = ''; $Stage = 'startup'; $ExitCode = 0

Write-Host ''
Write-Host '  == Upgrade Raccoon Studio ==' -ForegroundColor Magenta
Write-Host '  Brings an installation that can no longer update itself back to the' -ForegroundColor Gray
Write-Host '  latest version. Your images, models and settings are not touched.' -ForegroundColor Gray

try {
    # 1 ─ find it
    $Stage = 'finding the installation'
    Write-Step 'Finding your Raccoon Studio installation...'
    if ($Path) {
        if (-not (Test-RaccoonRoot $Path)) { throw "$Path is not a Raccoon Studio installation (no .git and install-windows.ps1 in it)." }
        $Root = (Resolve-Path -LiteralPath $Path).Path
    } else {
        $desktop   = [Environment]::GetFolderPath('Desktop')
        $startMenu = Join-Path ([Environment]::GetFolderPath('ApplicationData')) 'Microsoft\Windows\Start Menu\Programs'
        $here      = if ($LaunchedFrom) { $LaunchedFrom } else { Split-Path -Parent $PSCommandPath }
        $roots = Find-RaccoonRoots -Shortcuts @(
                        (Join-Path $desktop   'Raccoon Studio.lnk'),
                        (Join-Path $startMenu 'Raccoon Studio.lnk')
                    ) -Guesses @($here, $env:USERPROFILE, (Join-Path $env:USERPROFILE 'Downloads'))
        if ($roots.Count -eq 0) {
            Write-Detail 'not found in the usual places - searching your drives...'
            $roots = Search-RaccoonRoots
        }
        if ($roots.Count -eq 0) {
            throw ('No Raccoon Studio installation found on this computer. If it is on a drive ' +
                   'that was not connected, plug it in and run this file again - or run this file ' +
                   'with the folder given directly, for example: "Upgrade Raccoon Studio.bat" -Path "D:\Tools\raccoon-studio"')
        }
        $Root = Select-RaccoonRoot $roots
    }
    Write-Detail "found: $Root"

    # 2 ─ git
    $Stage = 'checking Git'
    Write-Step 'Checking Git...'
    Assert-Git
    $Before = (Invoke-GitRaw @('-C', $Root, 'rev-parse', 'HEAD')).Output.Trim()
    Write-Detail ('Git is ready. Current version: {0}' -f (Get-RepoVersion $Root))

    # 3 ─ clear the blockage
    # Everything the user owns is gitignored - the models under comfyui/ComfyUI/,
    # /data/, /logs/, app/.env.local - so discarding *all* tracked edits is safe and
    # kills the whole class of pull-blocking files, not just the lockfile we know
    # about. `git clean` is deliberately never run: that would delete untracked files.
    $Stage = 'clearing files that block updates'
    Write-Step 'Clearing files that block updates...'
    # -uno: only *tracked* modifications can block a fast-forward pull, and only
    # those are what `checkout -- .` restores. Counting untracked files would fail
    # the upgrade over a stray notes.txt the user left in the folder.
    $dirty = (Invoke-GitRaw @('-C', $Root, 'status', '--porcelain', '-uno')).Output
    if ($dirty.Trim()) {
        Write-Detail 'found changed program files - restoring them:'
        foreach ($line in ($dirty -split "`r?`n" | Where-Object { $_.Trim() })) { Write-Detail "  $line" }
        $reset = Invoke-GitRaw @('-C', $Root, 'checkout', '--', '.')
        if ($reset.ExitCode -ne 0) { throw "Could not restore the changed files:`n$($reset.Output)" }
    } else {
        Write-Detail 'nothing in the way.'
    }

    # 4 ─ pull
    $Stage = 'downloading the newest release'
    Write-Step 'Downloading the newest release...'
    $pull = Invoke-GitRaw @('-C', $Root, 'pull', '--ff-only', $PublicRepo, 'main')
    if ($pull.ExitCode -ne 0) {
        # Diverged history - no user install should have local commits, and a reset
        # touches nothing ignored, so the data is still safe.
        Write-Note 'the normal update path was refused - repairing this installation''s history...'
        $fetch = Invoke-GitRaw @('-C', $Root, 'fetch', $PublicRepo, 'main')
        if ($fetch.ExitCode -ne 0) { throw "Could not download the update:`n$($fetch.Output)" }
        $reset = Invoke-GitRaw @('-C', $Root, 'reset', '--hard', 'FETCH_HEAD')
        if ($reset.ExitCode -ne 0) { throw "Could not apply the download:`n$($reset.Output)" }
    }
    $After = (Invoke-GitRaw @('-C', $Root, 'rev-parse', 'HEAD')).Output.Trim()
    if ($Before -eq $After) { Write-Detail 'already had the newest files.' }
    else { Write-Detail ('downloaded {0}.' -f (Get-RepoVersion $Root)) }

    # 5 ─ apply, through the engine we just pulled
    $Stage = 'applying the update'
    Write-Step 'Applying it - this takes several minutes, leave this window open...'
    $engine = Join-Path $Root 'installer\engine.ps1'
    if (-not (Test-Path -LiteralPath $engine)) { throw "The downloaded files are incomplete - $engine is missing." }
    $env:RACCOON_ROOT = $Root
    $engineArgs = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $engine, 'install')
    if ($DryRun) { $engineArgs += '-DryRun' }
    & powershell.exe @engineArgs
    if ($LASTEXITCODE -ne 0) { throw "The installer did not finish (exit code $LASTEXITCODE)." }

    # 6 ─ prove the next update will work
    $Stage = 'verifying'
    Write-Step 'Checking that future updates will work...'
    $left = (Invoke-GitRaw @('-C', $Root, 'status', '--porcelain', '-uno')).Output.Trim()
    if ($left) { throw "Some program files are still modified, which would block the next update:`n$left" }
    Write-Detail 'no files left that could block an update.'

    $remote = (Invoke-GitRaw @('-C', $Root, 'ls-remote', $PublicRepo, 'main')).Output
    $remoteSha = ''
    if ($remote) { $remoteSha = ($remote -split "`r?`n")[0].Split("`t")[0].Trim() }
    if (-not $remoteSha) { Write-Note 'could not reach GitHub to confirm the version - skipping that check.' }
    elseif ($remoteSha -ne $After) { throw "This installation is still not on the latest release ($After, expected $remoteSha)." }
    else { Write-Detail 'on the latest release.' }

    # The installer records the commit it applied. A dry run installs nothing, so
    # it correctly has no marker to check.
    if (-not $DryRun) {
        $revFile = Join-Path $Root '.installed-rev'
        $applied = if (Test-Path -LiteralPath $revFile) { (Get-Content -LiteralPath $revFile -TotalCount 1).Trim() } else { '' }
        if ($applied -ne $After) { throw "The installer did not finish applying this version (marker $applied, expected $After)." }
        Write-Detail 'this version is fully applied.'
    }

    Write-Host ''
    Write-Host '  ------------------------------------------------------------' -ForegroundColor Green
    Write-Host '  Done. Raccoon Studio is up to date.' -ForegroundColor Green
    Write-Host ("  Version: {0}" -f (Get-RepoVersion $Root)) -ForegroundColor White
    Write-Host '  The Update button in the launcher works again from now on.' -ForegroundColor White
    Write-Host ("  Start it from:  {0}\Raccoon Studio.bat" -f $Root) -ForegroundColor Gray
    Write-Host '  ------------------------------------------------------------' -ForegroundColor Green
}
catch {
    $ExitCode = 1
    Write-Host ''
    Write-Host '  ------------------------------------------------------------' -ForegroundColor Red
    Write-Host ("  The upgrade stopped while {0}." -f $Stage) -ForegroundColor Red
    Write-Host ("  {0}" -f $_.Exception.Message) -ForegroundColor Yellow
    try { Stop-Transcript | Out-Null } catch { }
    $report = $null
    try { $report = Write-UpgradeReport -Reason $Stage -Root $Root -Before $Before -After $After } catch { }
    if ($report) {
        Write-Host ''
        Write-Host '  A report was saved to your Desktop:' -ForegroundColor White
        Write-Host ("  {0}" -f $report) -ForegroundColor White
        Write-Host '  Post that file on Discord or Patreon and we will sort it out.' -ForegroundColor White
        try { Start-Process notepad.exe $report | Out-Null } catch { }
    }
    Write-Host '  Nothing was broken - you can run this file again at any time.' -ForegroundColor Gray
    Write-Host '  ------------------------------------------------------------' -ForegroundColor Red
}
finally {
    try { Stop-Transcript | Out-Null } catch { }
    # Only litter the Desktop when something went wrong; a clean run leaves nothing.
    if ($ExitCode -eq 0) { Remove-Item -LiteralPath $TranscriptTo -Force -ErrorAction SilentlyContinue }
    if (-not $NoPause) { Write-Host ''; Read-Host '  Press Enter to close' | Out-Null }
}
exit $ExitCode
