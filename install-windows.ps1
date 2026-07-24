#Requires -Version 5.1
<#
.SYNOPSIS
    Raccoon Studio Installer — Windows 11
    Installs ComfyUI + Manager + ReActor face swap + Raccoon Studio web app.
    Requires: Windows 10/11, NVIDIA GPU with driver, internet connection.
    Usage: Double-click install-windows.bat, or right-click this .ps1 → Run with PowerShell.
#>
param(
    [switch] $DryRun,
    [switch] $SkipCudaCheck,
    [switch] $NoDesktopShortcut,
    [switch] $WithControlNet,
    [switch] $SkipControlNet
)

# NOTE: 'Continue', not 'Stop'. Under Windows PowerShell 5.1, $ErrorActionPreference='Stop'
# turns ANY native-command stderr line into a fatal NativeCommandError — even on success
# and even with 2>&1. git/uv/npm all write progress to stderr, so 'Stop' would abort the
# install at the first git fetch. Native steps are guarded by explicit $LASTEXITCODE checks;
# cmdlet calls that must abort on failure carry an explicit -ErrorAction Stop.
$ErrorActionPreference = 'Continue'
Set-StrictMode -Version Latest

# ── Paths ──────────────────────────────────────────────────────────────────────
$RootDir     = Split-Path -Parent $MyInvocation.MyCommand.Path
$ComfyDir    = Join-Path $RootDir 'comfyui\ComfyUI'
$VenvDir     = Join-Path $ComfyDir '.venv'
$VenvPython  = Join-Path $VenvDir 'Scripts\python.exe'
$AppDir      = Join-Path $RootDir 'app'
$LogDir      = Join-Path $RootDir 'logs'
$LogFile     = Join-Path $LogDir ("install-{0}.log" -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
$TotalSteps  = 14

# ── Shared engine helpers ──────────────────────────────────────────────────────
# Dot-source the launcher's structured-progress lib so each step emits a
# PROGRESS|step|total|pct|msg line the GUI shell can parse. Point the lib's log
# at this script's $LogFile so both write to one file (RACCOON_ROOT lets the lib
# resolve paths without re-deriving them).
$env:RACCOON_ROOT = $RootDir
$env:LOG_FILE     = $LogFile
. (Join-Path $RootDir 'installer\lib.ps1')

# ── Console helpers ────────────────────────────────────────────────────────────
function Write-Banner {
    Clear-Host
    Write-Host ''
    Write-Host '  ╔══════════════════════════════════════════════════════════════╗' -ForegroundColor Magenta
    Write-Host '  ║                                                              ║' -ForegroundColor Magenta
    Write-Host '  ║ ██████╗  █████╗  ██████╗ ██████╗ ██████╗  ██████╗ ███╗   ██╗ ║' -ForegroundColor Magenta
    Write-Host '  ║ ██╔══██╗██╔══██╗██╔════╝██╔════╝██╔═══██╗██╔═══██╗████╗  ██║ ║' -ForegroundColor Magenta
    Write-Host '  ║ ██████╔╝███████║██║     ██║     ██║   ██║██║   ██║██╔██╗ ██║ ║' -ForegroundColor Magenta
    Write-Host '  ║ ██╔══██╗██╔══██║██║     ██║     ██║   ██║██║   ██║██║╚██╗██║ ║' -ForegroundColor Magenta
    Write-Host '  ║ ██║  ██║██║  ██║╚██████╗╚██████╗╚██████╔╝╚██████╔╝██║ ╚████║ ║' -ForegroundColor Magenta
    Write-Host '  ║ ╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝ ╚═════╝ ╚═════╝  ╚═════╝ ╚═╝  ╚═══╝ ║' -ForegroundColor Magenta
    Write-Host '  ║                                                              ║' -ForegroundColor Cyan
    Write-Host '  ║              I N S T A L L E R  —  W I N D O W S            ║' -ForegroundColor Cyan
    Write-Host '  ╚══════════════════════════════════════════════════════════════╝' -ForegroundColor Cyan
    Write-Host ''
    Write-Host '  Installs ComfyUI + Manager + ReActor face swap + Impact Pack (Face Detailer)' -ForegroundColor DarkGray
    Write-Host '  + LTX 2.3 video nodes + Raccoon Studio web app. Large models: download from Models page.' -ForegroundColor DarkGray
    Write-Host ''
}

$CurrentStep = 0
function Write-Step([string]$Title) {
    $script:CurrentStep++
    $n = $script:CurrentStep
    Write-Host ''
    Write-Host "  ┌──────────────────────────────────────────────────────────┐" -ForegroundColor Cyan
    Write-Host ("  │  {0:D2}/{1}  {2,-53}│" -f $n, $TotalSteps, $Title) -ForegroundColor Cyan
    Write-Host "  └──────────────────────────────────────────────────────────┘" -ForegroundColor Cyan
    # Emit the parseable protocol line for the GUI (also writes the [STEP] log line).
    Emit-Progress $n $TotalSteps $Title
}
function Write-Ok([string]$Msg)   { Write-Host "    ✓  $Msg" -ForegroundColor Green;  Add-Log "[OK]   $Msg" }
function Write-Info([string]$Msg) { Write-Host "    →  $Msg" -ForegroundColor Gray;   Add-Log "[INFO] $Msg" }
function Write-Warn([string]$Msg) { Write-Host "    !  $Msg" -ForegroundColor Yellow; Add-Log "[WARN] $Msg" }
function Write-Fail([string]$Msg) {
    Write-Host "`n    ✗  ERROR: $Msg`n" -ForegroundColor Red
    Add-Log "[FAIL] $Msg"
    $bundle = New-SupportBundle
    if ($bundle) {
        Write-Host '  A support file was saved to your Desktop:' -ForegroundColor Yellow
        Write-Host "      $bundle" -ForegroundColor Cyan
        Write-Host '  Send us that one file and we can see exactly what went wrong.' -ForegroundColor Yellow
    } else {
        Write-Host "  Log saved to: $LogFile" -ForegroundColor DarkGray
        Write-Host "  Please send this file when reporting an issue." -ForegroundColor DarkGray
    }
    exit 1
}

# ── Logging ────────────────────────────────────────────────────────────────────
function Add-Log([string]$Msg) {
    $ts = Get-Date -Format 'HH:mm:ss'
    try { Add-Content -Path $LogFile -Value "$ts $Msg" -Encoding UTF8 } catch {}
}

function Invoke-Logged([string]$Exe, [string[]]$ArgList, [string]$Label = '') {
    if ($Label) { Add-Log "[CMD] $Label" } else { Add-Log "[CMD] $Exe $($ArgList -join ' ')" }
    if ($DryRun) { Write-Info "[DryRun] $Exe $($ArgList -join ' ')"; return 0 }
    try {
        $out = & $Exe @ArgList 2>&1
        Add-Content -Path $LogFile -Value ($out | Out-String) -Encoding UTF8
    } catch {
        Add-Log "[EXCEPTION] $_"
    }
    $code = $LASTEXITCODE
    Add-Log "[EXIT] $code"
    return $code
}

# ── Driver update guidance ─────────────────────────────────────────────────────
# Shown when the NVIDIA driver is too old for GPU acceleration. Written for a
# non-technical user: a numbered click-path, not jargon.
function Show-DriverUpdateHelp([string]$Drv) {
    $yours = if ($Drv -and $Drv -ne 'unknown') { " (yours: $Drv)" } else { '' }
    Write-Host ''
    Write-Host "    Your NVIDIA graphics driver is too old for GPU acceleration$yours." -ForegroundColor Yellow
    Write-Host '    Here is exactly how to fix it:' -ForegroundColor Yellow
    Write-Host ''
    Write-Host '      1. Open this page in your web browser:' -ForegroundColor Gray
    Write-Host '           https://www.nvidia.com/download/index.aspx' -ForegroundColor Cyan
    Write-Host '      2. Choose your graphics card and "Windows 11", then click Search' -ForegroundColor Gray
    Write-Host '      3. Download the "Game Ready Driver" and run the file you downloaded' -ForegroundColor Gray
    Write-Host '      4. Click Next through the default options, then RESTART your PC' -ForegroundColor Gray
    Write-Host '      5. Double-click "Start Raccoon Studio" again' -ForegroundColor Gray
    Write-Host ''
    Write-Host '    You do NOT need the "CUDA Toolkit" — only the driver above.' -ForegroundColor DarkGray
    Write-Host ''
    Add-Log "[DRIVER] shown driver-update help (driver=$Drv)"
}

# ── Support bundle ─────────────────────────────────────────────────────────────
# One file a non-technical user can send us when something breaks: the install
# logs plus a fresh GPU/driver dump, zipped onto the Desktop with a stable name.
function New-SupportBundle {
    try {
        if (-not (Test-Path $LogDir)) { return $null }
        # Fresh GPU dump next to the logs so it lands inside the zip.
        try {
            if (Get-ExePath 'nvidia-smi') {
                & nvidia-smi 2>&1 | Set-Content -Path (Join-Path $LogDir 'nvidia-smi.txt') -Encoding UTF8
            }
        } catch {}
        $desktop = [Environment]::GetFolderPath('Desktop')
        if (-not $desktop -or -not (Test-Path $desktop)) { $desktop = $RootDir }
        $zip = Join-Path $desktop 'Raccoon-Studio-Support.zip'
        Compress-Archive -Path (Join-Path $LogDir '*') -DestinationPath $zip -Force -ErrorAction Stop
        return $zip
    } catch {
        Add-Log "[SUPPORT] bundle failed: $_"
        return $null
    }
}

# ── Spinner ────────────────────────────────────────────────────────────────────
$SpinnerJob = $null
function Start-Spinner([string]$Msg) {
    Stop-Spinner
    $script:SpinnerJob = Start-Job -ScriptBlock {
        param($m)
        $f = @('⠋','⠙','⠹','⠸','⠼','⠴','⠦','⠧','⠇','⠏')
        $i = 0
        while ($true) {
            Write-Host ("`r    {0}  {1}   " -f $f[$i], $m) -NoNewline -ForegroundColor Cyan
            $i = ($i + 1) % 10
            Start-Sleep -Milliseconds 80
        }
    } -ArgumentList $Msg
}
function Stop-Spinner {
    if ($script:SpinnerJob) {
        Stop-Job  $script:SpinnerJob -ErrorAction SilentlyContinue
        Remove-Job $script:SpinnerJob -ErrorAction SilentlyContinue
        $script:SpinnerJob = $null
        Write-Host ("`r{0}`r" -f (' ' * 72)) -NoNewline
    }
}
function Invoke-WithSpinner([string]$Msg, [scriptblock]$Block) {
    # Dry-run safety: spinner blocks wrap every real side effect (git clone, uv/pip,
    # model downloads, npm install, venv creation). Skip them entirely under -DryRun.
    if ($DryRun) { Add-Log "[DryRun] $Msg"; Write-Info "[DryRun] $Msg"; return }
    Start-Spinner $Msg
    try { & $Block }
    finally { Stop-Spinner }
}

# ── PATH refresh ───────────────────────────────────────────────────────────────
function Update-SessionPath {
    $m = [Environment]::GetEnvironmentVariable('Path','Machine'); if (-not $m) { $m = '' }
    $u = [Environment]::GetEnvironmentVariable('Path','User');    if (-not $u) { $u = '' }
    $env:Path = "$m;$u;$env:Path"
}

# ── Tool finders ───────────────────────────────────────────────────────────────
function Get-ExePath([string]$Name) {
    $c = Get-Command $Name -ErrorAction SilentlyContinue
    return $(if ($c) { $c.Source } else { $null })
}

# Probe a tool's version WITHOUT assuming it exists. A missing native command
# throws a *terminating* CommandNotFoundException that `2>$null` cannot swallow —
# unguarded, it hits the trap and kills the install before the very steps that
# would have installed the tool. Always resolve with Get-ExePath first.
function Get-ToolVersion([string]$Name, [string[]]$VersionArgs = @('--version')) {
    $exe = Get-ExePath $Name
    if (-not $exe) { return 'not found' }
    $v = (& $exe @VersionArgs 2>$null | Select-Object -First 1)
    return $(if ($v) { "$v".Trim() } else { 'unknown' })
}

function Get-PyVersion([string]$Exe) {
    if (-not $Exe -or -not (Test-Path $Exe -EA SilentlyContinue)) { return $null }
    $v = & $Exe -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')" 2>$null
    return $(if ($LASTEXITCODE -eq 0 -and $v) { $v.Trim() } else { $null })
}

function Find-Python312 {
    $py = Get-Command py -EA SilentlyContinue
    if ($py) {
        $e = & py -3.12 -c "import sys; print(sys.executable)" 2>$null
        if ($LASTEXITCODE -eq 0 -and $e) { return $e.Trim() }
    }
    foreach ($n in @('python','python3','python3.12')) {
        $e = Get-ExePath $n
        if ($e -and (Get-PyVersion $e) -eq '3.12') { return $e }
    }
    return $null
}

function Find-PythonAny {
    $py = Get-Command py -EA SilentlyContinue
    if ($py) {
        foreach ($minor in @('3.12','3.11','3.10','3.13')) {
            $e = & py -$minor -c "import sys; print(sys.executable)" 2>$null
            if ($LASTEXITCODE -eq 0 -and $e) { return $e.Trim() }
        }
    }
    foreach ($n in @('python','python3')) {
        $e = Get-ExePath $n
        if ($e -and (Get-PyVersion $e) -match '3\.(1[0-3])') { return $e }
    }
    return $null
}

# ── winget wrapper ────────────────────────────────────────────────────────────
function Install-WingetPkg([string]$Id, [string]$Display) {
    Write-Info "Installing $Display..."
    if ($DryRun) { Write-Info "[DryRun] winget install $Id"; return }
    Add-Log "[CMD] winget install $Id"
    $out = & winget install --id $Id --exact --source winget `
        --accept-source-agreements --accept-package-agreements `
        --disable-interactivity --silent 2>&1
    Add-Content -Path $LogFile -Value ($out | Out-String) -Encoding UTF8
    Add-Log "[EXIT] $LASTEXITCODE"
    if ($LASTEXITCODE -ne 0) { Write-Fail "winget could not install $Display (exit $LASTEXITCODE)." }
    Update-SessionPath
    Write-Ok "$Display installed"
}

# ── Custom-node pack helpers ────────────────────────────────────────────────────
# Mirror the Linux installer. All steps are non-fatal: one bad pack warns and the
# install continues. Read script-scope $cnDir/$uvExe/$VenvPython at call time.
function Install-NodePack([string]$Name, [string]$Url) {
    $dir = Join-Path $cnDir $Name
    if (Test-Path (Join-Path $dir '.git')) {
        Invoke-WithSpinner "Updating $Name" {
            & git -C $dir pull --ff-only 2>&1 | Add-Content -Path $LogFile -Encoding UTF8
        }
    } elseif (Test-Path $dir) {
        Write-Info "$Name already present — leaving as-is"
    } else {
        Invoke-WithSpinner "Cloning $Name" {
            & git clone --depth=1 $Url $dir 2>&1 | Add-Content -Path $LogFile -Encoding UTF8
            if ($LASTEXITCODE -ne 0) { Write-Warn "$Name clone failed — its nodes will be unavailable." }
        }
    }
    $req = Join-Path $dir 'requirements.txt'
    if (Test-Path $req) {
        Invoke-WithSpinner "Installing $Name dependencies" {
            & $uvExe pip install --python $VenvPython -r $req 2>&1 | Add-Content -Path $LogFile -Encoding UTF8
        }
    }
}

# Copy a private pack vendored in the repo into ComfyUI's custom_nodes.
function Copy-VendorPack([string]$Name) {
    $src = Join-Path $RootDir "comfyui\vendor-custom-nodes\$Name"
    $dir = Join-Path $cnDir $Name
    if (-not (Test-Path $src)) { Write-Warn "Vendored pack $Name missing from repo — skipping."; return }
    if ($DryRun) { Write-Info "[DryRun] copy vendored pack $Name"; return }
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }
    Copy-Item -Path (Join-Path $src '*') -Destination $dir -Recurse -Force
    $req = Join-Path $dir 'requirements.txt'
    if (Test-Path $req) {
        Invoke-WithSpinner "Installing $Name dependencies" {
            & $uvExe pip install --python $VenvPython -r $req 2>&1 | Add-Content -Path $LogFile -Encoding UTF8
        }
    }
}

