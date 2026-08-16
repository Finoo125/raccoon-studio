#!/usr/bin/env bash
# Raccoon Studio installer engine. Usage: engine.sh {install|start|stop|update|status} [--dry-run]
set -uo pipefail
ENGINE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
: "${RACCOON_ROOT:="$(cd "$ENGINE_DIR/.." && pwd)"}"
: "${HEALTH_URL:=http://localhost:3000}"
source "$ENGINE_DIR/lib.sh"

COMFY_PY="$RACCOON_ROOT/comfyui/ComfyUI/.venv/bin/python"
APP_MODULES="$RACCOON_ROOT/app/node_modules"
# Overridable so the tests can point at a local repo instead of GitHub. Never set
# in a real install.
: "${PUBLIC_REPO:=https://github.com/Finoo125/raccoon-studio.git}"

is_installed() { [ -x "$COMFY_PY" ] && [ -d "$APP_MODULES" ]; }
is_running()   { curl -s --max-time 2 "$HEALTH_URL" >/dev/null 2>&1; }

cmd_status() {
  if is_running; then echo running
  elif is_installed; then echo stopped
  else echo not-installed; fi
}

cmd_check_update() {
  # One cheap network call, no fetch: is local HEAD the commit the public release
  # repo is on? Prints up-to-date | update-available | unknown — 'unknown' on any
  # git/network failure, so the launcher stays neutral instead of inventing an
  # answer. ponytail: a dev clone has its own history, so it always reads
  # update-available.
  [ "$DRY_RUN" = 1 ] && { echo unknown; return 0; }
  local local_sha remote_sha
  # timeout + no terminal prompt: an unreachable repo must fail fast, never hang
  # the launcher on a TCP wait or a credential prompt.
  local_sha="$(git -C "$RACCOON_ROOT" rev-parse HEAD 2>/dev/null)" || { echo unknown; return 0; }
  remote_sha="$(GIT_TERMINAL_PROMPT=0 timeout 8 git ls-remote "$PUBLIC_REPO" main 2>/dev/null | head -1 | cut -f1)" || true
  if [ -z "$local_sha" ] || [ -z "$remote_sha" ]; then
    _log "[check-update] could not compare with the public repo"; echo unknown; return 0
  fi
  [ "$local_sha" = "$remote_sha" ] && echo up-to-date || echo update-available
}

cmd_start() {
  emit_progress 1 3 "Starting ComfyUI"
  if [ "$DRY_RUN" = 1 ]; then emit_progress 2 3 "[dry-run] would start web app"; emit_progress 3 3 "[dry-run] ready"; emit_done start; return 0; fi
  mkdir -p "$LOG_DIR"
  # The launcher is generated and gitignored, so a `git pull` update leaves an
  # old copy in place. Rebuild the stub when it predates the current shape —
  # cheap, and it means launch-flag changes reach manually-pulled installs.
  if start_script_stale "$RACCOON_ROOT/start-comfyui.sh"; then
    _log "[start] launcher stub outdated - regenerating"
    write_start_comfyui_stub "$RACCOON_ROOT/start-comfyui.sh"
  fi
  nohup "$RACCOON_ROOT/start-comfyui.sh" >"$LOG_DIR/comfyui.log" 2>&1 &
  emit_progress 2 3 "Starting web app"
  nohup bash -c 'cd "$1/app" && npm run dev' _ "$RACCOON_ROOT" >"$LOG_DIR/app.log" 2>&1 &
  local tries=0; until is_running; do sleep 1; tries=$((tries+1)); [ "$tries" -ge 60 ] && break; done
  if ! is_running; then emit_fail start "Services did not become healthy after 60s — check $LOG_DIR/comfyui.log and $LOG_DIR/app.log"; return 1; fi
  emit_progress 3 3 "Ready at $HEALTH_URL"; emit_done start
}

cmd_stop() {
  emit_progress 1 1 "Stopping services"
  [ "$DRY_RUN" = 1 ] || bash "$RACCOON_ROOT/stop.sh" >>"$LOG_FILE" 2>&1 || true
  emit_done stop
}

