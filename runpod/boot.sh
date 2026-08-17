#!/bin/sh
# Raccoon Studio — RunPod boot script for the thin template.
#
# The template carries no image of ours. It runs a stock `ubuntu:24.04` and one
# curl of this file; ComfyUI, PyTorch, the pinned node packs, the default models
# and the app are all installed on the pod itself, onto the volume, at
# datacenter bandwidth.
#
# ponytail: no image means no registry, no 18 GB push on every change, and
# shipping a fix is a git push. What it costs is a slower first boot — timed in
# the header of the log this writes, so the trade is visible rather than
# assumed. Later boots keep the volume and only replay what lives on the
# container's own ephemeral filesystem: apt packages and Node.
#
# Everything here leans on install-linux.sh being idempotent, which it already
# is for the desktop Repair button — every step checks for what it would create.
set -u

REPO="${RACCOON_REPO:-https://github.com/Finoo125/raccoon-studio}"
BRANCH="${RACCOON_BRANCH:-main}"
WORKSPACE="${RACCOON_WORKSPACE:-/workspace}"

# ── Optional model groups ─────────────────────────────────────────────────────
# One env var per group in the RunPod deploy form, "no" unless the user says
# otherwise. They are fetched below, after install-linux.sh has built the models
# tree and before the studio (and therefore ComfyUI) starts, so a group is
# already installed at the first login instead of needing a trip to the Models
# page. Every file is skipped when it is already on the volume, which is what
# makes leaving these on "yes" free on every later boot.
#
# ponytail: a flat table rather than reading the app's own catalog. That catalog
# is a `use client` TSX module, so reaching it from sh would mean a build step on
# the pod for a few dozen URLs. installer/tests/test_boot.sh cross-checks every
# URL here against the catalog instead, so this copy cannot drift in silence.
MODEL_GROUPS='krea2-turbo krea2-raw z-image-turbo anima anima-turbo ernie-turbo
sdxl pony illustrious ltx-video minimax-h3'

# Shared across both Krea2 presets and both Anima ones — listed once, and every
# file is skipped if present, so asking for both costs one checkpoint extra.
# The four Krea2 filenames are KREA2_REFUSAL_LORA / KREA2_PROJECTOR_LORA in
# app/src/lib/workflows/krea2.ts: the builder asks ComfyUI for exactly these
# names, so a rename here is a silent generation failure.
_krea2_shared() { cat <<'EOF'
text_encoders|qwen3vl_4b_fp8_scaled.safetensors|https://huggingface.co/Comfy-Org/Krea-2/resolve/main/text_encoders/qwen3vl_4b_fp8_scaled.safetensors
vae|qwen_image_vae.safetensors|https://huggingface.co/Comfy-Org/Krea-2/resolve/main/vae/qwen_image_vae.safetensors
loras|Krea2_TextFusion_Refusal_Reduction.safetensors|https://huggingface.co/Kutches/Kr3a/resolve/main/Krea2_TextFusion_Refusal_Reduction.safetensors
loras|krea2_projector_scale.safetensors|https://huggingface.co/Beinsezii/Krea-2-Turbo-Projector-Scale-LoRA-Diffusers/resolve/main/pytorch_lora_weights.safetensors
EOF
}
_anima_shared() { cat <<'EOF'
text_encoders|qwen_3_06b_base.safetensors|https://huggingface.co/circlestone-labs/Anima/resolve/main/split_files/text_encoders/qwen_3_06b_base.safetensors
vae|qwen_image_vae.safetensors|https://huggingface.co/circlestone-labs/Anima/resolve/main/split_files/vae/qwen_image_vae.safetensors
EOF
}
# The fp16-fix VAE every SDXL-family checkpoint decodes through (SDXL_FIX_VAE in
# lib/workflows/sdxl.ts) — without it the colours come out washed out.
_sdxl_vae() {
  echo 'vae|sdxl_vae.safetensors|https://huggingface.co/madebyollin/sdxl-vae-fp16-fix/resolve/main/sdxl.vae.safetensors'
}

