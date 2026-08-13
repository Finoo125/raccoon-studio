#!/usr/bin/env bash
# -----------------------------------------------------------------------------
# Upgrade Raccoon Studio - repairs an installation that can no longer update.
#
# Releases v1.0.18-v1.0.34 shipped an `engines` block in app/package.json but not
# in app/package-lock.json. Every install ran `npm install`, npm wrote the missing
# block into the tracked lockfile, and from v1.0.35 on - the first release whose
# diff touches that lock - `git pull --ff-only` aborts on a file nobody edited.
# Every fix for that ships inside the update those installs cannot pull, so this
# script arrives out of band (posted as a download) and breaks the loop.
#
# Run it with:  bash upgrade-raccoon-studio.sh
# Not ./upgrade-raccoon-studio.sh - publish.ps1 copies with Copy-Item, which does
# not carry git's exec bit, so every .sh lands non-executable in the public mirror.
#
#   --path DIR   upgrade this folder instead of searching for it
#   --dry-run    do everything except the actual install (used by the tests)
#   --no-pause   do not wait for a keypress at the end (used by the tests)
# -----------------------------------------------------------------------------
set -uo pipefail

# Overridable so the tests can point at a local repo instead of GitHub. Never set
# in a real install.
: "${PUBLIC_REPO:=https://github.com/Finoo125/raccoon-studio.git}"
REPORT_NAME="Raccoon Studio Upgrade Report.txt"
TRANSCRIPT="$(mktemp -t raccoon-upgrade-XXXXXX.log)"

ROOT=""; TARGET=""; DRY_FLAG=""; NO_PAUSE=0
STAGE="startup"; BEFORE=""; AFTER=""

# A while loop, not `for a in "$@"`: `--path DIR` needs to consume the next
# argument, and `shift` inside a for loop does not affect what it iterates over.
while [ $# -gt 0 ]; do
  case "$1" in
    --path=*)   TARGET="${1#*=}" ;;
    --path)     shift; TARGET="${1:-}" ;;
    # Held as the flag itself, not as 0/1: ${VAR:+...} expands on the *string*
    # "0", so a numeric flag would pass --dry-run on every single run.
    --dry-run)  DRY_FLAG="--dry-run" ;;
    --no-pause) NO_PAUSE=1 ;;
  esac
  shift || true
done

# Everything from here on is teed into the transcript, so the failure report shows
# exactly what the user saw - including output from git and the installer.
exec > >(tee -a "$TRANSCRIPT") 2>&1

STEP=0
step()   { STEP=$((STEP+1)); printf '\n  \033[36m[%d/6] %s\033[0m\n' "$STEP" "$1"; }
detail() { printf '        \033[90m%s\033[0m\n' "$1"; }
note()   { printf '        \033[33m%s\033[0m\n' "$1"; }

# ── Failure report ───────────────────────────────────────────────────────────
desktop_dir() {
  # A localized desktop is the norm outside English - a German Mint install uses
  # ~/Schreibtisch, and a hardcoded ~/Desktop would write the report where nobody
  # would ever find it.
  local d=""
  command -v xdg-user-dir >/dev/null 2>&1 && d="$(xdg-user-dir DESKTOP 2>/dev/null)"
  [ -n "$d" ] && [ -d "$d" ] && { printf '%s' "$d"; return; }
  [ -d "$HOME/Desktop" ] && { printf '%s' "$HOME/Desktop"; return; }
  printf '%s' "$HOME"
}

write_report() {
  local file; file="$(desktop_dir)/$REPORT_NAME"
  {
    echo "Raccoon Studio - upgrade report"
    echo "Generated: $(date '+%Y-%m-%d %H:%M:%S')"
    echo "System:    $(uname -a)"
    [ -r /etc/os-release ] && echo "Distro:    $(. /etc/os-release; echo "$PRETTY_NAME")"
    echo "Failed at: $STAGE"
    echo "Install:   ${ROOT:-(not found)}"
    echo "HEAD before / after: ${BEFORE:-?} / ${AFTER:-?}"
    echo
    if [ -n "$ROOT" ]; then
      echo "--- git status ---"; git -C "$ROOT" status 2>&1; echo
      # The installer's own log is where a real failure lands; the transcript
      # below usually only shows that the installer exited non-zero.
      local newest
      newest="$(ls -1t "$ROOT"/logs/install-*.log 2>/dev/null | head -1)"
      if [ -n "$newest" ]; then
        echo "--- last 200 lines of $(basename "$newest") ---"
        tail -n 200 "$newest"; echo
      fi
    fi
    echo "--- upgrade script transcript ---"
    # ponytail: tee runs in its own process, so the last few lines may not have
    # been flushed yet when we read the file back. A short wait is enough and
    # costs nothing on a path that already ends in a failure.
    sleep 0.3
    # Strip the ANSI colours the console needs but a text report does not.
    sed 's/\x1b\[[0-9;]*m//g' "$TRANSCRIPT" 2>/dev/null || echo "(no transcript captured)"
  } > "$file" 2>&1
  printf '%s' "$file"
}

