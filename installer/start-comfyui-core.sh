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

# All hardware-derived tuning in ONE call: whether to let ComfyUI lock host RAM
# into non-pageable pages (on <=32 GB it pins memory the OS can never reclaim and
# the whole machine hits ~100%), and how big a live preview this card can afford
# to decode every sampling step. See reserve-vram.py for the tiers. Overrides:
# RACCOON_RESERVE_VRAM (0 = ComfyUI's own default), RACCOON_PINNED_MEMORY (1 =
# keep pinning, 0 = disable).
#
# NOT in that list any more: --reserve-vram. Its meaning depends on which loader
# is running, and the tier was measured against the other one — reserve-vram.py's
# DYNAMIC_VRAM_DISABLED has the whole story. It comes back automatically if the
# flag below ever goes away.
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

# The correctness flag, and the one way to turn it off. Decided HERE and not in
# reserve-vram.py on purpose: that call is wrapped in 2>/dev/null, so a torch
# import failure would silently drop the flag and bring the corruption back.
# Reading a plain environment variable cannot fail that way, and anything other
# than exactly "1" leaves the flag on. reserve-vram.py reads the same variable,
# so the reserve tier and this flag can never disagree.
SAFETY_ARGS=()
if [ "$(printf '%s' "${RACCOON_DYNAMIC_VRAM:-}" | tr -d '[:space:]')" = "0" ]; then
  SAFETY_ARGS=(--disable-dynamic-vram)
  echo "[Raccoon Studio] RACCOON_DYNAMIC_VRAM=0 - DynamicVRAM OFF. Krea2 renders correctly; video will run host RAM to ~100%."
else
  echo "[Raccoon Studio] DynamicVRAM ON (video-optimised). Krea2 can render corrupted - set RACCOON_DYNAMIC_VRAM=0 if you need it."
fi

cd "$(dirname "$COMFYUI_MAIN")"
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
# Reproducing it also needs real VRAM pressure — the ONNX face-swap stack
# resident alongside. Minimal graphs never corrupted, which is why the first
# attempt at a repro came up empty.
#
# What it buys, measured on one LTX 2.3 job (RTX 5090 / 64 GB), host RAM at the
# steady state during sampling: 49-51% with DynamicVRAM on, 100% with it off. The
# legacy ModelPatcher keeps a full CPU-side copy of every model it loads, and
# nothing else reaches that — --disable-pinned-memory was tested first and
# changed nothing, and there was never any weight streaming to fix (no log on
# that box has ever contained "loaded partially").
#
# RACCOON_DYNAMIC_VRAM=0 restores the safe mode for anyone who needs Krea2 more
# than video. The real way out is a bf16 Krea2 build, which dodges the corruption
# without costing video anything — untested as of this writing.
exec "$VENV_PYTHON" -s "$COMFYUI_MAIN" --listen 127.0.0.1 --port 8188 \
  --enable-cors-header "*" --preview-method auto \
  "${SAFETY_ARGS[@]}" "${TUNE_ARGS[@]}"