# Visual Studio C++ Build Tools — some video node packs (notably the NVIDIA RTX
# super-res) compile native extensions and need a C++ toolchain. Non-fatal.
function Install-BuildTools {
    $vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
    if (Test-Path $vswhere) {
        $hasVC = & $vswhere -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath 2>$null
        if ($hasVC) { Write-Ok 'C++ build tools already installed'; return }
    }
    Write-Info 'Installing Visual Studio C++ Build Tools via winget (large — may take a while)...'
    if ($DryRun) { Write-Info '[DryRun] winget install Microsoft.VisualStudio.2022.BuildTools'; return }
    Add-Log '[CMD] winget install Microsoft.VisualStudio.2022.BuildTools (VCTools workload)'
    $out = & winget install --id Microsoft.VisualStudio.2022.BuildTools --exact --source winget `
        --accept-source-agreements --accept-package-agreements --disable-interactivity `
        --override '--quiet --wait --norestart --nocache --add Microsoft.VisualStudio.Workload.VCTools;includeRecommended' 2>&1
    Add-Content -Path $LogFile -Value ($out | Out-String) -Encoding UTF8
    Add-Log "[EXIT] $LASTEXITCODE"
    if ($LASTEXITCODE -ne 0) {
        Write-Warn 'C++ Build Tools install did not complete — native node builds (RTX super-res) may fail.'
        Write-Info 'You can install "Desktop development with C++" from the Visual Studio Installer later.'
    } else {
        Update-SessionPath
        Write-Ok 'C++ build tools installed'
    }
}

