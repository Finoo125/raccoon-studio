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
  # desktop installer's own opt-in default.
  RS_FROM_ENGINE=1 bash install-linux.sh --gpu=nvidia --skip-controlnet || return 1
  say "install-linux.sh done at +$(( $(date +%s) - T0 ))s"

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