# folder|filename|url, one per line. The filename is what ComfyUI's loader nodes
# expect and is not always the source file's own name — the rename happens on
# the way in, exactly as the Models page's download route does it.
group_files() {
  case "$1" in
    krea2-turbo)
      echo 'diffusion_models|krea2_turbo_fp8_scaled.safetensors|https://huggingface.co/Comfy-Org/Krea-2/resolve/main/diffusion_models/krea2_turbo_fp8_scaled.safetensors'
      _krea2_shared ;;
    krea2-raw)
      echo 'diffusion_models|krea2_raw_fp8_scaled.safetensors|https://huggingface.co/Comfy-Org/Krea-2/resolve/main/diffusion_models/krea2_raw_fp8_scaled.safetensors'
      _krea2_shared ;;
    z-image-turbo) cat <<'EOF'
diffusion_models|z_image_turbo_bf16.safetensors|https://huggingface.co/Comfy-Org/z_image_turbo/resolve/main/split_files/diffusion_models/z_image_turbo_bf16.safetensors
text_encoders|qwen_3_4b.safetensors|https://huggingface.co/Comfy-Org/z_image_turbo/resolve/main/split_files/text_encoders/qwen_3_4b.safetensors
vae|ae.safetensors|https://huggingface.co/Comfy-Org/z_image_turbo/resolve/main/split_files/vae/ae.safetensors
EOF
      ;;
    anima)
      echo 'diffusion_models|anima-aesthetic-v1.1.safetensors|https://huggingface.co/circlestone-labs/Anima/resolve/main/split_files/diffusion_models/anima-aesthetic-v1.1.safetensors'
      _anima_shared ;;
    anima-turbo)
      echo 'diffusion_models|anima-turbo-v1.0.safetensors|https://huggingface.co/circlestone-labs/Anima/resolve/main/split_files/diffusion_models/anima-turbo-v1.0.safetensors'
      _anima_shared ;;
    ernie-turbo) cat <<'EOF'
diffusion_models|ernie-image-turbo.safetensors|https://huggingface.co/Comfy-Org/ERNIE-Image/resolve/main/diffusion_models/ernie-image-turbo.safetensors
text_encoders|ministral-3-3b.safetensors|https://huggingface.co/Comfy-Org/ERNIE-Image/resolve/main/text_encoders/ministral-3-3b.safetensors
text_encoders|ernie-image-prompt-enhancer.safetensors|https://huggingface.co/Comfy-Org/ERNIE-Image/resolve/main/text_encoders/ernie-image-prompt-enhancer.safetensors
vae|flux2-vae.safetensors|https://huggingface.co/Comfy-Org/ERNIE-Image/resolve/main/vae/flux2-vae.safetensors
EOF
      ;;
    sdxl)
      echo 'checkpoints|sd_xl_base_1.0.safetensors|https://huggingface.co/stabilityai/stable-diffusion-xl-base-1.0/resolve/main/sd_xl_base_1.0.safetensors'
      _sdxl_vae ;;
    pony)
      echo 'checkpoints|ponyDiffusionV6XL_v6StartWithThisOne.safetensors|https://huggingface.co/LyliaEngine/Pony_Diffusion_V6_XL/resolve/main/ponyDiffusionV6XL_v6StartWithThisOne.safetensors'
      _sdxl_vae ;;
    illustrious)
      echo 'checkpoints|Illustrious-XL-v0.1.safetensors|https://huggingface.co/OnomaAIResearch/Illustrious-xl-early-release-v0/resolve/main/Illustrious-XL-v0.1.safetensors'
      _sdxl_vae ;;
    # Video: what a render actually needs, plus the small extras the form turns
    # on by default when present. Deliberately NOT the multi-GB one-mode extras
    # (LTX FaceID and the IC-LoRAs; H3's 21 GB ref2v checkpoint and its LoRA) —
    # those stay a deliberate click on the Models page rather than 25 GB nobody
    # asked for. The gated/manual-import entries in the catalog cannot be
    # fetched unattended at all.
    ltx-video) cat <<'EOF'
