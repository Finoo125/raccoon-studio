# Raccoon Studio installer - shared progress/log helpers (mirror of lib.sh).
if (-not $env:RACCOON_ROOT) { $env:RACCOON_ROOT = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path }
$script:LogFile = if ($env:LOG_FILE) { $env:LOG_FILE } else { Join-Path $env:RACCOON_ROOT ("logs/install-{0}.log" -f (Get-Date -Format 'yyyyMMdd-HHmmss')) }
function Write-RsLog([string]$m) { $d = Split-Path $script:LogFile; if (-not (Test-Path $d)) { New-Item -ItemType Directory -Force -Path $d | Out-Null }; Add-Content -Path $script:LogFile -Value ("{0} {1}" -f (Get-Date -Format 'HH:mm:ss'), $m) -ErrorAction SilentlyContinue }
function Emit-Progress([int]$step,[int]$total,[string]$msg) { $p=[int]($step*100/$total); Write-Output "PROGRESS|$step|$total|$p|$msg"; Write-RsLog "[STEP $step/$total] $msg" }
function Emit-Warn([string]$m){ Write-Output "WARN|$m"; Write-RsLog "[WARN] $m" }
function Emit-Done([string]$v){ Write-Output "DONE|$v"; Write-RsLog "[DONE] $v" }
function Emit-Fail([string]$v,[string]$m){ Write-Output "FAIL|$v|$m"; Write-RsLog "[FAIL] ${v}: $m" }

# --- GPU detection ----------------------------------------------------------
# AMD cards AMD's own Windows ROCm 7.2.1 matrix covers: gfx1100/1101 (discrete
# RDNA3) and gfx1200/1201 (RDNA4). Everything else Radeon - RX 6000/5000
# (RDNA2/RDNA1), Vega, and the Ryzen iGPUs - has NO Windows ROCm support, so we
# refuse instead of installing a stack that cannot work.
#
# Matching on the marketing name is a pre-flight gate only. The authoritative
# check is gcnArchName from torch after install, which the AMD diagnostics report.
function Test-AmdRocmSupported([string]$Name) {
    if (-not $Name) { return $false }
    return ($Name -match '(?i)\bRX\s*(9\d{3}|7\d{3})') -or
           ($Name -match '(?i)\bPRO\s+W7\d{3}')        -or
           ($Name -match '(?i)\bAI\s+PRO\s+R9\d{3}')
}

# AMD ships Windows ROCm for Windows 11 only. Build 22000 is the 10-to-11
# boundary; an unreadable build counts as OK, so a CIM failure can never be the
# reason an install is refused.
function Test-Windows11 {
    $build = 0
    try { $build = [int](Get-CimInstance Win32_OperatingSystem -ErrorAction Stop).BuildNumber } catch {}
    return ($build -eq 0 -or $build -ge 22000)
}

# The acceleration stack the existing venv was built with, read from the torch
# dist-info directory name (torch-2.9.1+rocm7.2.1.dist-info -> amd). Returns
# $null when nothing is installed yet.
#
# This exists so `update` re-runs the installer with the SAME stack: without it,
# an update would reinstall CUDA wheels straight over a working ROCm venv and
# silently break every AMD user. Reading a directory name is free; importing
# torch to ask would cost ~1.5s.
function Get-InstalledGpuVendor {
    $sp = Join-Path $env:RACCOON_ROOT 'comfyui\ComfyUI\.venv\Lib\site-packages'
    if (-not (Test-Path $sp)) { return $null }
    $d = Get-ChildItem $sp -Filter 'torch-*.dist-info' -Directory -ErrorAction SilentlyContinue |
         Select-Object -First 1
    if (-not $d) { return $null }
    if ($d.Name -match 'rocm')     { return 'amd' }
    if ($d.Name -match '\+cu\d')   { return 'nvidia' }
    return 'cpu'
}

# The most capable Radeon adapter present, or $null when there isn't one.
#
# Prefers a ROCm-capable card rather than taking the first match: a Ryzen APU
# exposes an integrated "AMD Radeon(TM) Graphics" adapter alongside any discrete
# card, and enumeration order is not guaranteed. Picking blindly would refuse a
# perfectly good RX 9070 XT on the very common Ryzen + Radeon build.
function Get-AmdAdapterName {
    try {
        $all = @(Get-CimInstance Win32_VideoController -ErrorAction Stop |
                 Where-Object { $_.Name -match '(?i)AMD|Radeon' } |
                 ForEach-Object { $_.Name } | Where-Object { $_ })
        if ($all.Count -eq 0) { return $null }
        foreach ($n in $all) { if (Test-AmdRocmSupported $n) { return $n } }
        return $all[0]   # unsupported, but naming it makes the refusal message useful
    } catch {}
    return $null
}

# start-comfyui.* is generated and gitignored, so `git pull` can never update a
# user's copy. Bump this whenever the generated launcher's *shape* changes (new
# flag, new helper call) and the launcher regenerates itself on next start.
# Tuning values must NOT live in the generated script - see installer/reserve-vram.py.
$script:StartScriptVersion = 2

# True when the generated launcher predates $StartScriptVersion (or is absent).
function Test-StartScriptStale([string]$Path) {
    if (-not (Test-Path $Path)) { return $true }
    $m = Select-String -Path $Path -Pattern 'raccoon-start-version:\s*(\d+)' -ErrorAction SilentlyContinue |
         Select-Object -First 1
    if (-not $m) { return $true }   # pre-versioning script
    return [int]$m.Matches[0].Groups[1].Value -lt $script:StartScriptVersion
}

# Write the generated launcher. Deliberately a stub: it holds no flags and no
# tuning, so a shape bump should never be needed again. `&` runs the core script
# in this same process, keeping the python child in the same process tree that
# stop.ps1's process-group kill relies on.
function Write-StartComfyStub([string]$Path) {
    Set-Content $Path -Encoding UTF8 -Value @"
# Raccoon Studio - Start ComfyUI
# raccoon-start-version: $script:StartScriptVersion
# Generated stub. All logic lives in installer\start-comfyui-core.ps1, which is
# tracked so ``git pull`` updates it. Safe to delete - rebuilt on next launch.
`$Root = Split-Path -Parent `$MyInvocation.MyCommand.Path
& (Join-Path `$Root 'installer\start-comfyui-core.ps1')
"@
}
