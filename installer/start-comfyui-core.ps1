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
Write-Host '[Raccoon Studio] Starting ComfyUI on 127.0.0.1:8188...' -ForegroundColor Cyan

# How much VRAM to hold back, decided from this card's size by reserve-vram.py.
# Override with RACCOON_RESERVE_VRAM (0 = use ComfyUI's own default).
$VramArgs = @()
$Reserve  = (& $Python (Join-Path $PSScriptRoot 'reserve-vram.py') 2>$null)
if ($Reserve) {
    $VramArgs = @('--reserve-vram', $Reserve)
    Write-Host "[Raccoon Studio] Reserving ${Reserve} GB VRAM for the OS." -ForegroundColor DarkGray
}

Set-Location (Split-Path $MainScript)
# --enable-cors-header lets the studio UI (different port) reach ComfyUI; without
# it ComfyUI 403s the browser WebSocket handshake.
# --preview-method auto streams decoded latent previews each sampling step so the
# studio canvas shows the image building up live (taesd if present, else latent2rgb).
& $Python -s $MainScript --listen 127.0.0.1 --port 8188 --enable-cors-header "*" --preview-method auto --preview-size 768 @VramArgs
