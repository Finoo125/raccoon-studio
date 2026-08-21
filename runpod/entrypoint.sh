#!/usr/bin/env bash
# Raccoon Studio — RunPod container entrypoint.
#
# Wires every mutable path onto the volume, starts ComfyUI and Next on loopback,
# and hands the foreground to the proxy — the only published port.
set -uo pipefail

ROOT="${RACCOON_ROOT:-/workspace/raccoon}"
WORKSPACE="${RACCOON_WORKSPACE:-/workspace}"

say() { printf '[entrypoint] %s\n' "$*"; }

# ── Volume ────────────────────────────────────────────────────────────────────
# Silently discarding a user's gallery is the worst failure mode available here,
# so an absent volume is loud rather than convenient.
if [ ! -d "$WORKSPACE" ]; then
  say ''
  say '  ############################################################'
  say "  #  NO VOLUME AT $WORKSPACE"
  say '  #  Falling back to container-local storage.'
  say '  #  EVERYTHING YOU GENERATE IS LOST WHEN THE POD STOPS.'
  say '  ############################################################'
  say ''
  WORKSPACE="$ROOT/local-workspace"
fi

mkdir -p "$WORKSPACE"/{models,output,input,data,sidecars,director,logs,tmp}

# ── Wire ComfyUI's tree onto the volume ───────────────────────────────────────
# Symlinks rather than --output-directory/--input-directory flags: ComfyUI
# resolves these relative to its own directory and follows links transparently,
# so installer/start-comfyui-core.sh (the tracked launcher, shared with the
# desktop installs) needs no container-specific arguments.
COMFY_DIR="$ROOT/comfyui/ComfyUI"
for d in models output input; do
  if [ ! -L "$COMFY_DIR/$d" ]; then
    # Never plain `rm -rf` here. On the thin template the installer has just
    # downloaded several GB into this exact directory, and $ROOT is itself on
    # the volume — deleting it would throw away the whole install's model set
    # and the symlink would point at an empty tree. Hardlink them across first
    # (instant and free on one filesystem), copy if that is refused (the fat
    # image has $ROOT and $WORKSPACE on different mounts).
    if [ -d "$COMFY_DIR/$d" ]; then
      cp -rln "$COMFY_DIR/$d/." "$WORKSPACE/$d/" 2>/dev/null \
        || cp -rn "$COMFY_DIR/$d/." "$WORKSPACE/$d/" 2>/dev/null || true
      rm -rf "$COMFY_DIR/$d"
    fi
    ln -s "$WORKSPACE/$d" "$COMFY_DIR/$d"
  fi
done

# ── App environment ───────────────────────────────────────────────────────────
export COMFYUI_BASE_URL="http://127.0.0.1:8188"
export COMFYUI_DIR="$COMFY_DIR"
export COMFYUI_MODELS_DIR="$WORKSPACE/models"
export COMFYUI_OUTPUT_DIR="$WORKSPACE/output"
export COMFYUI_START_SCRIPT="$ROOT/installer/start-comfyui-core.sh"
export RACCOON_DATA_DIR="$WORKSPACE/data"
export RACCOON_SIDECAR_DIR="$WORKSPACE/sidecars"
export RACCOON_LOGS_DIR="$WORKSPACE/logs"
export RACCOON_GALLERY_CACHE="$WORKSPACE/data/gallery-cache.json"
export RACCOON_ENTITLEMENTS_FILE="$WORKSPACE/entitlements.json"
export DIRECTOR_PROJECTS_DIR="$WORKSPACE/director"
# ponytail: nothing in the app reads RACCOON_KIOSK yet. It stays because the
# hosted pod does need it eventually — "open containing folder", the desktop
# Repair/Update buttons and the ComfyUI stop control are all meaningless (or
# harmful) on a rented box — and setting it here means only the app side is
# missing when that lands. Do not treat a pod as already hardened against them.
export RACCOON_KIOSK=1
export PYTORCH_CUDA_ALLOC_CONF="${PYTORCH_CUDA_ALLOC_CONF:-expandable_segments:True}"
# DynamicVRAM OFF on a pod, unless the deployer says otherwise.
#
# ComfyUI's DynamicVRAM kills the whole process here the moment it stages a
# large model — no traceback, no OOM, the log simply stops mid-line. Measured
# 2026-08-21 on an A40 48 GB, same graph each way:
#
#   model                     staged     ON            OFF
#   MiniMax H3 text encoder   14956 MB   process died  renders (1.51 MB, 410 s)
#   Z-Image Turbo (Lumina2)   11738 MB   process died  renders (2422 KB)
#   SDXL / Anima / Krea2      <= 4896 MB renders       renders
#
# So with the shipped default, ALL MiniMax H3 video and Z-Image are dead on this
# template, and they fail in the worst possible way: the app cannot restart
# ComfyUI afterwards, so one render bricks the pod until it is restarted.
#
# The cost is real and known — the legacy loader keeps a full CPU-side copy of
# every model, which is exactly why the desktop default is ON (a 64 GB box hit
# 100% host RAM during video). A pod is a different machine: this one has 50 GB
# for the container and sat at ~90% (much of it reclaimable page cache) while
# rendering H3 to completion. Losing two model families is worse than being
# tight on RAM.
#
# Desktop installs are untouched: they never source this file. Not tiered in
# reserve-vram.py either, because only this hardware has been measured — a 5090
# renders H3 with DynamicVRAM ON. Set RACCOON_DYNAMIC_VRAM=1 in the deploy form
# to get the old behaviour back.
export RACCOON_DYNAMIC_VRAM="${RACCOON_DYNAMIC_VRAM:-0}"
# Pinned memory OFF on a pod too, and this one is not covered by the RAM tier.
#
# ComfyUI pins up to 40% of RAM, and pinned pages are NON-RECLAIMABLE — the OS
# can never take them back under pressure. In a container that is fatal: memory
# climbs across renders until the cgroup kills ComfyUI, which looks exactly like
# the DynamicVRAM crash above (log stops, no traceback, no OOM message).
#
# Measured 2026-08-21, same three renders (Krea2 -> H3 -> Krea2) each way on a
# 50 GB container:
#
#   pinning ON   Krea2 died once the H3 + face-swap renders were resident
#   pinning OFF  all three passed; container peaked at 98% and RECOVERED
#                to 57%, because page cache can be reclaimed and pins cannot
#
# reserve-vram.py's tier does NOT cover this even after it learned to read the
# cgroup ceiling (af2b1a0): the corrected reading is 50 GiB, which is above the
# 33 GiB threshold, so it would keep pinning. That threshold was calibrated on
# bare metal, where 40% pinned still leaves the box usable — here the same
# container also holds Next, the proxy, and page cache for 240+ GB of models.
# Rather than bend a measured desktop tier around one pod shape, a pod says so
# for itself. RACCOON_PINNED_MEMORY=1 restores the old behaviour.
export RACCOON_PINNED_MEMORY="${RACCOON_PINNED_MEMORY:-0}"