# ── Collect system info ────────────────────────────────────────────────────────
function Write-SysInfo {
    $sep = '=' * 64
    $lines = @(
        $sep,
        ' RACCOON STUDIO INSTALLATION LOG',
        $sep,
        "Date        : $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')",
        "Install dir : $RootDir"
    )
    # OS
    try {
        $os = Get-CimInstance Win32_OperatingSystem -EA Stop
        $lines += "OS          : $($os.Caption) $($os.Version) ($($os.OSArchitecture))"
    } catch { $lines += "OS          : unknown" }
    # CPU
    try {
        $cpu = (Get-CimInstance Win32_Processor -EA Stop | Select-Object -First 1).Name
        $lines += "CPU         : $cpu"
    } catch { $lines += "CPU         : unknown" }
    # RAM
    try {
        $ram = [math]::Round((Get-CimInstance Win32_PhysicalMemory -EA Stop | Measure-Object Capacity -Sum).Sum / 1GB, 1)
        $lines += "RAM         : $ram GB"
    } catch { $lines += "RAM         : unknown" }
    # GPU
    try {
        $gpu = Get-CimInstance Win32_VideoController -EA Stop | Where-Object Name -match 'NVIDIA' | Select-Object -First 1
        if ($gpu) {
            $lines += "GPU         : $($gpu.Name)"
            $lines += "Driver      : $(Get-ToolVersion 'nvidia-smi' @('--query-gpu=driver_version','--format=csv,noheader'))"
        } else {
            $lines += "GPU         : (no NVIDIA GPU detected)"
        }
    } catch { $lines += "GPU         : unknown" }
    # Tools
    $lines += "Python      : $(Get-ToolVersion 'python')"
    $lines += "Node.js     : $(Get-ToolVersion 'node')"
    $lines += "npm         : $(Get-ToolVersion 'npm')"
    $lines += "Git         : $(Get-ToolVersion 'git')"
    $lines += "Log file    : $LogFile"
    $lines += $sep
    $lines += ''
    $lines | ForEach-Object { Add-Content -Path $LogFile -Value $_ -Encoding UTF8 }
}

# ── Desktop shortcut helpers ───────────────────────────────────────────────────
function Install-DesktopShortcut([string]$TargetBat, [string]$IcoPath, [string]$Name, [string]$Desc) {
    $desktop = [Environment]::GetFolderPath('Desktop')
    $lnk     = Join-Path $desktop "$Name.lnk"
    try {
        $wsh      = New-Object -ComObject WScript.Shell
        $shortcut = $wsh.CreateShortcut($lnk)
        $shortcut.TargetPath       = $TargetBat
        $shortcut.WorkingDirectory = $RootDir
        $shortcut.Description      = $Desc
        if ($IcoPath -and (Test-Path $IcoPath)) {
            $shortcut.IconLocation = "$IcoPath,0"
        }
        if (-not $DryRun) { $shortcut.Save() }
        Write-Ok "Desktop shortcut created: $lnk"
        Add-Log "[DESKTOP] Shortcut created at $lnk"
    } catch {
        Write-Warn "Could not create desktop shortcut: $_"
        Add-Log "[WARN] Desktop shortcut failed: $_"
    }
}

function Install-StartMenuEntry([string]$TargetBat, [string]$IcoPath, [string]$Name, [string]$Desc) {
    $startMenu = Join-Path ([Environment]::GetFolderPath('Programs')) 'Raccoon Studio'
    try {
        if (-not (Test-Path $startMenu)) { New-Item -ItemType Directory -Path $startMenu | Out-Null }
        $lnk = Join-Path $startMenu "$Name.lnk"
        $wsh = New-Object -ComObject WScript.Shell
        $sc  = $wsh.CreateShortcut($lnk)
        $sc.TargetPath       = $TargetBat
        $sc.WorkingDirectory = $RootDir
        $sc.Description      = $Desc
        if ($IcoPath -and (Test-Path $IcoPath)) { $sc.IconLocation = "$IcoPath,0" }
        if (-not $DryRun) { $sc.Save() }
        Write-Ok "Start Menu entry created: $lnk"
    } catch {
        Write-Warn "Start Menu entry failed: $_"
    }
}

# ── Programs list registration ──────────────────────────────────────────────────
# Register Raccoon Studio in Windows "Installed apps" / "Programs and Features"
# so it looks like a real installed application (name, icon, publisher, uninstall).
# Per-user (HKCU) so it needs no admin and matches the per-user shortcuts.
function Register-InstalledApp([string]$IcoPath) {
    $key = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\RaccoonStudio'
    $psExe = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    $uninstaller = Join-Path $RootDir 'uninstall-windows.ps1'
    $unCmd = "`"$psExe`" -NoProfile -ExecutionPolicy Bypass -File `"$uninstaller`""
    if ($DryRun) { Write-Info "[DryRun] register in Programs list: $key"; return }
    try {
        $ErrorActionPreference = 'Stop'
        if (-not (Test-Path $key)) { New-Item -Path $key -Force | Out-Null }
        New-ItemProperty -Path $key -Name 'DisplayName'          -Value 'Raccoon Studio' -PropertyType String -Force | Out-Null
        New-ItemProperty -Path $key -Name 'DisplayVersion'       -Value '1.0.0'          -PropertyType String -Force | Out-Null
        New-ItemProperty -Path $key -Name 'Publisher'            -Value 'Raccoon Studio' -PropertyType String -Force | Out-Null
        New-ItemProperty -Path $key -Name 'InstallLocation'      -Value $RootDir         -PropertyType String -Force | Out-Null
        New-ItemProperty -Path $key -Name 'UninstallString'      -Value $unCmd           -PropertyType String -Force | Out-Null
        New-ItemProperty -Path $key -Name 'QuietUninstallString' -Value "$unCmd -Quiet"  -PropertyType String -Force | Out-Null
        New-ItemProperty -Path $key -Name 'URLInfoAbout'         -Value 'https://github.com/Finoo125/raccoon-studio' -PropertyType String -Force | Out-Null
        New-ItemProperty -Path $key -Name 'NoModify'             -Value 1 -PropertyType DWord -Force | Out-Null
        New-ItemProperty -Path $key -Name 'NoRepair'             -Value 1 -PropertyType DWord -Force | Out-Null
        if ($IcoPath -and (Test-Path $IcoPath)) {
            New-ItemProperty -Path $key -Name 'DisplayIcon' -Value $IcoPath -PropertyType String -Force | Out-Null
        }
        Write-Ok 'Registered in Windows "Installed apps" list'
        Add-Log "[REGISTER] $key"
    } catch {
        Write-Warn "Could not register in Programs list: $_"
    }
}

# ── CUDA verification ──────────────────────────────────────────────────────────
function Test-CudaAcceleration {
    if ($SkipCudaCheck) { Write-Info "CUDA check skipped."; return }
    if (-not (Test-Path $VenvPython -EA SilentlyContinue)) {
        Write-Warn "Cannot find venv Python for CUDA check."; return
    }
    $json = & $VenvPython -c @'
import json, sys
r = {'ok': False, 'device': '', 'err': ''}
try:
    import torch
    r['ok'] = bool(torch.cuda.is_available())
    if r['ok']: r['device'] = torch.cuda.get_device_name(0)
except Exception as e:
    r['err'] = str(e)
print(json.dumps(r))
'@ 2>$null
    if (-not $json) { Write-Warn "CUDA check returned no output."; return }
    try {
        $d = $json | ConvertFrom-Json
        if ($d.ok) {
            Write-Ok "CUDA acceleration ready: $($d.device)"
            Add-Log "[CUDA] Available: $($d.device)"
        } else {
            Write-Warn "GPU acceleration is not active yet: $($d.err)"
            if (Get-ExePath 'nvidia-smi') {
                Write-Info 'First, RESTART your computer and run start.bat — this fixes it in most cases.'
                Write-Info 'If it still does not work after a restart, your driver is too old:'
                $drvNow = (& nvidia-smi --query-gpu=driver_version --format=csv,noheader 2>$null | Select-Object -First 1)
                Show-DriverUpdateHelp $drvNow
            } else {
                Write-Info 'No NVIDIA GPU detected — generation will use the CPU (very slow).'
            }
            Add-Log "[CUDA] Unavailable: $($d.err)"
        }
    } catch {
        Write-Warn "Could not parse CUDA check result."
    }
}

# ══════════════════════════════════════════════════════════════════════════════
#  MAIN
# ══════════════════════════════════════════════════════════════════════════════
# Safety net: any unhandled *terminating* error (a throw, a StrictMode violation)
# still lands the user a support bundle instead of a raw red stack trace.
# ErrorActionPreference is 'Continue', so native stderr never reaches here, and
# guarded -EA Stop cmdlets carry their own try/catch — this only catches the
# genuinely unexpected.
trap {
    Stop-Spinner
    Add-Log "[TRAP] $($_ | Out-String)"
    Write-Fail "Unexpected error: $($_.Exception.Message)"
}

Write-Banner

