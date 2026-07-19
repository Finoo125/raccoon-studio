#!/usr/bin/env bash
# Raccoon Studio installer engine. Usage: engine.sh {install|start|stop|update|status} [--dry-run]
set -uo pipefail
ENGINE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
: "${RACCOON_ROOT:="$(cd "$ENGINE_DIR/.." && pwd)"}"
: "${HEALTH_URL:=http://localhost:3000}"
source "$ENGINE_DIR/lib.sh"

COMFY_PY="$RACCOON_ROOT/comfyui/ComfyUI/.venv/bin/python"
APP_MODULES="$RACCOON_ROOT/app/node_modules"

is_installed() { [ -x "$COMFY_PY" ] && [ -d "$APP_MODULES" ]; }
is_running()   { curl -s --max-time 2 "$HEALTH_URL" >/dev/null 2>&1; }

cmd_status() {
  if is_running; then echo running
  elif is_installed; then echo stopped
  else echo not-installed; fi
}

cmd_start() {
  emit_progress 1 3 "Starting ComfyUI"
  if [ "$DRY_RUN" = 1 ]; then emit_progress 2 3 "[dry-run] would start web app"; emit_progress 3 3 "[dry-run] ready"; emit_done start; return 0; fi
  mkdir -p "$LOG_DIR"
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
  # STUB — real git-pull backend (app + ComfyUI + custom nodes) lands later.
  emit_progress 1 2 "Checking for updates"
  if [ "$DRY_RUN" = 1 ]; then emit_progress 2 2 "[dry-run] update stub"; emit_done update; return 0; fi
  emit_progress 2 2 "Up to date"
  emit_warn "Update backend not yet implemented — no changes made."
  emit_done update
}

cmd_install() {
  RS_FROM_ENGINE=1 RACCOON_ROOT="$RACCOON_ROOT" LOG_FILE="$LOG_FILE" DRY_RUN="$DRY_RUN" \
    bash "$RACCOON_ROOT/install-linux.sh" ${DRY_RUN:+--dry-run} \
    || { emit_fail install "see $LOG_FILE"; return 1; }
  emit_done install
}

main() {
  local verb="${1:-}"; shift || true
  for a in "$@"; do [ "$a" = "--dry-run" ] && DRY_RUN=1; done
  case "$verb" in
    status)  cmd_status ;;
    start)   cmd_start ;;
    stop)    cmd_stop ;;
    update)  cmd_update ;;
    install) cmd_install ;;
    *) echo "usage: engine.sh {install|start|stop|update|status} [--dry-run]" >&2; return 2 ;;
  esac
}
main "$@"
