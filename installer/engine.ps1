#Requires -Version 5.1
param([Parameter(Position=0)][string]$Verb='status', [switch]$DryRun)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'lib.ps1')
if (-not $env:HEALTH_URL) { $env:HEALTH_URL = 'http://localhost:3000' }
$ComfyPy = Join-Path $env:RACCOON_ROOT 'comfyui/ComfyUI/.venv/Scripts/python.exe'
$AppMods = Join-Path $env:RACCOON_ROOT 'app/node_modules'
function Test-Installed { (Test-Path $ComfyPy) -and (Test-Path $AppMods) }
function Test-Running { try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 $env:HEALTH_URL | Out-Null; $true } catch { $false } }
function Get-RsStatus { if (Test-Running) {'running'} elseif (Test-Installed) {'stopped'} else {'not-installed'} }

function Invoke-Start {
  Emit-Progress 1 3 'Starting ComfyUI'
  if ($DryRun) { Emit-Progress 2 3 '[dry-run] would start web app'; Emit-Progress 3 3 '[dry-run] ready'; Emit-Done 'start'; return }
  Start-Process -FilePath (Join-Path $env:RACCOON_ROOT 'start-comfyui.bat') -WindowStyle Hidden
  Emit-Progress 2 3 'Starting web app'
  Start-Process -FilePath 'cmd.exe' -ArgumentList '/c','npm','run','dev' -WorkingDirectory (Join-Path $env:RACCOON_ROOT 'app') -WindowStyle Hidden
  $n=0; while (-not (Test-Running) -and $n -lt 60) { Start-Sleep 1; $n++ }
  if (-not (Test-Running)) { Emit-Fail 'start' "Services did not become healthy after 60s - check logs"; exit 1 }
  Emit-Progress 3 3 "Ready at $($env:HEALTH_URL)"; Emit-Done 'start'
}
# Call stop.ps1 directly, not stop.bat: the .bat ends with `timeout` (for the
# double-click case) which errors "input redirection is not supported" when the
# engine runs it with redirected output. We're already in PowerShell anyway.
function Invoke-Stop { Emit-Progress 1 1 'Stopping services'; if (-not $DryRun) { & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $env:RACCOON_ROOT 'stop.ps1') 2>&1 | Out-Null }; Emit-Done 'stop' }
function Invoke-Update {
  # STUB - git-pull backend (app + ComfyUI + nodes) lands later.
  Emit-Progress 1 2 'Checking for updates'
  if ($DryRun) { Emit-Progress 2 2 '[dry-run] update stub'; Emit-Done 'update'; return }
  Emit-Progress 2 2 'Up to date'; Emit-Warn 'Update backend not yet implemented - no changes made.'; Emit-Done 'update'
}
function Invoke-Install {
  $psArgs = @('-ExecutionPolicy','Bypass','-NoProfile','-File',(Join-Path $env:RACCOON_ROOT 'install-windows.ps1'))
  if ($DryRun) { $psArgs += '-DryRun' }
  & powershell.exe @psArgs; if ($LASTEXITCODE -ne 0) { Emit-Fail 'install' "see $script:LogFile"; exit 1 }
  Emit-Done 'install'
}
switch ($Verb) {
  'status'  { Get-RsStatus }
  'start'   { Invoke-Start }
  'stop'    { Invoke-Stop }
  'update'  { Invoke-Update }
  'install' { Invoke-Install }
  default   { [Console]::Error.WriteLine('usage: engine.ps1 {install|start|stop|update|status} [-DryRun]'); exit 2 }
}
