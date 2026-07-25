#!/usr/bin/env bash
# Raccoon Studio — Start ComfyUI (real launch logic)
#
# Tracked on purpose. The launcher at the repo root (start-comfyui.sh) is
# generated and gitignored, so anything written into it is invisible to `git
# pull` — which is the documented user update path. Keeping the flags and tuning
# here means changes actually reach existing installs. The generated launcher is
# a stub that does nothing but call this file.
set -u
CORE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$CORE_DIR/.." && pwd)"
VENV_PYTHON="$ROOT/comfyui/ComfyUI/.venv/bin/python"
COMFYUI_MAIN="$ROOT/comfyui/ComfyUI/main.py"
if [ ! -f "$COMFYUI_MAIN" ]; then
  echo "[Raccoon Studio] ComfyUI not found. Run install-linux.sh first."; exit 1
fi
echo "[Raccoon Studio] Starting ComfyUI on 127.0.0.1:8188..."

# How much VRAM to hold back, decided from this card's size by reserve-vram.py.
# Override with RACCOON_RESERVE_VRAM (0 = use ComfyUI's own default).
VRAM_ARGS=()
RESERVE=$("$VENV_PYTHON" "$CORE_DIR/reserve-vram.py" 2>/dev/null || true)
if [ -n "$RESERVE" ]; then
  VRAM_ARGS=(--reserve-vram "$RESERVE")
  echo "[Raccoon Studio] Reserving ${RESERVE} GB VRAM for the OS."
fi

cd "$(dirname "$COMFYUI_MAIN")"
# --enable-cors-header lets the studio UI (different port) reach ComfyUI; without
# it ComfyUI 403s the browser WebSocket handshake.
# --preview-method auto streams decoded latent previews each sampling step so the
# studio canvas shows the image building up live (taesd if present, else latent2rgb).
exec "$VENV_PYTHON" -s "$COMFYUI_MAIN" --listen 127.0.0.1 --port 8188 \
  --enable-cors-header "*" --preview-method auto --preview-size 768 "${VRAM_ARGS[@]}"
