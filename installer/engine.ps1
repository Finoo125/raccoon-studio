#Requires -Version 5.1
param([Parameter(Position=0)][string]$Verb='status', [switch]$DryRun, [switch]$WithControlNet,
      [ValidateSet('','auto','nvidia','amd','cpu')][string]$Gpu='')
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'lib.ps1')
if (-not $env:HEALTH_URL) { $env:HEALTH_URL = 'http://localhost:3000' }
$ComfyPy = Join-Path $env:RACCOON_ROOT 'comfyui/ComfyUI/.venv/Scripts/python.exe'
$AppMods = Join-Path $env:RACCOON_ROOT 'app/node_modules'
$PublicRepo = 'https://github.com/Finoo125/raccoon-studio.git'
function Test-Installed { (Test-Path $ComfyPy) -and (Test-Path $AppMods) }
function Test-Running { try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 $env:HEALTH_URL | Out-Null; $true } catch { $false } }
function Get-RsStatus { if (Test-Running) {'running'} elseif (Test-Installed) {'stopped'} else {'not-installed'} }

function Get-UpdateState {
  # One cheap network call, no fetch: is local HEAD the commit `update` would pull?
  # Same comparison Invoke-Update makes, so 'up-to-date' means clicking Update is
  # provably a no-op. 'unknown' on any git/network failure - the launcher then
  # leaves its button neutral rather than inventing an answer.
  # ponytail: a dev clone has its own history, so it always reads update-available.
  if ($DryRun) { return 'unknown' }
  $env:GIT_TERMINAL_PROMPT = '0'   # an unreachable repo must fail, not hang on a credential prompt
  # EAP downgrade + no pipeline: git writes to stderr, which is fatal under
  # EAP=Stop (see Invoke-Update), and `| Select -First 1` would tear the pipe
  # down early and corrupt $LASTEXITCODE.
  $eap = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  try {
    $local = @(& git -C $env:RACCOON_ROOT rev-parse HEAD 2>$null)[0]
    if ($LASTEXITCODE -ne 0 -or -not $local) { Write-RsLog '[check-update] not a git checkout'; return 'unknown' }
    $remote = @(& git ls-remote $PublicRepo main 2>$null)[0]
    if ($LASTEXITCODE -ne 0 -or -not $remote) { Write-RsLog '[check-update] could not reach the public repo'; return 'unknown' }
  } finally { $ErrorActionPreference = $eap }
  if ("$local".Trim() -eq (("$remote" -split '\s+')[0])) { 'up-to-date' } else { 'update-available' }
}

function Invoke-Start {
  Emit-Progress 1 3 'Starting ComfyUI'
  if ($DryRun) { Emit-Progress 2 3 '[dry-run] would start web app'; Emit-Progress 3 3 '[dry-run] ready'; Emit-Done 'start'; return }
  # The launcher is generated and gitignored, so a `git pull` update leaves an
  # old copy in place. Rebuild the stub when it predates the current shape -
  # cheap, and it means launch-flag changes reach manually-pulled installs.
  $startPs1 = Join-Path $env:RACCOON_ROOT 'start-comfyui.ps1'
  if (Test-StartScriptStale $startPs1) {
    Write-RsLog '[start] launcher stub outdated - regenerating'
    Write-StartComfyStub $startPs1
  }
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
  # Pull the public release repo explicitly (not whatever origin points at), then
  # re-run the idempotent installer if new code arrived so deps/vendor nodes stay
  # in sync. --ff-only makes a pull against any non-release clone fail safely.
  Emit-Progress 1 3 'Checking the public repo for updates'
  if ($DryRun) { Emit-Progress 2 3 '[dry-run] would git pull'; Emit-Progress 3 3 '[dry-run] up to date'; Emit-Done 'update'; return }
  # Local EAP downgrade: git writes progress to stderr, and under WinPS 5.1 a
  # 2>&1 redirect with EAP=Stop turns that into a fatal NativeCommandError
  # (see install-windows.ps1 header note).
  $eap = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  $before = (& git -C $env:RACCOON_ROOT rev-parse HEAD 2>&1 | Select-Object -First 1)
  & git -C $env:RACCOON_ROOT pull --ff-only $PublicRepo main 2>&1 | ForEach-Object { Write-RsLog "[git] $_" }
  $pullExit = $LASTEXITCODE
  $after = (& git -C $env:RACCOON_ROOT rev-parse HEAD 2>&1 | Select-Object -First 1)
  $ErrorActionPreference = $eap
  if ($pullExit -ne 0) { Emit-Fail 'update' "git pull from the public repo failed - see $script:LogFile"; exit 1 }
  if ("$before" -eq "$after") { Emit-Progress 3 3 'Already up to date'; Emit-Done 'update'; return }
  Emit-Progress 2 3 'Update downloaded - applying (this can take a few minutes)'
  Invoke-Install
}
function Invoke-Install {
  $psArgs = @('-ExecutionPolicy','Bypass','-NoProfile','-File',(Join-Path $env:RACCOON_ROOT 'install-windows.ps1'))
  # Always pass an explicit ControlNet flag: the engine runs headless (GUI/update),
  # so the installer must never fall through to its interactive prompt.
  $psArgs += $(if ($WithControlNet) { '-WithControlNet' } else { '-SkipControlNet' })
  # Same reason, for every other question the installer might ask. A flag per
  # prompt does not scale and missing one hangs the GUI on a question nobody can
  # see (the AMD/ROCm offer did exactly that), so state the condition once.
  $psArgs += '-NonInteractive'
  # Keep the acceleration stack stable across updates. An explicit -Gpu wins;
  # otherwise inherit whatever the existing venv was built with, because plain
  # `update` would otherwise reinstall CUDA wheels over a working ROCm venv.
  $gpuArg = $Gpu
  if (-not $gpuArg) {
    $existing = Get-InstalledGpuVendor
    if ($existing -eq 'amd') { $gpuArg = 'amd'; Write-RsLog '[install] preserving existing AMD/ROCm stack' }
  }
  if ($gpuArg) { $psArgs += @('-Gpu', $gpuArg) }
  if ($DryRun) { $psArgs += '-DryRun' }
  & powershell.exe @psArgs; if ($LASTEXITCODE -ne 0) { Emit-Fail 'install' "see $script:LogFile"; exit 1 }
  Emit-Done 'install'
}
switch ($Verb) {
  'status'       { Get-RsStatus }
  'check-update' { Get-UpdateState }
  'start'        { Invoke-Start }
  'stop'         { Invoke-Stop }
  'update'       { Invoke-Update }
  'install'      { Invoke-Install }
  default        { [Console]::Error.WriteLine('usage: engine.ps1 {install|start|stop|update|status|check-update} [-DryRun]'); exit 2 }
}