# ── Optional ControlNet / IP-Adapter models (~9 GB) ───────────────────────────
# Explicit switches win; the GUI/engine always passes one, so headless runs never
# prompt. An interactive console run asks once, up front. Default is skip — the
# Models page can download them any time later.
$InstallCnModels = $false
if ($WithControlNet) { $InstallCnModels = $true }
elseif (-not $SkipControlNet) {
    try {
        if (-not [Console]::IsInputRedirected) {
            Write-Host '  Optional: ControlNet + IP-Adapter models (~9 GB download).' -ForegroundColor Cyan
            Write-Host '  Only the ControlNet / IP-Adapter features need them; everything else works without.' -ForegroundColor DarkGray
            Write-Host '  You can also download them later from the Models page.' -ForegroundColor DarkGray
            $ans = Read-Host '  Download them now? [y/N]'
            if ($ans -match '^(y|yes)$') { $InstallCnModels = $true }
            Write-Host ''
        }
    } catch {}
}

if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir | Out-Null }
Write-SysInfo

# ── Step 1: NVIDIA ────────────────────────────────────────────────────────────
Write-Step 'Checking NVIDIA driver'
$nvSmi = Get-ExePath 'nvidia-smi'
if ($nvSmi) {
    $drv = (& nvidia-smi --query-gpu=driver_version --format=csv,noheader 2>$null | Select-Object -First 1)
    if (-not $drv) { $drv = 'unknown' }
    $gpu = (& nvidia-smi --query-gpu=name          --format=csv,noheader 2>$null | Select-Object -First 1)
    if (-not $gpu) { $gpu = 'unknown' }
    Write-Ok "Driver $drv  ·  $gpu"
    # ponytail: conservative CUDA-12.0 floor (528). The post-install torch check
    # is the real authority; this is only an early heads-up for clearly-old drivers.
    if ($drv -match '^(\d+)\.' -and [int]$Matches[1] -lt 528) {
        Write-Warn "Driver $drv may be too old for GPU acceleration."
        Show-DriverUpdateHelp $drv
    }
} else {
    try {
        $nvidiaGpu = Get-CimInstance Win32_VideoController -EA Stop | Where-Object Name -match 'NVIDIA' | Select-Object -First 1
        if ($nvidiaGpu) {
            Write-Warn "NVIDIA GPU found ($($nvidiaGpu.Name)) but nvidia-smi missing."
            Write-Info "Install the latest driver from nvidia.com, reboot, then re-run."
        } else {
            Write-Warn "No NVIDIA GPU detected. Generation will be CPU-only (very slow)."
        }
    } catch { Write-Warn "Could not query GPU." }
    # Dry-run and headless/GUI runs (no console to Read-Host from) must not block:
    # default to continuing CPU-only. Only an interactive console gets the prompt.
    if ($DryRun) {
        Write-Info 'Continuing without NVIDIA driver (dry-run).'
    } else {
        $yn = 'y'
        try { $yn = Read-Host '  Continue without NVIDIA driver? [y/N]' }
        catch { Write-Warn 'No interactive console — continuing CPU-only.'; $yn = 'y' }
        if ($yn -notmatch '^[Yy]') { Write-Info 'Aborting.'; exit 0 }
    }
}

# ── Step 2: Winget ────────────────────────────────────────────────────────────
Write-Step 'Checking Windows Package Manager (winget)'
if (-not (Get-ExePath 'winget')) {
    Write-Fail 'winget not found. Open Microsoft Store, install "App Installer", then re-run.'
}
Write-Ok 'winget is available'

# ── Step 3: Long paths ────────────────────────────────────────────────────────
Write-Step 'Enabling long path support'
try {
    $key = 'HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem'
    $lpProp = Get-ItemProperty $key -Name LongPathsEnabled -EA SilentlyContinue
    $cur = if ($lpProp) { $lpProp.LongPathsEnabled } else { $null }
    if ($cur -ne 1) {
        if (-not $DryRun) { Set-ItemProperty $key LongPathsEnabled 1 -Type DWord -EA Stop }
        Write-Ok 'Long path support enabled'
    } else {
        Write-Ok 'Long path support already enabled'
    }
} catch { Write-Warn "Could not set long paths (admin required): $_" }

# ── Step 4: Git ───────────────────────────────────────────────────────────────
Write-Step 'Ensuring Git is installed'
$gitExe = Get-ExePath 'git'
if ($gitExe) { Write-Ok "Git found at $gitExe" }
else {
    Install-WingetPkg 'Git.Git' 'Git'
    $gitExe = Get-ExePath 'git'
    if (-not $gitExe) { Write-Fail 'Git not found after installation.' }
}

# ── Step 5: Python 3.12 ───────────────────────────────────────────────────────
Write-Step 'Ensuring Python 3.12 is installed'
$pythonExe = Find-Python312
if ($pythonExe) { Write-Ok "Python 3.12 at $pythonExe" }
else {
    Install-WingetPkg 'Python.Python.3.12' 'Python 3.12'
    $pythonExe = Find-Python312
    if (-not $pythonExe) {
        $pythonExe = Find-PythonAny
        if (-not $pythonExe) { Write-Fail 'Python not found after installation.' }
        Write-Warn "Using $pythonExe ($(Get-PyVersion $pythonExe)) — 3.12 preferred"
    } else {
        Write-Ok "Python 3.12 installed at $pythonExe"
    }
}

# ── Step 6: Node.js ───────────────────────────────────────────────────────────
Write-Step 'Ensuring Node.js 18+ is installed'
$nodeExe = Get-ExePath 'node'
if ($nodeExe) {
    $nodeRaw = (& node --version 2>$null)
    $ver = if ($nodeRaw) { $nodeRaw.TrimStart('v') } else { '0' }
    $maj = [int]($ver -split '\.')[0]
    if ($maj -ge 18) { Write-Ok "Node.js v$ver" }
    else {
        Write-Warn "Node.js v$ver too old — upgrading to LTS"
        Install-WingetPkg 'OpenJS.NodeJS.LTS' 'Node.js LTS'
    }
} else {
    Install-WingetPkg 'OpenJS.NodeJS.LTS' 'Node.js LTS'
    $nodeExe = Get-ExePath 'node'
    if (-not $nodeExe) { Write-Fail 'Node.js not found after installation.' }
}

# ── Step 7: uv ────────────────────────────────────────────────────────────────
Write-Step 'Ensuring uv (Python package manager) is installed'
$uvExe = Get-ExePath 'uv'
if ($uvExe) { Write-Ok "uv found at $uvExe" }
else {
    Install-WingetPkg 'Astral.UV' 'uv'
    $uvExe = Get-ExePath 'uv'
    if (-not $uvExe) { Write-Fail 'uv not found after installation.' }
}

# ── Step 8: FFmpeg ────────────────────────────────────────────────────────────
# ffmpeg/ffprobe power Movie Maker MP4 export, Director shot assembly, and video
# metadata probing — the app shells out to them by bare name, so they must be on
# PATH. Kept non-fatal (its own winget call, not the fatal Install-WingetPkg) so
# a fresh install still finishes even if FFmpeg can't be fetched.
Write-Step 'Ensuring FFmpeg is installed'
if (Get-ExePath 'ffmpeg') {
    Write-Ok 'FFmpeg already installed'
} else {
    Write-Info 'Installing FFmpeg...'
    if (-not $DryRun) {
        Add-Log '[CMD] winget install Gyan.FFmpeg'
        $out = & winget install --id Gyan.FFmpeg --exact --source winget `
            --accept-source-agreements --accept-package-agreements `
            --disable-interactivity --silent 2>&1
        Add-Content -Path $LogFile -Value ($out | Out-String) -Encoding UTF8
        Add-Log "[EXIT] $LASTEXITCODE"
        Update-SessionPath
    }
    if (Get-ExePath 'ffmpeg') {
        Write-Ok 'FFmpeg installed'
    } else {
        Write-Warn 'FFmpeg not installed — Movie Maker export, Director assembly, and video probing will fail.'
        Write-Info 'Install it later with: winget install Gyan.FFmpeg  (then reopen the terminal).'
    }
}

# ── Step 9: tar (Backup & restore) ────────────────────────────────────────────
# Tools -> Backup & restore shells out to `tar` to build/extract a single .tar
# archive. Windows 10 1803+/11 ship bsdtar as System32\tar.exe, and Git for
# Windows bundles usr\bin\tar.exe — the app's resolveTarBin() prefers those in
# that order. Non-fatal: warn (don't abort) if neither is found.
Write-Step 'Verifying tar (Backup & restore)'
$tarExe = Get-ExePath 'tar'
if (-not $tarExe) {
    $gitTar = Join-Path ${env:ProgramFiles} 'Git\usr\bin\tar.exe'
    if (Test-Path $gitTar) { $tarExe = $gitTar }
}
if ($tarExe) {
    Write-Ok "tar available ($tarExe)"
} else {
    Write-Warn 'tar not found — Tools > Backup & restore will not work until tar is available.'
    Write-Info 'tar ships with Windows 10 1803+/11 (System32\tar.exe). Update Windows, or reinstall Git for Windows (it bundles tar).'
}

# ── Step 10: Clone ComfyUI + Python deps ──────────────────────────────────────
Write-Step 'Setting up ComfyUI and Python environment'
$comfyParent = Join-Path $RootDir 'comfyui'
if (-not (Test-Path $comfyParent)) { New-Item -ItemType Directory -Path $comfyParent | Out-Null }

