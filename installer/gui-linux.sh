#!/usr/bin/env bash
# Raccoon Studio launcher — zenity GUI with TUI fallback.
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
: "${RACCOON_ROOT:="$(cd "$DIR/.." && pwd)"}"
ENG="$DIR/engine.sh"
DRY="${RS_DRY_RUN:+--dry-run}"
status() { RACCOON_ROOT="$RACCOON_ROOT" bash "$ENG" status; }

run_verb() { # verb [extra engine args]  -> stream progress to zenity or stdout
  local verb="$1"; shift
  if [ -z "${RACCOON_STUDIO_TUI:-}" ] && command -v zenity >/dev/null 2>&1; then
    RACCOON_ROOT="$RACCOON_ROOT" bash "$ENG" "$verb" $DRY "$@" 2>&1 | awk -F'|' '
      /^PROGRESS\|/ { print $4; print "# " $5; fflush() }
      /^WARN\|/     { print "# Warning: " $2; fflush() }
      /^DONE\|/     { print 100; print "# Done"; fflush() }
      /^FAIL\|/     { print 100; print "# Error: " $3; fflush() }' \
      | zenity --progress --title="Raccoon Studio — $verb" --auto-close --width=420 2>/dev/null
  else
    RACCOON_ROOT="$RACCOON_ROOT" bash "$ENG" "$verb" $DRY "$@"
  fi
}

ask_cn() { # sets CN_FLAG to --with-controlnet if the user wants the ~9 GB models
  CN_FLAG=""
  if [ -z "${RACCOON_STUDIO_TUI:-}" ] && command -v zenity >/dev/null 2>&1; then
    zenity --question --title="Raccoon Studio" --width=380 2>/dev/null \
      --text="Also download ControlNet + IP-Adapter models (~9 GB)?\n\nOnly the ControlNet / IP-Adapter features need them; you can get them later from the Models page." \
      && CN_FLAG="--with-controlnet"
  else
    printf '  Also download ControlNet + IP-Adapter models (~9 GB)? [y/N]: '
    local yn; read -r yn || yn=
    case "$yn" in y|Y|yes|YES) CN_FLAG="--with-controlnet" ;; esac
  fi
}

run_install() { ask_cn; run_verb install $CN_FLAG; }

tui_menu() {
  printf '\n  Raccoon Studio\n  ════════════════\n'
  printf '  Status: %s\n\n' "$(status)"
  printf '  1) Install / Repair\n  2) Start\n  3) Update\n  4) Stop\n  5) Quit\n\n  Choose [1-5]: '
  local c; read -r c
  case "$c" in
    1) run_install ;; 2) run_verb start ;; 3) run_verb update ;;
    4) run_verb stop ;; 5|q|Q) return 0 ;; *) echo "  ?";;
  esac
}

gui_menu() {
  local st; st="$(status)"
  local choice
  choice="$(zenity --list --radiolist --title="Raccoon Studio" \
    --text="Status: $st" --column="" --column="Action" \
    TRUE Install FALSE Start FALSE Update FALSE Stop --width=360 --height=260 2>/dev/null)" || return 0
  [ -z "$choice" ] && return 0
  local verb; verb="$(echo "$choice" | tr 'A-Z' 'a-z')"
  if [ "$verb" = install ]; then run_install; else run_verb "$verb"; fi
}

if [ -z "${RACCOON_STUDIO_TUI:-}" ] && command -v zenity >/dev/null 2>&1; then gui_menu; else tui_menu; fi
