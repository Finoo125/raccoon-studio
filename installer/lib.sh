#!/usr/bin/env bash
# Raccoon Studio installer — shared logging + structured progress helpers.
# Output protocol (one line each): PROGRESS|step|total|pct|msg · WARN|msg · DONE|verb · FAIL|verb|msg
: "${RACCOON_ROOT:="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"}"
: "${DRY_RUN:=0}"
LOG_DIR="$RACCOON_ROOT/logs"
: "${LOG_FILE:="$LOG_DIR/install-$(date +%Y%m%d-%H%M%S).log"}"

_log() { mkdir -p "$(dirname "$LOG_FILE")"; printf '%s %s\n' "$(date +%H:%M:%S)" "$1" >>"$LOG_FILE" 2>/dev/null || true; }

emit_progress() { # step total message
  local pct=$(( $1 * 100 / $2 ))
  printf 'PROGRESS|%s|%s|%s|%s\n' "$1" "$2" "$pct" "$3"
  _log "[STEP $1/$2] $3"
}
emit_warn() { printf 'WARN|%s\n' "$1"; _log "[WARN] $1"; }
emit_done() { printf 'DONE|%s\n' "$1"; _log "[DONE] $1"; }
emit_fail() { printf 'FAIL|%s|%s\n' "$1" "$2"; _log "[FAIL] $1: $2"; }