$ComfyRepo = 'https://github.com/comfyanonymous/ComfyUI.git'
Invoke-WithSpinner 'Cloning / updating ComfyUI' {
    if (Test-Path (Join-Path $ComfyDir 'main.py')) {
        Add-Log "[CMD] git -C $ComfyDir pull --ff-only"
        & git -C $ComfyDir pull --ff-only 2>&1 | Add-Content -Path $LogFile -Encoding UTF8
    } elseif ((Test-Path $ComfyDir) -and (Get-ChildItem -Force $ComfyDir -ErrorAction SilentlyContinue)) {
        # Dir exists but has no main.py — a stale/partial checkout, or only the
        # gitignored models/ + custom_nodes/ dirs survived a prior run. `git clone`
        # refuses a non-empty target, so init-in-place and fetch the default branch,
        # preserving any already-downloaded models.
        Add-Log "[CMD] git init-in-place + fetch ComfyUI into existing $ComfyDir"
        if (-not (Test-Path (Join-Path $ComfyDir '.git'))) { & git -C $ComfyDir init -q 2>&1 | Add-Content -Path $LogFile -Encoding UTF8 }
        $remotes = (& git -C $ComfyDir remote 2>&1)
        if ($remotes -contains 'origin') {
            & git -C $ComfyDir remote set-url origin $ComfyRepo 2>&1 | Add-Content -Path $LogFile -Encoding UTF8
        } else {
            & git -C $ComfyDir remote add origin $ComfyRepo 2>&1 | Add-Content -Path $LogFile -Encoding UTF8
        }
        & git -C $ComfyDir fetch --depth=1 origin master 2>&1 | Add-Content -Path $LogFile -Encoding UTF8
        if ($LASTEXITCODE -ne 0) { Write-Fail 'git fetch ComfyUI failed.' }
        & git -C $ComfyDir checkout -f -B master FETCH_HEAD 2>&1 | Add-Content -Path $LogFile -Encoding UTF8
        if ($LASTEXITCODE -ne 0) { Write-Fail 'git checkout ComfyUI failed.' }
        & git -C $ComfyDir branch --set-upstream-to=origin/master master 2>&1 | Add-Content -Path $LogFile -Encoding UTF8
        if (-not (Test-Path (Join-Path $ComfyDir 'main.py'))) { Write-Fail 'ComfyUI checkout did not produce main.py.' }
    } else {
        Add-Log "[CMD] git clone ComfyUI"
        & git clone --depth=1 $ComfyRepo $ComfyDir 2>&1 | Add-Content -Path $LogFile -Encoding UTF8
        if ($LASTEXITCODE -ne 0) { Write-Fail 'git clone ComfyUI failed.' }
    }
}
Write-Ok 'ComfyUI ready'

Invoke-WithSpinner 'Creating Python virtual environment' {
    if (-not (Test-Path $VenvPython)) {
        Add-Log "[CMD] uv venv"
        & $uvExe venv $VenvDir --python $pythonExe --seed 2>&1 | Add-Content -Path $LogFile -Encoding UTF8
        if ($LASTEXITCODE -ne 0) { Write-Fail 'Virtual environment creation failed.' }
    }
}
Write-Ok 'Virtual environment ready'

Invoke-WithSpinner 'Installing PyTorch with CUDA 12.x (this takes a few minutes)' {
    Add-Log "[CMD] uv pip install torch (CUDA)"
    & $uvExe pip install --python $VenvPython `
        torch torchvision torchaudio `
        --extra-index-url https://download.pytorch.org/whl/cu128 2>&1 | Add-Content -Path $LogFile -Encoding UTF8
    if ($LASTEXITCODE -ne 0) { Write-Fail 'PyTorch installation failed.' }
}
Write-Ok 'PyTorch installed'

Invoke-WithSpinner 'Installing ComfyUI requirements' {
    $req = Join-Path $ComfyDir 'requirements.txt'
    Add-Log "[CMD] uv pip install -r requirements.txt"
    & $uvExe pip install --python $VenvPython -r $req 2>&1 | Add-Content -Path $LogFile -Encoding UTF8
    if ($LASTEXITCODE -ne 0) { Write-Fail 'ComfyUI requirements failed.' }
}
Write-Ok 'ComfyUI requirements installed'

# ── Step 11: Custom nodes (Manager + rgthree + ReActor + Impact Pack) ─────────
Write-Step 'Installing custom nodes (Manager + rgthree + ReActor + Impact)'
$MgrDir = Join-Path $ComfyDir 'custom_nodes\ComfyUI-Manager'
$cnDir  = Join-Path $ComfyDir 'custom_nodes'
if (-not (Test-Path $cnDir)) { New-Item -ItemType Directory -Path $cnDir | Out-Null }

Invoke-WithSpinner 'Cloning / updating ComfyUI Manager' {
    if (Test-Path (Join-Path $MgrDir '.git')) {
        & git -C $MgrDir pull --ff-only 2>&1 | Add-Content -Path $LogFile -Encoding UTF8
    } else {
        & git clone --depth=1 https://github.com/ltdrdata/ComfyUI-Manager.git $MgrDir 2>&1 | Add-Content -Path $LogFile -Encoding UTF8
        if ($LASTEXITCODE -ne 0) { Write-Fail 'git clone ComfyUI-Manager failed.' }
    }
}
Write-Ok 'ComfyUI Manager ready'

$mgrReq = Join-Path $MgrDir 'requirements.txt'
if (Test-Path $mgrReq) {
    Invoke-WithSpinner 'Installing ComfyUI Manager deps' {
        & $uvExe pip install --python $VenvPython -r $mgrReq 2>&1 | Add-Content -Path $LogFile -Encoding UTF8
    }
}

# rgthree-comfy — provides the "Lora Loader Stack (rgthree)" node the default
# Z Image Turbo workflow uses to load the model/CLIP and stack LoRAs.
$RgthreeDir = Join-Path $cnDir 'rgthree-comfy'
Invoke-WithSpinner 'Cloning / updating rgthree-comfy' {
    if (Test-Path (Join-Path $RgthreeDir '.git')) {
        & git -C $RgthreeDir pull --ff-only 2>&1 | Add-Content -Path $LogFile -Encoding UTF8
    } else {
        & git clone --depth=1 https://github.com/rgthree/rgthree-comfy.git $RgthreeDir 2>&1 | Add-Content -Path $LogFile -Encoding UTF8
        if ($LASTEXITCODE -ne 0) { Write-Warn 'rgthree-comfy clone failed — the default workflow will not load.' }
    }
}
$rgReq = Join-Path $RgthreeDir 'requirements.txt'
if (Test-Path $rgReq) {
    Invoke-WithSpinner 'Installing rgthree-comfy deps' {
        & $uvExe pip install --python $VenvPython -r $rgReq 2>&1 | Add-Content -Path $LogFile -Encoding UTF8
    }
}