finish() {
  local code="$1"
  if [ "$code" -eq 0 ]; then
    rm -f "$TRANSCRIPT"
  fi
  # Only pause when someone is actually watching; a piped or scripted run must not
  # block forever waiting for a key nobody will press.
  if [ "$NO_PAUSE" -eq 0 ] && [ -t 0 ]; then
    printf '\n'; read -r -p "  Press Enter to close " _ || true
  fi
  exit "$code"
}

die() {
  printf '\n  \033[31m------------------------------------------------------------\033[0m\n'
  printf '  \033[31mThe upgrade stopped while %s.\033[0m\n' "$STAGE"
  printf '  \033[33m%s\033[0m\n' "$1"
  local report; report="$(write_report)"
  printf '\n  A report was saved to:\n  %s\n' "$report"
  printf '  Post that file on Discord or Patreon and we will sort it out.\n'
  command -v xdg-open >/dev/null 2>&1 && xdg-open "$report" >/dev/null 2>&1 &
  printf '  \033[90mNothing was broken - you can run this file again at any time.\033[0m\n'
  printf '  \033[31m------------------------------------------------------------\033[0m\n'
  finish 1
}

# ── Finding the installation ─────────────────────────────────────────────────
# Both markers required: .git alone matches any clone, and install-linux.sh alone
# matches an unpacked copy with no history, which cannot be pulled.
is_root() { [ -n "${1:-}" ] && [ -d "$1/.git" ] && [ -f "$1/install-linux.sh" ]; }

# The .desktop entries the installer writes point Exec at a script inside the
# install root, so they are an exact answer - no disk scan, no guessing.
root_from_desktop_entry() {
  local f="$1" line path
  [ -r "$f" ] || return 1
  line="$(grep -m1 '^Exec=' "$f" 2>/dev/null)" || return 1
  # Exec=bash -c '"/path/to/raccoon-studio.sh"'
  path="$(printf '%s' "$line" | sed -n 's/.*"\(.*\)".*/\1/p')"
  [ -n "$path" ] || return 1
  path="$(dirname "$path")"
  is_root "$path" && printf '%s' "$path"
}

find_roots() {
  local here candidates=() c
  here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  for f in "$(desktop_dir)/Raccoon Studio.desktop" \
           "$HOME/.local/share/applications/raccoon-studio.desktop"; do
    c="$(root_from_desktop_entry "$f")" && [ -n "$c" ] && candidates+=("$c")
  done
  for base in "$here" "$HOME" "$HOME/Downloads" "$HOME/Documents" /opt; do
    for c in "$base" "$base/raccoon-studio"; do
      is_root "$c" && candidates+=("$(cd "$c" && pwd)")
    done
  done
  printf '%s\n' "${candidates[@]:-}" | awk 'NF && !seen[$0]++'
}

# Last resort only. Depth-limited on purpose: an install sits a few levels down,
# while the tens of gigabytes of models under it never need to be walked.
# Prints nothing but paths - its output is read as the candidate list, so a stray
# progress message here would be mistaken for an installation.
search_roots() {
  local d
  while IFS= read -r d; do
    d="$(dirname "$d")"
    is_root "$d" && printf '%s\n' "$d"
  done < <(find "$HOME" /opt -maxdepth 4 -name install-linux.sh -type f 2>/dev/null) | awk 'NF && !seen[$0]++'
}

# ── Git ──────────────────────────────────────────────────────────────────────
assert_git() {
  command -v git >/dev/null 2>&1 && return 0
  detail "Git is not installed - installing it..."
  if   command -v apt-get >/dev/null 2>&1; then sudo apt-get update -qq && sudo apt-get install -y git
  elif command -v dnf     >/dev/null 2>&1; then sudo dnf install -y git
  elif command -v pacman  >/dev/null 2>&1; then sudo pacman -Sy --noconfirm git
  else die "Git is missing and this distro's package manager was not recognised. Install git, then run this file again."
  fi
  command -v git >/dev/null 2>&1 || die "Git could not be installed automatically. Install it with your package manager, then run this file again."
}

repo_version() {
  local v
  v="$(git -C "$ROOT" describe --tags --abbrev=0 2>/dev/null)"
  [ -n "$v" ] && { printf '%s' "$v"; return; }
  v="$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null)"
  [ -n "$v" ] && printf 'commit %s' "$v" || printf 'unknown'
}

# ── Main ─────────────────────────────────────────────────────────────────────
printf '\n  \033[35m== Upgrade Raccoon Studio ==\033[0m\n'
printf '  \033[90mBrings an installation that can no longer update itself back to the\033[0m\n'
printf '  \033[90mlatest version. Your images, models and settings are not touched.\033[0m\n'

# 1 ─ find it
STAGE="finding the installation"
step "Finding your Raccoon Studio installation..."
if [ -n "$TARGET" ]; then
  is_root "$TARGET" || die "$TARGET is not a Raccoon Studio installation (no .git and install-linux.sh in it)."
  ROOT="$(cd "$TARGET" && pwd)"
