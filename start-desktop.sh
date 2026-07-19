#!/usr/bin/env bash
# Raccoon Studio — Desktop launcher
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_DIR="$SCRIPT_DIR/logs"
mkdir -p "$LOG_DIR"

# Check if already running
if curl -s --max-time 2 http://localhost:3000 >/dev/null 2>&1; then
  xdg-open http://localhost:3000 2>/dev/null || true; exit 0
fi

# Start ComfyUI
nohup "$SCRIPT_DIR/start-comfyui.sh" > "$LOG_DIR/comfyui.log" 2>&1 &

# Start Next.js app
nohup bash -c "cd '$SCRIPT_DIR/app' && npm run dev" > "$LOG_DIR/app.log" 2>&1 &

# Wait for the web app to be ready (up to 60s)
TRIES=0
while ! curl -s --max-time 1 http://localhost:3000 >/dev/null 2>&1; do
  sleep 1; TRIES=$((TRIES+1))
  [ "$TRIES" -ge 60 ] && break
done

xdg-open http://localhost:3000 2>/dev/null || true