# install-linux.sh writes app/.env.local pointing at container-local paths, and
# in this app .env.local takes precedence over the process environment — so the
# exports above would lose to it for the four keys it manages. The symlinks
# above would mask that, since those paths resolve onto the volume anyway, but
# relying on that is a landmine for whoever changes the symlinks. Rewrite the
# managed keys instead, preserving anything the image or the user added.
ENV_FILE="$ROOT/app/.env.local"
if [ -f "$ENV_FILE" ]; then
  grep -vE '^(COMFYUI_BASE_URL|COMFYUI_OUTPUT_DIR|COMFYUI_MODELS_DIR|COMFYUI_START_SCRIPT)=' \
    "$ENV_FILE" > "$ENV_FILE.keep" 2>/dev/null || : > "$ENV_FILE.keep"
else
  : > "$ENV_FILE.keep"
fi
{
  echo "COMFYUI_BASE_URL=$COMFYUI_BASE_URL"
  echo "COMFYUI_OUTPUT_DIR=$COMFYUI_OUTPUT_DIR"
  echo "COMFYUI_MODELS_DIR=$COMFYUI_MODELS_DIR"
  echo "COMFYUI_START_SCRIPT=$COMFYUI_START_SCRIPT"
  cat "$ENV_FILE.keep"
} > "$ENV_FILE"
rm -f "$ENV_FILE.keep"

# ── GPU ───────────────────────────────────────────────────────────────────────
# The launch flags themselves are NOT decided here: installer/reserve-vram.py
# owns every hardware threshold and start-comfyui-core.sh calls it. This block
# only reports what the pod got, so a mis-sized rental is visible in the log.
if command -v nvidia-smi >/dev/null 2>&1; then
  VRAM="$(nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits 2>/dev/null | head -1 | tr -d ' ')"
  GPUNAME="$(nvidia-smi --query-gpu=name --format=csv,noheader 2>/dev/null | head -1)"
  say "GPU: ${GPUNAME:-unknown} (${VRAM:-?} MiB)"
  if [ -n "${VRAM:-}" ] && [ "$VRAM" -lt 20000 ] 2>/dev/null; then
    say "WARNING: under 20 GB of VRAM. Video generation will need the low-VRAM mode in the UI."
  fi
else
  say 'WARNING: no nvidia-smi — this pod has no GPU. Generation will fail.'
fi
# ponytail: the design called for seeding a low-VRAM video default here, but
# AppSettings has no such field — it is a per-generation form option. Warn only.

# ── Services ──────────────────────────────────────────────────────────────────
# ComfyUI must never inherit a pipe: a broken stdout/stderr pipe crashes it at
# KSampler. Detached, redirected to a file, exactly as the desktop installs do.
say 'Starting ComfyUI on 127.0.0.1:8188'
nohup setsid bash "$ROOT/installer/start-comfyui-core.sh" \
  > "$WORKSPACE/logs/comfyui.log" 2>&1 < /dev/null &

cd "$ROOT/app"
# next start, never next dev — a dev server on a metered GPU is slower and
# wasteful. But the installer deliberately never builds (desktop installs run
# `next dev`), so `next start` only works if boot.sh's build succeeded; without
# a BUILD_ID it exits immediately with "no production build" and the pod serves
# nothing. Fall back rather than fail.
if [ -f .next/BUILD_ID ]; then
  say 'Starting Raccoon Studio on 127.0.0.1:3000 (production build)'
  APP_CMD=(node_modules/.bin/next start -H 127.0.0.1 -p 3000)
else
  say 'Starting Raccoon Studio on 127.0.0.1:3000 (dev mode — no production build found)'
  APP_CMD=(node_modules/.bin/next dev --webpack -H 127.0.0.1 -p 3000)
fi
nohup "${APP_CMD[@]}" > "$WORKSPACE/logs/app.log" 2>&1 < /dev/null &

cd "$ROOT"
say 'Starting proxy on 0.0.0.0:8080'
exec node "$ROOT/runpod/proxy.mjs"
