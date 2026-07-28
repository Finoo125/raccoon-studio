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
# Refuse to start a second instance. Every start path funnels through this file
# — the launcher, the app's Start button, a manual double-click — so one guard
# here covers all of them.
#
# TWO checks, because they catch different things and only one of them catches
# the case that actually bit a user:
#
#  1. Is OUR ComfyUI already up, or still in its ~45 s boot? Only a process scan
#     sees the second case; the port is still free for most of that window. This
#     is the one that matters — see comfyui_running() in lib.sh for what a missed
#     duplicate does to the shared venv (silently kills face swap for a session).
#  2. Is something else sitting on 8188 — a separate ComfyUI install, ComfyUI
#     Desktop? Different problem, different advice, so it keeps its own message.
#
# lib.sh is sourced only for comfyui_running (it is inert until called, and
# creates no log file just by being sourced), which keeps the tier testable from
# installer/tests/ instead of being untestable inline logic.
. "$CORE_DIR/lib.sh"
if comfyui_running "$VENV_PYTHON" "$COMFYUI_MAIN"; then
  echo "[Raccoon Studio] ComfyUI is already running or starting up - not starting a second instance."
  exit 0
fi
# bash's /dev/tcp needs no external tool, so this works on a bare container.
if (exec 3<>/dev/tcp/127.0.0.1/8188) 2>/dev/null; then
  exec 3>&-
  echo "[Raccoon Studio] Port 8188 is already in use by another program - not starting ComfyUI."
  exit 0
fi

echo "[Raccoon Studio] Starting ComfyUI on 127.0.0.1:8188..."

# All hardware-derived tuning in ONE call: how much VRAM to hold back for the OS,
# whether to let ComfyUI lock host RAM into non-pageable pages (on <=32 GB it pins
# memory the OS can never reclaim and the whole machine hits ~100%), and how big a
# live preview this card can afford to decode every sampling step. See
# reserve-vram.py for the tiers. Overrides: RACCOON_RESERVE_VRAM (0 = ComfyUI's
# own default), RACCOON_PINNED_MEMORY (1 = keep pinning, 0 = disable).
#
# One call, not two, because each one imports torch to probe the card — a measured
# ~1.3 s of pure duplicate work on every start. One flag per line, so a value that
# ever contains a space cannot shatter into two arguments; the `|| [ -n "$line" ]`
# is what keeps the final unterminated line.
TUNE_ARGS=()
while IFS= read -r line || [ -n "$line" ]; do
  line="${line%$'\r'}"   # CR-tolerant, same as pinned_rev in lib.sh
  [ -n "$line" ] && TUNE_ARGS+=("$line")
done < <("$VENV_PYTHON" "$CORE_DIR/reserve-vram.py" --tuning-flags 2>/dev/null || true)
if [ "${#TUNE_ARGS[@]}" -gt 0 ]; then
  echo "[Raccoon Studio] Hardware tuning: ${TUNE_ARGS[*]}"
fi

cd "$(dirname "$COMFYUI_MAIN")"
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
# every later job renders saturated tiled garbage too — which reads as a broken
# VAE or a bad checkpoint rather than a backend bug. Reproduced deterministically
# on Krea2 fp8_scaled 2026-07-27: plain run clean, same graph + LoRA stack
# destroyed, next plain run destroyed. bf16 models (Z-Image) are unaffected.
# Without it ComfyUI uses estimate-based loading, the path it shipped with for
# years; on a 32 GB card the model simply stays fully resident (no speed cost).
exec "$VENV_PYTHON" -s "$COMFYUI_MAIN" --listen 127.0.0.1 --port 8188 \
  --enable-cors-header "*" --preview-method auto \
  --disable-dynamic-vram "${TUNE_ARGS[@]}"