else
  mapfile -t FOUND < <(find_roots)
  if [ "${#FOUND[@]}" -eq 0 ]; then
    detail "not found in the usual places - searching your home folder..."
    mapfile -t FOUND < <(search_roots)
  fi
  if [ "${#FOUND[@]}" -eq 0 ]; then
    die "No Raccoon Studio installation found. Run this file again with the folder given directly, for example: bash upgrade-raccoon-studio.sh --path /home/you/raccoon-studio"
  elif [ "${#FOUND[@]}" -eq 1 ]; then
    ROOT="${FOUND[0]}"
  else
    printf '\n'; note "More than one installation found:"
    for i in "${!FOUND[@]}"; do printf '          %d) %s\n' "$((i+1))" "${FOUND[$i]}"; done
    printf '\n'; read -r -p "        Which one should be upgraded? (number) " pick
    case "$pick" in ''|*[!0-9]*) die "No installation chosen. Run the file again and enter one of the listed numbers." ;; esac
    [ "$pick" -ge 1 ] && [ "$pick" -le "${#FOUND[@]}" ] || die "No installation chosen. Run the file again and enter one of the listed numbers."
    ROOT="${FOUND[$((pick-1))]}"
  fi
fi
detail "found: $ROOT"

# 2 ─ git
STAGE="checking Git"
step "Checking Git..."
assert_git
BEFORE="$(git -C "$ROOT" rev-parse HEAD 2>/dev/null)"
detail "Git is ready. Current version: $(repo_version)"

# 3 ─ clear the blockage
# Everything the user owns is gitignored - models under comfyui/ComfyUI/, /data/,
# /logs/, app/.env.local - so discarding all tracked edits is safe and kills the
# whole class of pull-blocking files, not just the lockfile we already know about.
# `git clean` is deliberately never run: that would delete untracked files.
STAGE="clearing files that block updates"
step "Clearing files that block updates..."
# -uno: only *tracked* modifications can block a fast-forward pull, and only those
# are what `checkout -- .` restores. Counting untracked files would fail the
# upgrade over a stray notes.txt the user left in the folder.
DIRTY="$(git -C "$ROOT" status --porcelain -uno 2>/dev/null)"
if [ -n "$DIRTY" ]; then
  detail "found changed program files - restoring them:"
  while IFS= read -r l; do [ -n "$l" ] && detail "  $l"; done <<< "$DIRTY"
  git -C "$ROOT" checkout -- . || die "Could not restore the changed files."
else
  detail "nothing in the way."
fi

# 4 ─ pull
STAGE="downloading the newest release"
step "Downloading the newest release..."
if ! git -C "$ROOT" pull --ff-only "$PUBLIC_REPO" main; then
  # Diverged history - no user install should have local commits, and a reset
  # touches nothing ignored, so the user's data is still safe.
  note "the normal update path was refused - repairing this installation's history..."
  git -C "$ROOT" fetch "$PUBLIC_REPO" main || die "Could not download the update. Check your internet connection and try again."
  git -C "$ROOT" reset --hard FETCH_HEAD   || die "Could not apply the download."
fi
AFTER="$(git -C "$ROOT" rev-parse HEAD 2>/dev/null)"
if [ "$BEFORE" = "$AFTER" ]; then detail "already had the newest files."; else detail "downloaded $(repo_version)."; fi

# 5 ─ apply, through the engine we just pulled
STAGE="applying the update"
step "Applying it - this takes several minutes, leave this window open..."
ENGINE="$ROOT/installer/engine.sh"
[ -f "$ENGINE" ] || die "The downloaded files are incomplete - $ENGINE is missing."
mkdir -p "$ROOT/logs"
RACCOON_ROOT="$ROOT" LOG_FILE="$ROOT/logs/upgrade.log" \
  bash "$ENGINE" install ${DRY_FLAG:+"$DRY_FLAG"} || die "The installer did not finish."

# 6 ─ prove the next update will work
STAGE="verifying"
step "Checking that future updates will work..."
LEFT="$(git -C "$ROOT" status --porcelain -uno 2>/dev/null)"
[ -z "$LEFT" ] || die "Some program files are still modified, which would block the next update:
$LEFT"
detail "no files left that could block an update."

REMOTE_SHA="$(GIT_TERMINAL_PROMPT=0 timeout 15 git ls-remote "$PUBLIC_REPO" main 2>/dev/null | head -1 | cut -f1)"
if [ -z "$REMOTE_SHA" ]; then
  note "could not reach GitHub to confirm the version - skipping that check."
elif [ "$REMOTE_SHA" != "$AFTER" ]; then
  die "This installation is still not on the latest release ($AFTER, expected $REMOTE_SHA)."
else
  detail "on the latest release."
fi

printf '\n  \033[32m------------------------------------------------------------\033[0m\n'
printf '  \033[32mDone. Raccoon Studio is up to date.\033[0m\n'
printf '  Version: %s\n' "$(repo_version)"
printf '  The Update button in the launcher works again from now on.\n'
printf '  \033[90mStart it with:  bash "%s/raccoon-studio.sh"\033[0m\n' "$ROOT"
printf '  \033[32m------------------------------------------------------------\033[0m\n'
finish 0
