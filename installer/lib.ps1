# Raccoon Studio installer - shared progress/log helpers (mirror of lib.sh).
if (-not $env:RACCOON_ROOT) { $env:RACCOON_ROOT = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path }
$script:LogFile = if ($env:LOG_FILE) { $env:LOG_FILE } else { Join-Path $env:RACCOON_ROOT ("logs/install-{0}.log" -f (Get-Date -Format 'yyyyMMdd-HHmmss')) }
function Write-RsLog([string]$m) { $d = Split-Path $script:LogFile; if (-not (Test-Path $d)) { New-Item -ItemType Directory -Force -Path $d | Out-Null }; Add-Content -Path $script:LogFile -Value ("{0} {1}" -f (Get-Date -Format 'HH:mm:ss'), $m) -ErrorAction SilentlyContinue }
function Emit-Progress([int]$step,[int]$total,[string]$msg) { $p=[int]($step*100/$total); Write-Output "PROGRESS|$step|$total|$p|$msg"; Write-RsLog "[STEP $step/$total] $msg" }
function Emit-Warn([string]$m){ Write-Output "WARN|$m"; Write-RsLog "[WARN] $m" }
function Emit-Done([string]$v){ Write-Output "DONE|$v"; Write-RsLog "[DONE] $v" }
function Emit-Fail([string]$v,[string]$m){ Write-Output "FAIL|$v|$m"; Write-RsLog "[FAIL] ${v}: $m" }