cmd_update() {
  # Pull the public release repo explicitly (not whatever origin points at), then
  # re-run the idempotent installer if new code arrived so deps/vendor nodes stay
  # in sync. --ff-only makes a pull against any non-release clone fail safely.
  emit_progress 1 3 "Checking the public repo for updates"
  if [ "$DRY_RUN" = 1 ]; then emit_progress 2 3 "[dry-run] would git pull"; emit_progress 3 3 "[dry-run] up to date"; emit_done update; return 0; fi
  local before after
  before="$(git -C "$RACCOON_ROOT" rev-parse HEAD 2>/dev/null)"
  # app/package-lock.json is tracked, but `npm install` rewrites it whenever it
  # disagrees with package.json — so it is dirty in installs that never touched a
  # file (v1.0.18-34 shipped `engines` in package.json alone, and every install of
  # those wrote it back into the lock). Any release that also changes the lock then
  # aborts the pull with "your local changes would be overwritten by merge" and the
  # Update button is dead for good. Discard ours: it is generated, and the
  # cmd_install below regenerates it minutes later. Guarded by the sync test in
  # app/src/lib/package-lock.test.ts, which stops the desync recurring.
  git -C "$RACCOON_ROOT" checkout -- app/package-lock.json >>"$LOG_FILE" 2>&1
  if ! git -C "$RACCOON_ROOT" pull --ff-only "$PUBLIC_REPO" main >>"$LOG_FILE" 2>&1; then
    emit_fail update "git pull from the public repo failed — see $LOG_FILE"; return 1
  fi
  after="$(git -C "$RACCOON_ROOT" rev-parse HEAD 2>/dev/null)"
  # Linux has no .installed-rev marker (it is written by install-windows.ps1 only),
  # so this can only ask whether *this* pull moved HEAD. Weaker than the Windows
  # check: a hand-run `git pull` between updates leaves the install half-applied,
  # with new code on disk and old vendored packs. Accepted for now — the upgrade
  # script re-runs the installer unconditionally and is the way out of that state.
  if [ "$before" = "$after" ]; then
    emit_progress 3 3 "Already up to date"; emit_done update; return 0
  fi
  emit_progress 2 3 "Update downloaded — applying (this can take a few minutes)"
  cmd_install
}

cmd_install() {
  # Always pass an explicit ControlNet flag: the engine runs headless (GUI),
  # so the installer must never fall through to its interactive prompt.
  local cn_flag="--skip-controlnet"
  [ "$WITH_CONTROLNET" = 1 ] && cn_flag="--with-controlnet"
  # Keep the acceleration stack stable across updates. An explicit --gpu wins;
  # otherwise inherit whatever the existing venv was built with, because plain
  # `update` would otherwise reinstall CUDA wheels over a working ROCm venv.
  local gpu_flag="" gpu_arg="${GPU_REQUEST:-}"
  if [ -z "$gpu_arg" ] && [ "$(installed_gpu_vendor)" = amd ]; then
    gpu_arg=amd; _log "[install] preserving existing AMD/ROCm stack"
  fi
  [ -n "$gpu_arg" ] && gpu_flag="--gpu=$gpu_arg"
  RS_FROM_ENGINE=1 RACCOON_ROOT="$RACCOON_ROOT" LOG_FILE="$LOG_FILE" DRY_RUN="$DRY_RUN" \
    bash "$RACCOON_ROOT/install-linux.sh" ${DRY_RUN:+--dry-run} "$cn_flag" ${gpu_flag:+"$gpu_flag"} \
    || { emit_fail install "see $LOG_FILE"; return 1; }
  emit_done install
}

# SageAttention is Windows-only for now — see the block in lib.sh for why there
# is nothing to install here. The verbs exist anyway so both engines answer the
# same questions: a launcher asking sage-status gets a straight answer instead of
# a usage error, and the day a Linux wheel is pinned, only lib.sh changes.
cmd_sage_status() { if sage_installed; then echo installed; else echo not-installed; fi; }
cmd_install_sage() {
  emit_warn "SageAttention is not available on Linux yet — see installer/lib.sh"
  emit_done install-sage
}

main() {
  local verb="${1:-}"; shift || true
  WITH_CONTROLNET=0; GPU_REQUEST=""
  for a in "$@"; do case "$a" in
    --dry-run)         DRY_RUN=1 ;;
    --with-controlnet) WITH_CONTROLNET=1 ;;
    # Accepted and ignored: the Windows engine passes it, and a shared launcher
    # or script must not fail here just because this platform cannot act on it.
    --with-sage-attention) ;;
    --gpu=*)           GPU_REQUEST="${a#*=}" ;;
  esac; done
  case "$verb" in
    status)       cmd_status ;;
    check-update) cmd_check_update ;;
    sage-status)  cmd_sage_status ;;
    start)        cmd_start ;;
    stop)         cmd_stop ;;
    update)       cmd_update ;;
    install)      cmd_install ;;
    install-sage) cmd_install_sage ;;
    *) echo "usage: engine.sh {install|install-sage|start|stop|update|status|check-update|sage-status} [--dry-run]" >&2; return 2 ;;
  esac
}
main "$@"