checkpoints|ltx2310eros1.4.safetensors|https://huggingface.co/TenStrip/LTX2.3-10Eros/resolve/main/10Eros_v1.4_fp8mixed_learned.safetensors
text_encoders|gemma-3-12b-it-ablit-norms-biproj-fp8mixed.safetensors|https://huggingface.co/TenStrip/LTX2.3-10Eros/resolve/main/text_encoders/gemma-3-12b-it-ablit-norms-biproj-fp8mixed.safetensors
loras|LTX2.3_DMD_reshaped_r256.safetensors|https://huggingface.co/TenStrip/LTX2.3_DMD_Lora/resolve/main/LTX2.3_DMD_reshaped_r256.safetensors
loras|VBVR-I2V-390K-R32.safetensors|https://huggingface.co/LiconStudio/Ltx2.3-VBVR-lora-I2V/resolve/main/Ltx2.3-Licon-VBVR-I2V-390K-R32.safetensors
latent_upscale_models|ltx-2.3-spatial-upscaler-x2-1.1.safetensors|https://huggingface.co/Lightricks/LTX-2.3/resolve/main/ltx-2.3-spatial-upscaler-x2-1.1.safetensors
vae|taeltx2_3.safetensors|https://huggingface.co/DouraVITA/ltx-ugc-bundle/resolve/main/vae/taeltx2_3.safetensors
EOF
      ;;
    minimax-h3) cat <<'EOF'
diffusion_models|minimax_h3_fl2va_pruned_int8_convrot.safetensors|https://huggingface.co/Comfy-Org/MiniMax-H3/resolve/main/diffusion_models/minimax_h3_fl2va_pruned_int8_convrot.safetensors
text_encoders|qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors|https://huggingface.co/Comfy-Org/MiniMax-H3/resolve/main/text_encoders/qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors
vae|minimax_h3_video_vae_fp16.safetensors|https://huggingface.co/Comfy-Org/MiniMax-H3/resolve/main/vae/minimax_h3_video_vae_fp16.safetensors
vae|minimax_h3_audio_vae_fp32.safetensors|https://huggingface.co/Comfy-Org/MiniMax-H3/resolve/main/vae/minimax_h3_audio_vae_fp32.safetensors
loras|minimax_h3_turbo_4step_ckpt500_pruned_comfyui.safetensors|https://huggingface.co/drbaph/MiniMax-H3-Turbo-Lora-ComfyUI/resolve/main/minimax_h3_turbo_4step_ckpt500_pruned_comfyui.safetensors
loras|minimax_h3_fl2v_turbo_8step_v1.0_comfyui_resized_avg_rank_21_bf16.safetensors|https://huggingface.co/drbaph/MiniMax-H3-Turbo-Lora-ComfyUI/resolve/main/minimax_h3_fl2v_turbo_8step_v1.0_comfyui_resized_avg_rank_21_bf16.safetensors
loras|h3-realism-people-t2v-i2v-r2v.safetensors|https://huggingface.co/fal/MiniMax-H3-Realism-People-LoRA/resolve/main/h3-realism-people-t2v-i2v-r2v.safetensors
EOF
      ;;
  esac
}

# `krea2-turbo` -> `DOWNLOAD_KREA2_TURBO`. The trailing `-` in the first set and
# `_` in the second are literal, so the id's dashes become underscores.
group_var() { printf 'DOWNLOAD_%s' "$(printf '%s' "$1" | tr 'a-z-' 'A-Z_')"; }

