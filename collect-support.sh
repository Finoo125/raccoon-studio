#!/usr/bin/env bash
# Raccoon Studio — collect a support bundle for troubleshooting.
# Run this any time something misbehaves; it tars the logs plus a fresh GPU report
# onto your Desktop as one file to send us.
set -u
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOGS="$DIR/logs"

if [ ! -d "$LOGS" ] || [ -z "$(ls -A "$LOGS" 2>/dev/null)" ]; then
  echo
  echo "  No logs to collect yet — start Raccoon Studio at least once first."
  echo
  exit 0
fi

# Fresh GPU/driver dump next to the logs so it lands inside the archive.
command -v nvidia-smi &>/dev/null && nvidia-smi > "$LOGS/nvidia-smi.txt" 2>&1 || true

dest="$(xdg-user-dir DESKTOP 2>/dev/null || true)"
[ -d "${dest:-}" ] || dest="$HOME/Desktop"
[ -d "$dest" ] || dest="$HOME"
bundle="$dest/Raccoon-Studio-Support.tar.gz"

if tar -czf "$bundle" -C "$DIR" logs 2>/dev/null; then
  echo
  echo "  Support file created:"
  echo "      $bundle"
  echo "  Send us that one file and we can see exactly what went wrong."
  echo
else
  echo
  echo "  Could not create the support file. Please send the contents of: $LOGS"
  echo
fi