# ReActor face-swap node — powers the Z Image Turbo face-swap workflow.
$ReactorDir = Join-Path $cnDir 'comfyui-reactor-node'
Invoke-WithSpinner 'Cloning / updating ReActor face-swap node' {
    if (Test-Path (Join-Path $ReactorDir '.git')) {
        & git -C $ReactorDir pull --ff-only 2>&1 | Add-Content -Path $LogFile -Encoding UTF8
    } else {
        & git clone --depth=1 https://codeberg.org/Gourieff/comfyui-reactor-node.git $ReactorDir 2>&1 | Add-Content -Path $LogFile -Encoding UTF8
        if ($LASTEXITCODE -ne 0) { Write-Warn 'ReActor clone failed — face swap will be unavailable.' }
    }
}
# install.py installs deps (incl. onnxruntime) and downloads inswapper_128.onnx.
# ReActor 0.7.0+ needs no Insightface. Non-fatal so the install still completes.
$reactorInstall = Join-Path $ReactorDir 'install.py'
if (Test-Path $reactorInstall) {
    Invoke-WithSpinner 'Installing ReActor deps + face-swap model' {
        Push-Location $ReactorDir
        try {
            & $VenvPython install.py 2>&1 | Add-Content -Path $LogFile -Encoding UTF8
            if ($LASTEXITCODE -ne 0) { Write-Warn 'ReActor setup incomplete — open ComfyUI once to finish model download.' }
        } finally { Pop-Location }
    }
}
# Pre-fetch the face-restore model our default workflow references, so the
# first face swap runs without an on-demand download.
$frDir      = Join-Path $ComfyDir 'models\facerestore_models'
$codeformer = Join-Path $frDir 'codeformer-v0.1.0.pth'
if (-not (Test-Path $codeformer)) {
    if (-not (Test-Path $frDir)) { New-Item -ItemType Directory -Path $frDir | Out-Null }
    Invoke-WithSpinner 'Downloading CodeFormer face-restore model' {
        try {
            Invoke-WebRequest -UseBasicParsing -ErrorAction Stop -Uri 'https://huggingface.co/datasets/Gourieff/ReActor/resolve/main/models/facerestore_models/codeformer-v0.1.0.pth' -OutFile $codeformer
        } catch {
            Write-Warn 'CodeFormer download failed (ReActor fetches it on first use).'
            if (Test-Path $codeformer) { Remove-Item $codeformer -Force }
        }
    }
}
# GPEN-BFR-1024 drives the realistic face-boost/restore in the swap chain
# (face-swap.ts default — 1024 preserves texture the 512 model downscales
# away). ReActor only auto-fetches restorers when the folder is empty, so
# grab it explicitly.
$gpen = Join-Path $frDir 'GPEN-BFR-1024.onnx'
if (-not (Test-Path $gpen)) {
    if (-not (Test-Path $frDir)) { New-Item -ItemType Directory -Path $frDir | Out-Null }
    Invoke-WithSpinner 'Downloading GPEN-BFR-1024 face-restore model' {
        try {
            Invoke-WebRequest -UseBasicParsing -ErrorAction Stop -Uri 'https://huggingface.co/datasets/Gourieff/ReActor/resolve/main/models/facerestore_models/GPEN-BFR-1024.onnx' -OutFile $gpen
        } catch {
            Write-Warn 'GPEN-BFR-1024 download failed — grab it from the Models page (face swap needs it).'
            if (Test-Path $gpen) { Remove-Item $gpen -Force }
        }
    }
}
# Hi-res upscale models (ESRGAN). The image workflows reference these by name in
# UpscaleModelLoader, so without them the (default-on) upscale stage fails prompt
# validation: 4x-UltraSharp (Ernie / Z-Image / SDXL) and 4x-AnimeSharp (Anima /
# Pony / Illustrious). sha256-verified against the canonical Kim2091 repos.
$upscaleDir = Join-Path $ComfyDir 'models\upscale_models'
if (-not (Test-Path $upscaleDir)) { New-Item -ItemType Directory -Path $upscaleDir | Out-Null }
$ultraSharp = Join-Path $upscaleDir '4x-UltraSharp.pth'
if (-not (Test-Path $ultraSharp)) {
    Invoke-WithSpinner 'Downloading 4x-UltraSharp upscale model' {
        try {
            Invoke-WebRequest -UseBasicParsing -ErrorAction Stop -Uri 'https://huggingface.co/Kim2091/UltraSharp/resolve/main/4x-UltraSharp.pth' -OutFile $ultraSharp
        } catch {
            Write-Warn '4x-UltraSharp download failed (grab it via the Models tab, or turn Upscale off).'
            if (Test-Path $ultraSharp) { Remove-Item $ultraSharp -Force }
        }
    }
}
$animeSharp = Join-Path $upscaleDir '4x-AnimeSharp.pth'
if (-not (Test-Path $animeSharp)) {
    Invoke-WithSpinner 'Downloading 4x-AnimeSharp upscale model' {
        try {
            Invoke-WebRequest -UseBasicParsing -ErrorAction Stop -Uri 'https://huggingface.co/Kim2091/AnimeSharp/resolve/main/4x-AnimeSharp.pth' -OutFile $animeSharp
        } catch {
            Write-Warn '4x-AnimeSharp download failed (grab it via the Models tab, or turn Upscale off).'
            if (Test-Path $animeSharp) { Remove-Item $animeSharp -Force }
        }
    }
}
# ComfyUI Impact Pack + Subpack — provide FaceDetailer, UltralyticsDetectorProvider,
# and SAMLoader for the optional Face Detailer stage on all image workflows.
Install-NodePack 'comfyui-impact-pack'    'https://github.com/ltdrdata/ComfyUI-Impact-Pack.git'
Install-NodePack 'comfyui-impact-subpack' 'https://github.com/ltdrdata/ComfyUI-Impact-Subpack.git'
# Face Detailer models: the bbox face detector (UltralyticsDetectorProvider) and
# the SAM segmenter (SAMLoader). The workflows reference these by name, so the
# (default-on) detailer stage needs them present to pass prompt validation.
$bboxDir = Join-Path $ComfyDir 'models\ultralytics\bbox'
$faceYolo = Join-Path $bboxDir 'face_yolov8m.pt'
if (-not (Test-Path $faceYolo)) {
    if (-not (Test-Path $bboxDir)) { New-Item -ItemType Directory -Path $bboxDir | Out-Null }
    Invoke-WithSpinner 'Downloading face_yolov8m detector (detailer)' {
        try {
            Invoke-WebRequest -UseBasicParsing -ErrorAction Stop -Uri 'https://huggingface.co/Bingsu/adetailer/resolve/main/face_yolov8m.pt' -OutFile $faceYolo
        } catch {
            Write-Warn 'face_yolov8m download failed (grab it via the Models tab, or turn Detailer off).'
            if (Test-Path $faceYolo) { Remove-Item $faceYolo -Force }
        }
    }
}
$samDir = Join-Path $ComfyDir 'models\sams'
$samModel = Join-Path $samDir 'sam_vit_b_01ec64.pth'
if (-not (Test-Path $samModel)) {
    if (-not (Test-Path $samDir)) { New-Item -ItemType Directory -Path $samDir | Out-Null }
    Invoke-WithSpinner 'Downloading SAM ViT-B segmenter (detailer)' {
        try {
            Invoke-WebRequest -UseBasicParsing -ErrorAction Stop -Uri 'https://dl.fbaipublicfiles.com/segment_anything/sam_vit_b_01ec64.pth' -OutFile $samModel
        } catch {
            Write-Warn 'SAM model download failed (grab it via the Models tab, or turn Detailer off).'
            if (Test-Path $samModel) { Remove-Item $samModel -Force }
        }
    }
}
# ComfyUI-Crystools — powers the studio top bar's live CPU/RAM/VRAM meters
# (SystemMonitor reads its `crystools.monitor` websocket stream). Without it the
# meters silently stay idle. Its requirements (deepdiff) are installed by Install-NodePack.
Install-NodePack 'ComfyUI-Crystools'      'https://github.com/crystian/ComfyUI-Crystools.git'
Write-Ok 'Custom nodes ready'