# Anything but an explicit yes is a no — a typo must not spend an hour of GPU
# time on a 42 GB download.
group_wanted() {
  eval "_v=\${$(group_var "$1"):-no}"
  case "$(printf '%s' "$_v" | tr 'A-Z' 'a-z')" in
    y|yes|1|true|on) return 0 ;;
    *) return 1 ;;
  esac
}
# ── end model group table ── (installer/tests/test_boot.sh sources exactly this
# block, from MODEL_GROUPS to here, to test the table without running an install)

# No volume means nothing survives a stop, including a 20-minute install. Say so
# loudly and keep going on the container disk — the entrypoint repeats the
# warning for the app's own paths.
NO_VOLUME=
if [ ! -d "$WORKSPACE" ]; then
  NO_VOLUME=1
  WORKSPACE=/opt/raccoon-workspace
fi

ROOT="${RACCOON_ROOT:-$WORKSPACE/raccoon}"
LOGS="$WORKSPACE/logs"
BOOTLOG="$LOGS/boot.log"
STAMP="$ROOT/.rs-installed"
OK="$LOGS/.boot-ok"
mkdir -p "$LOGS"
# One log per boot. Appending would leave the previous boot's "ready" line at the
# top of the file, which the progress page below reads as "already finished" the
# moment it loads — on every restart, before anything has started.
[ -f "$BOOTLOG" ] && mv -f "$BOOTLOG" "$LOGS/boot.previous.log"

# Caches on the volume as well, so a version bump re-uses the wheel and npm
# caches instead of pulling 2.5 GB of torch down a second time.
export UV_CACHE_DIR="$WORKSPACE/.cache/uv" \
       XDG_CACHE_HOME="$WORKSPACE/.cache" \
       HF_HOME="$WORKSPACE/.cache/hf" \
       npm_config_cache="$WORKSPACE/.cache/npm"
mkdir -p "$WORKSPACE/.cache"

say() { printf '[boot] %s\n' "$*"; }

# Fetch every file of every group the deploy form asked for. Writes into
# ComfyUI's own models tree, which is either a real directory the entrypoint has
# not linked to the volume yet (first boot) or already a symlink onto it (every
# boot after) — both land on the volume, so nothing is re-downloaded.
#
# Non-fatal throughout: a dead mirror must cost one model, not the whole studio.
download_groups() {
  _want=
  for _g in $MODEL_GROUPS; do group_wanted "$_g" && _want="$_want $_g"; done
  [ -n "$_want" ] || return 0

  # Deduplicated across groups: Krea2 Turbo and RAW share four files, the three
  # SDXL-family checkpoints share a VAE. Without this the second group would
  # re-check them one by one for nothing.
  _rows=$(for _g in $_want; do group_files "$_g"; done | sort -u)
  _n=$(printf '%s\n' "$_rows" | wc -l | tr -d ' ')
  say "Model groups:$_want ($_n files)"

  _i=0
  printf '%s\n' "$_rows" | while IFS='|' read -r _folder _name _url; do
    [ -n "$_url" ] || continue
    _i=$((_i + 1))
    _dir="$ROOT/comfyui/ComfyUI/models/$_folder"
    mkdir -p "$_dir"
    if [ -f "$_dir/$_name" ]; then
      say "have $_name"
      continue
    fi
    # ponytail: no live byte counter — curl's own meter is \r-based and would
    # turn the log (and the progress page that tails it) into one endless line.
    # A PROGRESS line per file is what install-linux.sh's own model step does,
    # and it is enough to tell a slow route from a hung one, because the file
    # count advances. The stall guard below is what catches a genuinely dead
    # socket: --retry alone never fires on one that connects and sends nothing.
    printf 'PROGRESS|%s|%s|%s|Downloading %s\n' "$_i" "$_n" "$((_i * 100 / _n))" "$_name"
    _t=$(date +%s)
    if curl -fL --retry 3 --retry-delay 3 --connect-timeout 30 \
         --speed-limit 2048 --speed-time 60 -sS \
         -o "$_dir/$_name.tmp" "$_url"; then
      mv -f "$_dir/$_name.tmp" "$_dir/$_name"
      say "got $_name ($(du -h "$_dir/$_name" 2>/dev/null | cut -f1)) in $(( $(date +%s) - _t ))s"
    else
      rm -f "$_dir/$_name.tmp"
      say "WARNING: $_name failed to download — get it from the Models page instead"
    fi
  done
}

