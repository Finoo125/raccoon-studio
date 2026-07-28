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

# All hardware-derived tuning in ONE call: whether to let ComfyUI lock host RAM
# into non-pageable pages (on <=32 GB it pins memory the OS can never reclaim and
# the whole machine hits ~100%), and how big a live preview this card can afford
# to decode every sampling step. See reserve-vram.py for the tiers. Overrides:
# RACCOON_RESERVE_VRAM (0 = ComfyUI's own default), RACCOON_PINNED_MEMORY (1 =
# keep pinning, 0 = disable).
#
# NOT in that list any more: --reserve-vram. Its meaning depends on which loader
# is running, and the tier was measured against the other one - reserve-vram.py's
# DYNAMIC_VRAM_DISABLED has the whole story. It comes back automatically if the
# flag below ever goes away.
#
# One call, not two, because each one imports torch to probe the card - a measured
# ~1.3 s of pure duplicate work on every start. One flag per line, so a value that
# ever contains a space cannot shatter into two arguments.
$TuneArgs = @(& $Python (Join-Path $PSScriptRoot 'reserve-vram.py') --tuning-flags 2>$null |
    Where-Object { $_ })
if ($TuneArgs.Count) {
    Write-Host "[Raccoon Studio] Hardware tuning: $($TuneArgs -join ' ')" -ForegroundColor DarkGray
}

# The correctness flag, and the one way to turn it off. Decided HERE and not in
# reserve-vram.py on purpose: that call is wrapped in 2>$null, so a torch import
# failure would silently drop the flag and bring the corruption back. Reading a
# plain environment variable cannot fail that way, and anything other than
# exactly "1" leaves the flag on. reserve-vram.py reads the same variable, so the
# reserve tier and this flag can never disagree.
$SafetyArgs = @()
if ($env:RACCOON_DYNAMIC_VRAM -and $env:RACCOON_DYNAMIC_VRAM.Trim() -eq '0') {
    $SafetyArgs = @('--disable-dynamic-vram')
    Write-Host '[Raccoon Studio] RACCOON_DYNAMIC_VRAM=0 - DynamicVRAM OFF. Krea2 renders correctly; video will run host RAM to ~100%.' -ForegroundColor DarkGray
} else {
    Write-Host '[Raccoon Studio] DynamicVRAM ON (video-optimised). Krea2 can render corrupted - set RACCOON_DYNAMIC_VRAM=0 if you need it.' -ForegroundColor Yellow
}

Set-Location (Split-Path $MainScript)
# --enable-cors-header lets the studio UI (different port) reach ComfyUI; without
# it ComfyUI 403s the browser WebSocket handshake.
# --preview-method auto streams decoded latent previews each sampling step so the
# studio canvas shows the image building up live (taesd if present, else latent2rgb).
# --preview-size is NOT hardcoded: that per-step decode is real GPU work, so the
# size comes from the card's VRAM tier above (768 on 16 GB+, ComfyUI's 512 below).
# DynamicVRAM is ON by default (no --disable-dynamic-vram above) because video is
# the priority here. One process gets one memory policy and the two models we
# care about want opposite ones, so this is a product decision, not a tuning one.
#
# What it costs: ComfyUI's DynamicVRAM corrupts an fp8_scaled model resident in
# VRAM, rendering saturated tiled garbage that reads as a broken VAE or a bad
# checkpoint rather than a backend bug. Krea2 is the only fp8_scaled model we
# ship; bf16 models (Z-Image, Anima) and fp16 (SDXL) cannot hit it at all.
# Verified 2026-07-28 by replaying the exact graph out of a corrupted PNG's own
# embedded metadata: 5 of 8 renders corrupted with DynamicVRAM on, 0 of ~20 with
# it off. Two things that first look true are NOT:
#   - It is not the LoRA/hires topology change. That was the 07-27 guess; the
#     07-28 replay corrupted the FIRST render after POST /free, no transition
#     involved. So no amount of unloading between jobs can dodge it.
#   - It is not deterministic. Same graph, same seed, clean at 47.7 saturation
#     one run and garbage at 107.0 the next. Any A/B here needs several runs.
# Reproducing it also needs real VRAM pressure - the ONNX face-swap stack
# resident alongside. Minimal graphs never corrupted, which is why the first
# attempt at a repro came up empty.
#
# What it buys, measured on one LTX 2.3 job (RTX 5090 / 64 GB), host RAM at the
# steady state during sampling: 49-51% with DynamicVRAM on, 100% with it off. The
# legacy ModelPatcher keeps a full CPU-side copy of every model it loads, and
# nothing else reaches that - --disable-pinned-memory was tested first and
# changed nothing, and there was never any weight streaming to fix (no log on
# that box has ever contained "loaded partially").
#
# RACCOON_DYNAMIC_VRAM=0 restores the safe mode for anyone who needs Krea2 more
# than video. The real way out is a bf16 Krea2 build, which dodges the corruption
# without costing video anything - untested as of this writing.
& $Python -s $MainScript --listen 127.0.0.1 --port 8188 --enable-cors-header "*" --preview-method auto @SafetyArgs @TuneArgs