# ── Step 11b: ControlNet Aux + IP-Adapter Plus nodes + models ─────────────────
Write-Info 'Installing ControlNet / IP-Adapter nodes and models'
# comfyui_controlnet_aux — preprocessors (Canny, Depth, Pose, etc.) used by
# the ControlNet graph helper (appendControlNet / appendImg2Img).
Install-NodePack 'comfyui_controlnet_aux'  'https://github.com/Fannovel16/comfyui_controlnet_aux.git'
# ComfyUI_IPAdapter_plus — IPAdapterUnifiedLoader + apply nodes used by
# the IP-Adapter graph helper (appendIpAdapter). The node packs are small and
# always installed; only the multi-GB model downloads below are optional.
Install-NodePack 'ComfyUI_IPAdapter_plus'  'https://github.com/cubiq/ComfyUI_IPAdapter_plus.git'
if ($InstallCnModels) {
# comfyui_controlnet_aux fetches its preprocessor weights on FIRST use of each
# node (OpenPose ~500 MB, DepthAnythingV2 ~1.3 GB). That first ControlNet run
# would otherwise block on a large download and, until it finishes, emit an
# empty control map — so the pose/depth is silently ignored. Pre-fetch them here
# so ControlNet works on the first try. The ckpts paths mirror the HF repos the
# aux pack reads from (Canny/Scribble need no weights). Non-fatal: a failed grab
# just falls back to the original on-demand download.
$auxCkpts  = Join-Path $cnDir 'comfyui_controlnet_aux\ckpts'
$auxModels = @(
    @{ Url = 'https://huggingface.co/lllyasviel/Annotators/resolve/main/body_pose_model.pth';                 Dir = 'lllyasviel\Annotators';                  Name = 'body_pose_model.pth' },
    @{ Url = 'https://huggingface.co/lllyasviel/Annotators/resolve/main/hand_pose_model.pth';                 Dir = 'lllyasviel\Annotators';                  Name = 'hand_pose_model.pth' },
    @{ Url = 'https://huggingface.co/lllyasviel/Annotators/resolve/main/facenet.pth';                         Dir = 'lllyasviel\Annotators';                  Name = 'facenet.pth' },
    @{ Url = 'https://huggingface.co/depth-anything/Depth-Anything-V2-Large/resolve/main/depth_anything_v2_vitl.pth'; Dir = 'depth-anything\Depth-Anything-V2-Large'; Name = 'depth_anything_v2_vitl.pth' }
)
foreach ($m in $auxModels) {
    $destDir = Join-Path $auxCkpts $m.Dir
    $dest    = Join-Path $destDir $m.Name
    if (Test-Path $dest) { continue }
    if (-not (Test-Path $destDir)) { New-Item -ItemType Directory -Path $destDir -Force | Out-Null }
    Invoke-WithSpinner ('Downloading ControlNet preprocessor weight: ' + $m.Name) {
        try {
            Invoke-WebRequest -UseBasicParsing -ErrorAction Stop -Uri $m.Url -OutFile $dest
        } catch {
            Write-Warn ($m.Name + ' download failed — it will be fetched on first ControlNet use instead.')
            if (Test-Path $dest) { Remove-Item $dest -Force }
        }
    }
}
# ControlNet Union SDXL ProMax — single model covers all 7 control types.
# Filename must match UNION_MODEL in app/src/lib/workflows/controlnet.ts.
$cnModelDir  = Join-Path $ComfyDir 'models\controlnet'
$cnUnion     = Join-Path $cnModelDir 'controlnet-union-sdxl-promax.safetensors'
if (-not (Test-Path $cnUnion)) {
    if (-not (Test-Path $cnModelDir)) { New-Item -ItemType Directory -Path $cnModelDir | Out-Null }
    Invoke-WithSpinner 'Downloading ControlNet Union SDXL ProMax' {
        try {
            Invoke-WebRequest -UseBasicParsing -ErrorAction Stop -Uri 'https://huggingface.co/xinsir/controlnet-union-sdxl-1.0/resolve/main/diffusion_pytorch_model_promax.safetensors' -OutFile $cnUnion
        } catch {
            Write-Warn 'ControlNet Union download failed (grab it via the Models tab).'
            if (Test-Path $cnUnion) { Remove-Item $cnUnion -Force }
        }
    }
}
# IP-Adapter Plus SDXL ViT-H — used by IPAdapterUnifiedLoader preset
# 'PLUS (high strength)' for style/face-reference conditioning.
$ipaDir  = Join-Path $ComfyDir 'models\ipadapter'
$ipaPlus = Join-Path $ipaDir 'ip-adapter-plus_sdxl_vit-h.safetensors'
if (-not (Test-Path $ipaPlus)) {
    if (-not (Test-Path $ipaDir)) { New-Item -ItemType Directory -Path $ipaDir | Out-Null }
    Invoke-WithSpinner 'Downloading IP-Adapter Plus SDXL ViT-H' {
        try {
            Invoke-WebRequest -UseBasicParsing -ErrorAction Stop -Uri 'https://huggingface.co/h94/IP-Adapter/resolve/main/sdxl_models/ip-adapter-plus_sdxl_vit-h.safetensors' -OutFile $ipaPlus
        } catch {
            Write-Warn 'IP-Adapter Plus download failed (grab it via the Models tab).'
            if (Test-Path $ipaPlus) { Remove-Item $ipaPlus -Force }
        }
    }
}
# CLIP ViT-H vision encoder — required by IPAdapterUnifiedLoader alongside the
# IP-Adapter weights. Hosted as model.safetensors; renamed to the canonical
# CLIP-ViT-H-14-laion2B-s32B-b79K.safetensors filename ComfyUI expects.
$cvDir  = Join-Path $ComfyDir 'models\clip_vision'
$cvVitH = Join-Path $cvDir 'CLIP-ViT-H-14-laion2B-s32B-b79K.safetensors'
if (-not (Test-Path $cvVitH)) {
    if (-not (Test-Path $cvDir)) { New-Item -ItemType Directory -Path $cvDir | Out-Null }
    Invoke-WithSpinner 'Downloading CLIP ViT-H-14 vision encoder (IP-Adapter)' {
        try {
            Invoke-WebRequest -UseBasicParsing -ErrorAction Stop -Uri 'https://huggingface.co/h94/IP-Adapter/resolve/main/models/image_encoder/model.safetensors' -OutFile $cvVitH
        } catch {
            Write-Warn 'CLIP ViT-H download failed (grab it via the Models tab).'
            if (Test-Path $cvVitH) { Remove-Item $cvVitH -Force }
        }
    }
}
# Z-Image Turbo Fun Union ControlNet — model patch for the z-image control path
# (ModelPatchLoader + QwenImageDiffsynthControlnet). Filename must match FUN_MODEL
# in app/src/lib/workflows/zimage-controlnet.ts.
$mpDir = Join-Path $ComfyDir 'models\model_patches'
$zFun  = Join-Path $mpDir 'Z-Image-Turbo-Fun-Controlnet-Union-2.1-2601-8steps.safetensors'
if (-not (Test-Path $zFun)) {
    if (-not (Test-Path $mpDir)) { New-Item -ItemType Directory -Path $mpDir | Out-Null }
    Invoke-WithSpinner 'Downloading Z-Image Fun Union ControlNet' {
        try {
            Invoke-WebRequest -UseBasicParsing -ErrorAction Stop -Uri 'https://huggingface.co/alibaba-pai/Z-Image-Turbo-Fun-Controlnet-Union-2.1/resolve/main/Z-Image-Turbo-Fun-Controlnet-Union-2.1-2601-8steps.safetensors' -OutFile $zFun
        } catch {
            Write-Warn 'Z-Image Fun ControlNet download failed (grab it via the Models tab).'
            if (Test-Path $zFun) { Remove-Item $zFun -Force }
        }
    }
}
} else {
    Write-Info 'Skipping ControlNet / IP-Adapter models (optional; download them any time from the Models page).'
}
# SDXL fp16-fix VAE — decoded through by the SDXL/Pony/Illustrious workflows in
# place of a checkpoint's baked VAE, which fixes washed-out / desaturated colors
# (the SDXL fp16 VAE overflow, notably on Illustrious). Filename must match
# SDXL_FIX_VAE in app/src/lib/workflows/sdxl.ts.
$vaeDir = Join-Path $ComfyDir 'models\vae'
$sdxlVae = Join-Path $vaeDir 'sdxl_vae.safetensors'
if (-not (Test-Path $sdxlVae)) {
    if (-not (Test-Path $vaeDir)) { New-Item -ItemType Directory -Path $vaeDir | Out-Null }
    Invoke-WithSpinner 'Downloading SDXL fp16-fix VAE' {
        try {
            Invoke-WebRequest -UseBasicParsing -ErrorAction Stop -Uri 'https://huggingface.co/madebyollin/sdxl-vae-fp16-fix/resolve/main/sdxl.vae.safetensors' -OutFile $sdxlVae
        } catch {
            Write-Warn 'SDXL VAE download failed (grab it via the Models tab).'
            if (Test-Path $sdxlVae) { Remove-Item $sdxlVae -Force }
        }
    }
}
Write-Ok 'ControlNet / IP-Adapter nodes and models ready'

# ── Step 12: LTX 2.3 video nodes (+ C++ build tools) ──────────────────────────
Write-Step 'Installing LTX 2.3 video nodes'
Write-Info 'Video generation adds ~9 node packs. The large LTX models are NOT fetched'
Write-Info 'here — download them later from the Models page when you want video.'
Install-BuildTools
Install-NodePack 'comfyui-kjnodes'          'https://github.com/kijai/ComfyUI-KJNodes.git'
Install-NodePack 'comfyui-videohelpersuite' 'https://github.com/Kosinkadink/ComfyUI-VideoHelperSuite.git'
Install-NodePack 'comfyui-easy-use'         'https://github.com/yolain/ComfyUI-Easy-Use.git'
Install-NodePack 'ComfyMath'                'https://github.com/evanspearman/ComfyMath.git'
Install-NodePack 'ComfyLiterals'            'https://github.com/M1kep/ComfyLiterals.git'
Install-NodePack 'RES4LYF'                  'https://github.com/ClownsharkBatwing/RES4LYF.git'
Install-NodePack 'controlaltai-nodes'       'https://github.com/gseth/ControlAltAI-Nodes.git'
Install-NodePack '10S_Nodes'                'https://github.com/TenStrip/10S-Comfy-nodes.git'
Install-NodePack 'ComfyUI-mxToolkit'        'https://github.com/Smirnov75/ComfyUI-mxToolkit.git'
Install-NodePack 'comfyui-various'          'https://github.com/jamesWalker55/comfyui-various.git'
Install-NodePack 'ComfyUI-LTXVideo'         'https://github.com/Lightricks/ComfyUI-LTXVideo.git'
Install-NodePack 'ComfyUI-VFI'              'https://github.com/GACLove/ComfyUI-VFI.git'
# comfyui-various imports soundfile lazily (not in its requirements.txt), and
# ComfyUI-LTXVideo's pyramid blending breaks on kornia 0.8.3 — pin what works.
Invoke-WithSpinner 'Installing video node extra deps' {
    & $uvExe pip install --python $VenvPython soundfile 'kornia==0.8.1' 2>&1 | Add-Content -Path $LogFile -Encoding UTF8
}
# RTX video super-resolution — needs an RTX GPU + TensorRT (nvidia-vfx). The
# single most fragile piece; kept fully non-fatal so the install still finishes.
Install-NodePack 'comfyui_nvidia_rtx_nodes' 'https://github.com/Comfy-Org/Nvidia_RTX_Nodes_ComfyUI.git'
# RaccoonVideoNodes — the studio's video prompt node pack, vendored in the repo.
Copy-VendorPack 'RaccoonVideoNodes'
# RaccoonSwapNodes — pixel-boost face swap, vendored in the repo.
Copy-VendorPack 'RaccoonSwapNodes'
Write-Ok 'LTX 2.3 video nodes ready'

# ── Step 13: App Node.js deps ─────────────────────────────────────────────────
Write-Step 'Installing Raccoon Studio app dependencies'
if (-not (Test-Path (Join-Path $AppDir 'package.json'))) {
    Write-Fail "app\package.json not found at $AppDir"
}
Invoke-WithSpinner 'Running npm install' {
    Add-Log "[CMD] npm install --prefix $AppDir"
    & npm install --prefix $AppDir 2>&1 | Add-Content -Path $LogFile -Encoding UTF8
    if ($LASTEXITCODE -ne 0) { Write-Fail 'npm install failed.' }
}
Write-Ok 'Node.js dependencies installed'