# ── Minimal dependencies ──────────────────────────────────────────────────────
# Bare ubuntu has none of these. The template's start command installs them too
# (it needs curl to fetch this file at all) — a second apt-get costs a couple of
# seconds and keeps this script runnable on its own. install-linux.sh installs
# everything else, and re-installs it on every boot, because / is reset from the
# image each time while only the volume persists.
{
  say 'Installing git, curl and python3'
  apt-get update >/dev/null 2>&1
  apt-get install -y --no-install-recommends git curl ca-certificates python3 >/dev/null 2>&1 \
    || say 'WARNING: apt-get failed — carrying on in case the image already has them'
} 2>&1 | tee -a "$BOOTLOG"

# ── The progress page ─────────────────────────────────────────────────────────
# The first boot is minutes long and the pod URL is all the user has. Without
# something on 8080 they get a 502 and no way to tell "installing" from "broken".
# python3's http.server is already a dependency of the install below.
cat > "$LOGS/index.html" <<'HTML'
<!doctype html><meta charset=utf-8><title>Raccoon Studio — installing</title>
<style>body{background:#111;color:#eee;font:13px/1.5 ui-monospace,monospace;margin:2rem}
h1{font-size:15px;color:#ffa64d}pre{white-space:pre-wrap;word-break:break-word}
#bar{background:#333;height:6px;border-radius:3px;overflow:hidden;margin:.6rem 0}
#fill{background:#ffa64d;height:100%;width:0;transition:width .4s}</style>
<h1 id=h>Installing Raccoon Studio…</h1><div id=bar><div id=fill></div></div>
<p id=s style=color:#888>First boot installs ComfyUI, PyTorch and the default
models onto the volume. Later boots skip nearly all of it. This page refreshes
itself; the pod is ready when it turns into a login form.</p><pre id=l></pre>
<script>setInterval(async()=>{const t=await(await fetch('boot.log?'+Date.now())).text()
const p=[...t.matchAll(/^PROGRESS\|(\d+)\|(\d+)\|(\d+)\|(.*)$/gm)].pop()
if(p){h.textContent=`Installing Raccoon Studio — step ${p[1]}/${p[2]}: ${p[4]}`;fill.style.width=p[3]+'%'}
// Two ways to learn the studio has taken the port: the marker, or this fetch
// coming back as the login page's HTML because the proxy is answering now.
if(/RACCOON BOOT: ready/.test(t)||/^\s*</.test(t))location.reload()
l.textContent=t.split('\n').slice(-80).join('\n');scrollTo(0,9e9)},2000)</script>
HTML
python3 -m http.server 8080 --bind 0.0.0.0 --directory "$LOGS" >/dev/null 2>&1 &
PROGRESS_PID=$!

# ── Install ───────────────────────────────────────────────────────────────────
install_all() {
  T0=$(date +%s)
  say "start $(date -u '+%Y-%m-%d %H:%M:%SZ')"
  [ -n "$NO_VOLUME" ] && say 'WARNING: no volume mounted — everything here is lost when the pod stops'
  nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv,noheader 2>/dev/null \
    || say 'WARNING: no nvidia-smi — this pod has no GPU'

  if [ -d "$ROOT/.git" ]; then
    say "Reusing the existing checkout at $ROOT"
  else
    say "Cloning $REPO ($BRANCH)"
    git clone --depth=1 --branch "$BRANCH" "$REPO" "$ROOT" || return 1
  fi
  say "clone done at +$(( $(date +%s) - T0 ))s"

  cd "$ROOT" || return 1
  # RS_FROM_ENGINE: no TTY here, so skip the "relaunch me in a terminal" block.
  # --gpu=nvidia: nvidia-smi exists on the pod, but pinning it keeps a CPU pod
  # from silently installing the CPU stack onto a volume a GPU pod will reuse.
  # --skip-controlnet: ~9 GB the Models page fetches on demand, matching the
  # desktop installer's own opt-in default. DOWNLOAD_CONTROLNET=yes opts back in
  # through the installer's own step rather than a second copy of those URLs.
  CN_FLAG=--skip-controlnet
  group_wanted controlnet && CN_FLAG=--with-controlnet
  RS_FROM_ENGINE=1 bash install-linux.sh --gpu=nvidia "$CN_FLAG" || return 1
  say "install-linux.sh done at +$(( $(date +%s) - T0 ))s"

  download_groups
  say "model groups done at +$(( $(date +%s) - T0 ))s"

  # The installer never builds — desktop installs run `next dev`. A rented GPU
  # over a WAN deserves the production build, so do it here, onto the volume.
  # Best-effort: the entrypoint falls back to dev mode if it fails.
  #
  # ponytail: unconditionally, every boot. Measured at 25 s of a 90 s restart on
  # pod hardware — not worth a build cache keyed on the commit, whose failure
  # mode is serving yesterday's app forever after an in-app Update, silently.
  #
  # RACCOON_KIOSK has to be set for the BUILD, not just for the run: statically
  # rendered routes read process.env at build time, so a flag exported only by
  # the entrypoint would come out false in exactly the pages that need it. The
  # entrypoint exports it too, for the route handlers, which are dynamic.
  say 'Building the app (next build)'
  ( cd "$ROOT/app" && RACCOON_KIOSK=1 npm run build ) || say 'WARNING: next build failed — the app will run in dev mode'
  say "build done at +$(( $(date +%s) - T0 ))s"

  # df, not du: du over a 16 GB tree of ~100k files is a minute of dead time on
  # every boot, and free space is the number that actually matters to a user
  # about to download a 42 GB model set.
  df -h "$WORKSPACE" 2>/dev/null | tail -2
  date -u '+%Y-%m-%dT%H:%M:%SZ' > "$STAMP"
  : > "$OK"
  say "RACCOON BOOT: install complete in $(( $(date +%s) - T0 ))s"
}

if [ -f "$STAMP" ]; then
  say "Already installed on $(cat "$STAMP") — checking it over"
fi
# $OK is written by THIS run, and $STAMP records that some run once finished.
# They have to be separate: install-linux.sh runs again on every boot (the
# container's own filesystem is reset each time, so apt and Node are gone), and
# a boot where that fails has no Node — `next start` cannot run, the proxy would
# front nothing, and keying the handoff on $STAMP would hide that behind a login
# page that never loads. A pipeline's exit status is tee's, and POSIX sh has no
# pipefail, so the marker is a file rather than `$?`.
rm -f "$OK"
install_all 2>&1 | tee -a "$BOOTLOG"

# ── Hand off ──────────────────────────────────────────────────────────────────
# A failed install must not look like a dead pod: keep the log on 8080 instead
# of handing 8080 to a proxy that has nothing behind it.
if [ ! -f "$OK" ]; then
  say 'RACCOON BOOT: install FAILED — serving the log on port 8080' | tee -a "$BOOTLOG"
  wait "$PROGRESS_PID"
  exit 1
fi

say 'RACCOON BOOT: ready — starting the studio' | tee -a "$BOOTLOG"
kill "$PROGRESS_PID" 2>/dev/null
wait "$PROGRESS_PID" 2>/dev/null
export RACCOON_ROOT="$ROOT" RACCOON_WORKSPACE="$WORKSPACE"
exec bash "$ROOT/runpod/entrypoint.sh"
