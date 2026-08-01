#!/usr/bin/env bash
# ==============================================================================
#  Raccoon Studio — one-shot Linux bootstrap (mirror of bootstrap.ps1).
#
#  Ensures Git is installed, makes sure the repo is present (clones it if you're
#  not already inside it), and runs the installer. Safe to re-run (idempotent).
#  Meant for the one-line command in the README:
#      curl -fsSL .../bootstrap.sh | bash
#  but also works if you clone manually and run it directly. Extra arguments are
#  passed through to install-linux.sh (e.g. --with-controlnet).
# ==============================================================================
set -Eeuo pipefail

REPO_URL='https://github.com/Finoo125/raccoon-studio.git'

# Piped from curl, stdin is the pipe (already at EOF), so sudo and the
# installer's prompts would have nothing to read — and install-linux.sh would
# see a non-tty and relaunch itself in a new terminal window. Reattach the real
# terminal first, when there is one. The subshell probes whether /dev/tty can
# actually be opened — it exists but fails to open when there is no controlling
# terminal, and a failed `exec` redirect kills a non-interactive shell outright.
if [ ! -t 0 ] && (: < /dev/tty) 2>/dev/null; then exec < /dev/tty; fi

printf '\n  == Raccoon Studio bootstrap ==\n\n'

# 1) Ensure Git — install-linux.sh installs the rest, but cloning needs git now.
if ! command -v git >/dev/null 2>&1; then
  printf '  Installing Git...\n'
  if   command -v apt-get >/dev/null 2>&1; then sudo apt-get update -qq && sudo apt-get install -y git
  elif command -v pacman  >/dev/null 2>&1; then sudo pacman -Sy --noconfirm --needed git
  elif command -v dnf     >/dev/null 2>&1; then sudo dnf install -y git
  else printf '  Could not auto-install Git. Install it with your package manager and re-run.\n' >&2; exit 1
  fi
fi

# 2) Locate the repo (already inside it?) or clone it
if [ -f install-linux.sh ]; then
  ROOT="$PWD"
  printf '  Using the repo in the current folder: %s\n' "$ROOT"
elif [ -d raccoon-studio/.git ]; then
  ROOT="$PWD/raccoon-studio"
  printf '  Repo already cloned — pulling latest...\n'
  # `npm install` rewrites the tracked app/package-lock.json when it disagrees with
  # package.json, so the pull would abort on a file nobody edited (and set -e would
  # kill the bootstrap). It is generated - the installer below rebuilds it.
  git -C "$ROOT" checkout -- app/package-lock.json 2>/dev/null || true
  git -C "$ROOT" pull --ff-only
else
  ROOT="$PWD/raccoon-studio"
  printf '  Cloning Raccoon Studio...\n'
  git clone "$REPO_URL" "$ROOT"
fi

# 3) Run the installer — it prints its own "how to start" epilogue when done.
cd "$ROOT"
printf '  Installed into: %s\n' "$ROOT"
bash install-linux.sh "$@"