# ── Step 14: Start scripts, .env.local, icon, desktop shortcut ───────────────
Write-Step 'Creating start scripts, configuration, and desktop shortcut'

# start-comfyui.ps1
$startComfyPS1 = Join-Path $RootDir 'start-comfyui.ps1'
if (-not $DryRun) {
Set-Content $startComfyPS1 -Encoding UTF8 -Value @"
# Raccoon Studio — Start ComfyUI
`$Root       = Split-Path -Parent `$MyInvocation.MyCommand.Path
`$Python     = Join-Path `$Root 'comfyui\ComfyUI\.venv\Scripts\python.exe'
`$MainScript = Join-Path `$Root 'comfyui\ComfyUI\main.py'
if (-not (Test-Path `$MainScript)) {
    Write-Host '[Raccoon Studio] ComfyUI not found. Run install-windows.bat first.' -ForegroundColor Red
    exit 1
}
Write-Host '[Raccoon Studio] Starting ComfyUI on 127.0.0.1:8188...' -ForegroundColor Cyan
Set-Location (Split-Path `$MainScript)
# --enable-cors-header lets the studio UI (different port) reach ComfyUI;
# without it ComfyUI 403s the browser WebSocket handshake.
# --preview-method auto streams decoded latent previews each sampling step so the
# studio canvas shows the image building up live (taesd if present, else latent2rgb).
# --reserve-vram 8 keeps headroom for the LTX video upscale pass's full-res
# attention activations (A/B 2026-07-18 on a 32 GB RTX 5090: upscale steps
# 78 -> 68 s/it, peak shared GPU memory 24 -> 16.5 GB).
& `$Python -s `$MainScript --listen 127.0.0.1 --port 8188 --enable-cors-header "*" --preview-method auto --preview-size 768 --reserve-vram 8
"@
}
Write-Ok 'start-comfyui.ps1 created'

# start-comfyui.bat
$startComfyBat = Join-Path $RootDir 'start-comfyui.bat'
if (-not $DryRun) { Set-Content $startComfyBat -Encoding ASCII -Value "@echo off`r`ntitle Raccoon Studio — ComfyUI`r`npowershell.exe -ExecutionPolicy Bypass -File `"%~dp0start-comfyui.ps1`"`r`npause" }
Write-Ok 'start-comfyui.bat created'

# start.bat — both services
$startBat = Join-Path $RootDir 'start.bat'
if (-not $DryRun) {
Set-Content $startBat -Encoding ASCII -Value @"
@echo off
title Raccoon Studio
echo.
echo   Raccoon Studio - Starting up
echo   =========================================
echo.
echo   Starting ComfyUI in background...
start "ComfyUI" /min powershell.exe -ExecutionPolicy Bypass -File "%~dp0start-comfyui.ps1"
timeout /t 3 /nobreak >nul
echo   Starting Raccoon Studio web app...
echo   Open http://localhost:3000 in your browser
echo.
cd /d "%~dp0app"
npm run dev
"@
}
Write-Ok 'start.bat created'

# stop.ps1 — stops the web app (port 3000) and ComfyUI (port 8188)
$stopPS1 = Join-Path $RootDir 'stop.ps1'
if (-not $DryRun) {
Set-Content $stopPS1 -Encoding UTF8 -Value @'
# Raccoon Studio — Stop the web app and ComfyUI
function Stop-Port([int]$Port) {
    try {
        $conns = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
        foreach ($c in $conns) {
            Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue
        }
    } catch {}
}
Write-Host '[Raccoon Studio] Stopping web app (port 3000)...' -ForegroundColor Cyan
Stop-Port 3000
Write-Host '[Raccoon Studio] Stopping ComfyUI (port 8188)...' -ForegroundColor Cyan
Stop-Port 8188
# Fallback: stop any windows we launched by title
Get-Process -Name 'python','pythonw' -ErrorAction SilentlyContinue |
    Where-Object { $_.Path -and $_.Path -like '*comfyui*ComfyUI*' } |
    Stop-Process -Force -ErrorAction SilentlyContinue
Write-Host '[Raccoon Studio] Done.' -ForegroundColor Green
'@
}
Write-Ok 'stop.ps1 created'

# stop.bat
$stopBat = Join-Path $RootDir 'stop.bat'
if (-not $DryRun) { Set-Content $stopBat -Encoding ASCII -Value "@echo off`r`ntitle Raccoon Studio - Stop`r`npowershell.exe -ExecutionPolicy Bypass -File `"%~dp0stop.ps1`"`r`ntimeout /t 2 /nobreak >nul" }
Write-Ok 'stop.bat created'

# .env.local (forward slashes for Node.js path compat)
$envFile = Join-Path $AppDir '.env.local'
$outDir  = ($ComfyDir + '\output').Replace('\','/')
$modDir  = ($ComfyDir + '\models').Replace('\','/')
$startSc = $startComfyPS1.Replace('\','/')
if (-not $DryRun) {
if (Test-Path $envFile) {
    Copy-Item $envFile "$envFile.bak" -Force
    Write-Info '.env.local backed up'
}
Set-Content $envFile -Encoding UTF8 -Value @"
COMFYUI_BASE_URL=http://127.0.0.1:8188
COMFYUI_OUTPUT_DIR=$outDir
COMFYUI_MODELS_DIR=$modDir
COMFYUI_START_SCRIPT=$startSc
"@
}
Write-Ok '.env.local written'

# Save icon files
$iconDir = Join-Path $RootDir 'app\public'
$iconIcoB64 = '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'

# Only the .ico files are generated - both are gitignored, so a checkout lacks them.
# app/public/icon-48.png ships tracked in the repo; writing it here replaced the
# raccoon logo with a stale one and left every install with a dirty working tree.
$iconIcoPath = Join-Path $iconDir 'raccoon-studio.ico'
$rootIcoPath = Join-Path $RootDir 'raccoon-studio.ico'

if (-not $DryRun) {
try {
    [IO.File]::WriteAllBytes($iconIcoPath, [Convert]::FromBase64String($iconIcoB64))
    [IO.File]::WriteAllBytes($rootIcoPath, [Convert]::FromBase64String($iconIcoB64))
    Write-Ok "Icons saved"
    Add-Log "[ICON] Saved icon files"
} catch {
    Write-Warn "Could not save icon files: $_"
}
}

# Desktop shortcuts + Start Menu (Launcher home base + power-user Start/Stop)
if (-not $NoDesktopShortcut) {
    # The launcher (Install/Start/Update/Stop home base) is the primary shortcut.
    $launcher = Join-Path $RootDir 'Raccoon Studio.bat'
    Install-DesktopShortcut -TargetBat $launcher -IcoPath $rootIcoPath -Name 'Raccoon Studio' -Desc 'Install, start and update Raccoon Studio'
    Install-StartMenuEntry  -TargetBat $launcher -IcoPath $rootIcoPath -Name 'Raccoon Studio' -Desc 'Install, start and update Raccoon Studio'
    # Direct Start/Stop kept for power users.
    Install-DesktopShortcut -TargetBat $startBat -IcoPath $rootIcoPath -Name 'Start Raccoon Studio' -Desc 'Start ComfyUI and the Raccoon Studio web app'
    Install-DesktopShortcut -TargetBat $stopBat  -IcoPath $rootIcoPath -Name 'Stop Raccoon Studio'  -Desc 'Stop the Raccoon Studio web app and ComfyUI'
    Install-StartMenuEntry  -TargetBat $startBat -IcoPath $rootIcoPath -Name 'Start Raccoon Studio' -Desc 'Start ComfyUI and the Raccoon Studio web app'
    Install-StartMenuEntry  -TargetBat $stopBat  -IcoPath $rootIcoPath -Name 'Stop Raccoon Studio'  -Desc 'Stop the Raccoon Studio web app and ComfyUI'
}

# Register in the Windows "Installed apps" / Programs list (per-user, no admin).
Register-InstalledApp $rootIcoPath

# CUDA verification
Test-CudaAcceleration

# ── Done ──────────────────────────────────────────────────────────────────────
Write-Host ''
Write-Host '  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━' -ForegroundColor Green
Write-Host '  ✓  Installation complete!' -ForegroundColor Green
Write-Host '  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━' -ForegroundColor Green
Write-Host ''
Write-Host '  How to start Raccoon Studio:' -ForegroundColor White
Write-Host '    → Double-click "Start Raccoon Studio" on your Desktop' -ForegroundColor Gray
Write-Host '    → Or double-click start.bat in this folder' -ForegroundColor Gray
Write-Host '    → Then open: http://localhost:3000' -ForegroundColor Cyan
Write-Host ''
Write-Host '  Download models from the Models page before generating.' -ForegroundColor DarkGray
Write-Host "  Log saved to: $LogFile" -ForegroundColor DarkGray
Write-Host '  If anything ever misbehaves, double-click collect-support.bat and send' -ForegroundColor Yellow
Write-Host '  the file it saves to your Desktop.' -ForegroundColor Yellow
Write-Host ''
