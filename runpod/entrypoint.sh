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
# DynamicVRAM ON by default again (2026-08-22) — except on the one GPU measured
# to die with it.
#
# It was blanket-OFF here from 1.2.6, on the strength of a single A40 pod where
# ComfyUI died the moment DynamicVRAM staged a large model — no traceback, no
# OOM, the log simply stopping mid-line. Same graph each way, 2026-08-21:
#
#   model                     staged     ON            OFF
#   MiniMax H3 text encoder   14956 MB   process died  renders (1.51 MB, 410 s)
#   Z-Image Turbo (Lumina2)   11738 MB   process died  renders (2422 KB)
#   SDXL / Anima / Krea2      <= 4896 MB renders       renders
#
# That generalised one machine to every pod, and it does not hold. Re-tested
# 2026-08-22 on an RTX 4090 23.5 GB, Secure Cloud US-TX-3, DynamicVRAM verified
# ON by reading system_stats.argv rather than trusting the env: Krea2 Turbo,
# Z-Image Turbo and MiniMax H3 all rendered CLEAN — including the exact two that
# killed the A40. Channel spread 28.5 / 30.5 (corruption band is 90-113), H3 a
# 4.458 s clip with stereo audio. Pinned memory was ruled out as the hidden
# variable in the same session: flipping it back ON via podEditJob and re-running
# both killers still rendered clean, so the crash is absent on a 4090 in BOTH
# pinning states. Harness: app/src/lib/workflows/runpod-dynvram.live.test.ts.
#
# So the fault is the A40 (or its host, or Ampere) — not "pods". Turning it off
# for everyone costs real money: the legacy loader keeps a full CPU-side copy of
# every model, which is why the desktop default is ON, and with it off Z-Image
# plus upscale plus detailer OOMs at 41 GB of a 44.4 GB budget on a 48 GB card.
#
# The A40 carve-out stays because that crash was a clean A/B and the A40 is the
# CHEAPEST secure GPU on offer ($0.44/hr), so users will land on it. It is a
# blocklist of exactly what has been measured to fail, not a guess about
# generations — remove the case arm once an A40 renders H3 with this on.
# RACCOON_DYNAMIC_VRAM in the deploy form still overrides in both directions.
# Anchored deliberately: a bare *A40* also matches "NVIDIA RTX A4000", which is
# a different card that has never been measured. Match A40 only at end of
# string, or followed by a space or hyphen (vGPU/MIG profiles read "A40-8Q").
case "$(command -v nvidia-smi >/dev/null 2>&1 && nvidia-smi --query-gpu=name --format=csv,noheader 2>/dev/null | head -1)" in
  *A40|*"A40 "*|*A40-*) RS_DYNVRAM_DEFAULT=0 ;;
  *)                    RS_DYNVRAM_DEFAULT=1 ;;
esac
export RACCOON_DYNAMIC_VRAM="${RACCOON_DYNAMIC_VRAM:-$RS_DYNVRAM_DEFAULT}"
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
