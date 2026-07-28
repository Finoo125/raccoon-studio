# Raccoon Studio - Start ComfyUI (real launch logic)
#
# Tracked on purpose. The launcher at the repo root (start-comfyui.ps1) is
# generated and gitignored, so anything written into it is invisible to `git
# pull` - which is the documented user update path. Keeping the flags and tuning
# here means changes actually reach existing installs. The generated launcher is
# a stub that does nothing but call this file.
$Root       = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$Python     = Join-Path $Root 'comfyui\ComfyUI\.venv\Scripts\python.exe'
$MainScript = Join-Path $Root 'comfyui\ComfyUI\main.py'
if (-not (Test-Path $MainScript)) {
    Write-Host '[Raccoon Studio] ComfyUI not found. Run install-windows.bat first.' -ForegroundColor Red
    exit 1
}
# Refuse to start a second instance. Every start path funnels through this file
# - the launcher, the app's Start button, a manual double-click - so one guard
# here covers all of them.
#
# TWO checks, because they catch different things and only one of them catches
# the case that actually bit a user:
#
#  1. Is OUR ComfyUI already up, or still in its ~45s boot? A port check cannot
#     see the second case - ComfyUI imports every custom node before it binds
#     8188, so the port stays free for most of that window and a second start
#     sails straight past. Field-reported 2026-07-27: the guard ran at 17:09:09,
#     the other instance did not bind until 17:09:54. Both then ran
#     ComfyUI-Manager's prestartup pip against the SAME venv, and a pack that
#     imported onnxruntime mid-reinstall got a directory with no __init__.py -
#     imported as a PEP 420 namespace package with no attributes, so
#     RaccoonSwapNodes died on `get_available_providers` and face swap was
#     silently gone for the session. The process exists from t=0; scanning for it
#     is what closes the window.
#  2. Is something else sitting on 8188 - a separate ComfyUI install, ComfyUI
#     Desktop? Different problem, different advice, so it keeps its own message.
#
# .Contains() rather than -like: the path is a literal, and -like would treat any
# [ or ] in it as a character class.
#
# Both sides are lowercased first because .Contains() is case-SENSITIVE and
# Windows paths are not. $MainScript is derived from however this script was
# invoked, so a shortcut or a COMFYUI_START_SCRIPT in .env.local reading
# c:\... while the running instance was launched from C:\... would miss and
# start a second instance - the exact failure this guard exists to prevent.
# The [StringComparison] overload of Contains does not exist on .NET Framework,
# so it is unavailable under Windows PowerShell 5.1; lowercasing is the portable
# form. Ordinal-invariant on purpose: a culture-aware fold would misbehave for a
# user with a Turkish locale and an "I" in their install path.
$MainScriptLower = $MainScript.ToLowerInvariant()
$Running = Get-CimInstance Win32_Process -Filter "Name = 'python.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -and $_.CommandLine.ToLowerInvariant().Contains($MainScriptLower) }
if ($Running) {
    Write-Host '[Raccoon Studio] ComfyUI is already running or starting up - not starting a second instance.' -ForegroundColor Yellow
    exit 0
}
$Listening = Get-NetTCPConnection -LocalPort 8188 -State Listen -ErrorAction SilentlyContinue
if ($Listening) {
    Write-Host '[Raccoon Studio] Port 8188 is already in use by another program - not starting ComfyUI.' -ForegroundColor Yellow
    exit 0
}

Write-Host '[Raccoon Studio] Starting ComfyUI on 127.0.0.1:8188...' -ForegroundColor Cyan

# All hardware-derived tuning in ONE call: how much VRAM to hold back for the OS,
# whether to let ComfyUI lock host RAM into non-pageable pages (on <=32 GB it pins
# memory the OS can never reclaim and the whole machine hits ~100%), and how big a
# live preview this card can afford to decode every sampling step. See
# reserve-vram.py for the tiers. Overrides: RACCOON_RESERVE_VRAM (0 = ComfyUI's
# own default), RACCOON_PINNED_MEMORY (1 = keep pinning, 0 = disable).
#
# One call, not two, because each one imports torch to probe the card - a measured
# ~1.3 s of pure duplicate work on every start. One flag per line, so a value that
# ever contains a space cannot shatter into two arguments.
$TuneArgs = @(& $Python (Join-Path $PSScriptRoot 'reserve-vram.py') --tuning-flags 2>$null |
    Where-Object { $_ })
if ($TuneArgs.Count) {
    Write-Host "[Raccoon Studio] Hardware tuning: $($TuneArgs -join ' ')" -ForegroundColor DarkGray
}

Set-Location (Split-Path $MainScript)
# --enable-cors-header lets the studio UI (different port) reach ComfyUI; without
# it ComfyUI 403s the browser WebSocket handshake.
# --preview-method auto streams decoded latent previews each sampling step so the
# studio canvas shows the image building up live (taesd if present, else latent2rgb).
# --preview-size is NOT hardcoded: that per-step decode is real GPU work, so the
# size comes from the card's VRAM tier above (768 on 16 GB+, ComfyUI's 512 below).
# --disable-dynamic-vram is a CORRECTNESS fix, not a tuning knob. ComfyUI's
# DynamicVRAM weight streaming corrupts an fp8_scaled model already resident in
# VRAM as soon as a job changes the model-patch topology (adding/removing a LoRA
# or the hires pass). The corruption persists until the model is reloaded, so
# every later job renders saturated tiled garbage too - which reads as a broken
# VAE or a bad checkpoint rather than a backend bug. Reproduced deterministically
# on Krea2 fp8_scaled 2026-07-27: plain run clean, same graph + LoRA stack
# destroyed, next plain run destroyed. bf16 models (Z-Image) are unaffected.
# Without it ComfyUI uses estimate-based loading, the path it shipped with for
# years; on a 32 GB card the model simply stays fully resident (no speed cost).
& $Python -s $MainScript --listen 127.0.0.1 --port 8188 --enable-cors-header "*" --preview-method auto --disable-dynamic-vram @TuneArgs
