#!/usr/bin/env bash
# ==============================================================================
#  Raccoon Studio Installer — Linux
#  Supports: Ubuntu 24.04 / 26.04 · Arch Linux · Fedora 44+
#  Requires : NVIDIA GPU with driver  |  internet connection
# ==============================================================================

# ── Relaunch in terminal if started without one (e.g. double-click in Dolphin) ──
# sudo needs a TTY to prompt for a password; file managers don't provide one.
# Skip the relaunch when invoked non-interactively (dry-run, engine, CI).
_GS_SELF="$(readlink -f "${BASH_SOURCE[0]}" 2>/dev/null || echo "$0")"
_GS_SKIP_RELAUNCH=0
for _a in "$@"; do [ "$_a" = "--dry-run" ] && _GS_SKIP_RELAUNCH=1; done
[ -n "${RS_FROM_ENGINE:-}" ] && _GS_SKIP_RELAUNCH=1
if [ "$_GS_SKIP_RELAUNCH" = 0 ] && [ ! -t 0 ] && { [ -n "${DISPLAY:-}" ] || [ -n "${WAYLAND_DISPLAY:-}" ]; }; then
  if   command -v konsole        &>/dev/null; then exec konsole --noclose -e bash "$_GS_SELF" "$@"
  elif command -v gnome-terminal &>/dev/null; then exec gnome-terminal -- bash -c "bash \"$_GS_SELF\"; echo; read -rp 'Press Enter to close...'"
  elif command -v xfce4-terminal &>/dev/null; then exec xfce4-terminal --hold -e "bash \"$_GS_SELF\""
  elif command -v mate-terminal  &>/dev/null; then exec mate-terminal -- bash -c "bash \"$_GS_SELF\"; echo; read -rp 'Press Enter to close...'"
  elif command -v tilix          &>/dev/null; then exec tilix -- bash -c "bash \"$_GS_SELF\"; echo; read -rp 'Press Enter to close...'"
  elif command -v xterm          &>/dev/null; then exec xterm -hold -e bash "$_GS_SELF" "$@"
  elif command -v lxterminal     &>/dev/null; then exec lxterminal -e "bash \"$_GS_SELF\""
  fi
  # No terminal found — show a GUI dialog instead of silently failing
  _GS_MSG="Raccoon Studio Installer needs a terminal.\n\nPlease open a terminal and run:\n  bash \"$_GS_SELF\""
  command -v zenity   &>/dev/null && { zenity  --info --width=400 --title="Raccoon Studio Installer" --text="$_GS_MSG"; exit 0; }
  command -v kdialog  &>/dev/null && { kdialog --title "Raccoon Studio Installer" --msgbox "$(printf '%b' "$_GS_MSG")"; exit 0; }
  command -v xmessage &>/dev/null && { xmessage -center "$(printf '%b' "$_GS_MSG")"; exit 0; }
  printf 'ERROR: No terminal emulator found. Open a terminal and run:\n  bash "%s"\n' "$_GS_SELF" >&2
  exit 1
fi
unset _GS_SELF _GS_MSG _GS_SKIP_RELAUNCH _a 2>/dev/null || true

set -Eeuo pipefail   # -E: inherit the ERR trap into functions/subshells

RS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
: "${RACCOON_ROOT:=$RS_DIR}"
source "$RS_DIR/installer/lib.sh"
WITH_CONTROLNET=0; SKIP_CONTROLNET=0
# Which acceleration stack to install for:
#   auto   - NVIDIA when nvidia-smi is present, else CPU. Deliberately does NOT
#            pick AMD: ROCm support is experimental and unverified on real
#            hardware, so it stays opt-in until a tester confirms it. An AMD card
#            is still DETECTED and the user is told how to opt in.
#   amd    - experimental ROCm/HIP path (RDNA3/RDNA4 only)
#   nvidia - force CUDA even if nvidia-smi is missing
#   cpu    - no acceleration
GPU_REQUEST=auto
for a in "$@"; do case "$a" in
  --dry-run)         DRY_RUN=1 ;;
  --with-controlnet) WITH_CONTROLNET=1 ;;
  --skip-controlnet) SKIP_CONTROLNET=1 ;;
  --gpu=*)           GPU_REQUEST="${a#*=}" ;;
esac; done
case "$GPU_REQUEST" in
  auto|nvidia|amd|cpu) ;;
  *) printf 'Unknown --gpu=%s (expected auto|nvidia|amd|cpu)\n' "$GPU_REQUEST" >&2; exit 2 ;;
esac
RS_TOTAL=13; RS_STEP=0

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMFYUI_DIR="$SCRIPT_DIR/comfyui/ComfyUI"
VENV_DIR="$COMFYUI_DIR/.venv"
APP_DIR="$SCRIPT_DIR/app"
LOG_DIR="$SCRIPT_DIR/logs"
INSTALL_LOG="$LOG_FILE"
SPINNER_PID=0

# ── Terminal capabilities ──────────────────────────────────────────────────────
if [ -t 1 ] && command -v tput &>/dev/null && tput colors &>/dev/null 2>&1; then
  R='\033[0;31m' G='\033[0;32m' Y='\033[1;33m' C='\033[0;36m'
  B='\033[0;34m' M='\033[0;35m' W='\033[0;37m' DIM='\033[2m'
  BOLD='\033[1m' N='\033[0m'
else
  R='' G='' Y='' C='' B='' M='' W='' DIM='' BOLD='' N=''
fi

# ── Logging: everything goes to log file too ──────────────────────────────────
if [ "$DRY_RUN" != 1 ]; then
  mkdir -p "$LOG_DIR"
  exec > >(tee -a "$INSTALL_LOG") 2>&1
fi

log_raw() { printf '%s %s\n' "$(date '+%H:%M:%S')" "$*" >> "$INSTALL_LOG" 2>/dev/null || true; }
log_cmd() { printf '\n[CMD] %s\n' "$*" >> "$INSTALL_LOG" 2>/dev/null || true; }

# Run a command silently (to log only), return exit code
run_log() {
  log_cmd "$*"
  "$@" >> "$INSTALL_LOG" 2>&1
  local rc=$?
  printf '[EXIT] %d\n' "$rc" >> "$INSTALL_LOG" 2>/dev/null || true
  return $rc
}

# ── UI helpers ─────────────────────────────────────────────────────────────────
step() { RS_STEP=$((RS_STEP+1)); emit_progress "$RS_STEP" "$RS_TOTAL" "$1"; }
run()  { if [ "$DRY_RUN" = 1 ]; then _log "[DRY] $*"; else "$@"; fi; }
ok()   { spinner_stop; printf "  ${G}${BOLD}✓${N}  %s\n" "$*"; log_raw "[OK]   $*"; }
info() { printf "  ${B}→${N}  %s\n" "$*"; log_raw "[INFO] $*"; }
warn() { spinner_stop; printf "  ${Y}!${N}  %s\n" "$*"; log_raw "[WARN] $*"; }
# ── Support bundle ─────────────────────────────────────────────────────────────
# One file a non-technical user can send us when something breaks: the install
# logs plus a fresh GPU dump, tarred onto the Desktop with a stable name.
# tar is always present; zip often is not.
make_support_bundle() {
  [ -d "$LOG_DIR" ] || return 1
  command -v nvidia-smi &>/dev/null && nvidia-smi > "$LOG_DIR/nvidia-smi.txt" 2>&1 || true
  local dest
  dest="$(xdg-user-dir DESKTOP 2>/dev/null || true)"
  [ -d "${dest:-}" ] || dest="$HOME/Desktop"
  [ -d "$dest" ] || dest="$HOME"
  local bundle="$dest/Raccoon-Studio-Support.tar.gz"
  tar -czf "$bundle" -C "$SCRIPT_DIR" logs 2>/dev/null && printf '%s' "$bundle" || return 1
}

fail() {
  spinner_stop
  printf "\n${R}${BOLD}  ✗  ERROR: %s${N}\n\n" "$*"
  log_raw "[FAIL] $*"
  local bundle; bundle="$(make_support_bundle)" || bundle=""
  if [ -n "$bundle" ]; then
    printf "  ${Y}A support file was saved to your Desktop:${N}\n"
    printf "      ${C}%s${N}\n" "$bundle"
    printf "  ${Y}Send us that one file and we can see exactly what went wrong.${N}\n\n"
  else
    printf "  ${DIM}Log saved to: %s${N}\n" "$INSTALL_LOG"
    printf "  ${DIM}Please send this file when reporting an issue.${N}\n\n"
  fi
  exit 1
}

# Safety net for any unguarded command that trips set -e — route the abort through
# fail() so the user still gets a support bundle instead of a bare non-zero exit.
on_error() {
  local rc=$?
  trap - ERR   # disarm to avoid re-entry while we report
  fail "Installation stopped unexpectedly (exit ${rc}). The log has the last command that ran."
}

# ── Driver update guidance ─────────────────────────────────────────────────────
# Shown when the NVIDIA driver is too old for GPU acceleration. Distro-specific
# so the command we hand the user actually works on their system.
show_driver_update_help() {
  local drv="${1:-}"
  printf '\n'
  printf "  ${Y}Your NVIDIA driver is too old for GPU acceleration"
  [ -n "$drv" ] && [ "$drv" != "unknown" ] && printf " (yours: %s)" "$drv"
  printf ".${N}\n"
  printf "  ${Y}Here is exactly how to fix it:${N}\n\n"
  case "$DISTRO_FAMILY" in
    debian)
      printf "    1. Open a terminal and run:\n"
      printf "         ${C}sudo ubuntu-drivers autoinstall${N}\n"
      printf "       (or pick the newest 'nvidia-driver-###' in Software & Updates)\n" ;;
    arch)
      printf "    1. Open a terminal and run:\n"
      printf "         ${C}sudo pacman -Syu nvidia${N}\n" ;;
    fedora)
      printf "    1. Enable RPM Fusion, then run:\n"
      printf "         ${C}sudo dnf install akmod-nvidia${N}\n" ;;
    *)
      printf "    1. Install the latest NVIDIA driver for your distribution\n"
      printf "       (your package manager, or https://www.nvidia.com/drivers)\n" ;;
  esac
  printf "    2. RESTART your computer\n"
  printf "    3. Run ${BOLD}./start.sh${N} again\n\n"
  printf "  ${DIM}You do NOT need the full CUDA Toolkit — only the driver above.${N}\n\n"
  log_raw "[DRIVER] shown driver-update help (driver=$drv)"
}

# ── Spinner ────────────────────────────────────────────────────────────────────
spinner_start() {
  spinner_stop
  local msg="$1"
  local frames=('⠋' '⠙' '⠹' '⠸' '⠼' '⠴' '⠦' '⠧' '⠇' '⠏')
  local i=0
  (
    while true; do
      printf "\r  ${C}%s${N}  %s   " "${frames[$i]}" "$msg"
      i=$(( (i+1) % 10 ))
      sleep 0.08
    done
  ) &
  SPINNER_PID=$!
  disown "$SPINNER_PID" 2>/dev/null || true
}

spinner_stop() {
  if [ "$SPINNER_PID" -ne 0 ] 2>/dev/null; then
    kill "$SPINNER_PID" 2>/dev/null || true
    wait "$SPINNER_PID" 2>/dev/null || true
    SPINNER_PID=0
    printf '\r%72s\r' ' '
  fi
}

# Run a command with spinner (skipped entirely in dry-run)
spin_run() {
  local msg="$1"; shift
  if [ "$DRY_RUN" = 1 ]; then _log "[DRY] $*"; return 0; fi
  spinner_start "$msg"
  run_log "$@"
  local rc=$?
  spinner_stop
  return $rc
}

# ── Banner ─────────────────────────────────────────────────────────────────────
print_banner() {
  clear 2>/dev/null || true
  printf '\n'
  printf "${M}${BOLD}"
  printf '  ╔══════════════════════════════════════════════════════════════╗\n'
  printf '  ║                                                              ║\n'
  printf '  ║ ██████╗  █████╗  ██████╗ ██████╗ ██████╗  ██████╗ ███╗   ██╗ ║\n'
  printf '  ║ ██╔══██╗██╔══██╗██╔════╝██╔════╝██╔═══██╗██╔═══██╗████╗  ██║ ║\n'
  printf '  ║ ██████╔╝███████║██║     ██║     ██║   ██║██║   ██║██╔██╗ ██║ ║\n'
  printf '  ║ ██╔══██╗██╔══██║██║     ██║     ██║   ██║██║   ██║██║╚██╗██║ ║\n'
  printf '  ║ ██║  ██║██║  ██║╚██████╗╚██████╗╚██████╔╝╚██████╔╝██║ ╚████║ ║\n'
  printf '  ║ ╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝ ╚═════╝ ╚═════╝  ╚═════╝ ╚═╝  ╚═══╝ ║\n'
  printf '  ║                                                              ║\n'
  printf "${N}${C}${BOLD}"
  printf '  ║              I N S T A L L E R  —  L I N U X               ║\n'
  printf '  ╚══════════════════════════════════════════════════════════════╝\n'
  printf "${N}\n"
  printf "  ${DIM}Installs ComfyUI + Manager + ReActor face swap + Impact Pack (Face Detailer)${N}\n"
  printf "  ${DIM}+ LTX 2.3 video nodes + Raccoon Studio web app. Large models: download from Models page.${N}\n\n"
}

# ── System info collector ──────────────────────────────────────────────────────
collect_sysinfo() {
  {
    printf '=%.0s' {1..64}; printf '\n'
    printf ' RACCOON STUDIO INSTALLATION LOG\n'
    printf '=%.0s' {1..64}; printf '\n'
    printf 'Date        : %s\n' "$(date '+%Y-%m-%d %H:%M:%S %Z')"
    printf 'Install dir : %s\n' "$SCRIPT_DIR"

    # OS
    if [ -f /etc/os-release ]; then
      . /etc/os-release
      printf 'OS          : %s\n' "${PRETTY_NAME:-$ID $VERSION_ID}"
    fi

    # Kernel
    printf 'Kernel      : %s\n' "$(uname -r)"
    # CPU
    local cpu
    cpu=$(grep -m1 'model name' /proc/cpuinfo 2>/dev/null | cut -d: -f2 | xargs || echo 'unknown')
    printf 'CPU         : %s\n' "$cpu"
    # RAM
    local ram
    ram=$(awk '/MemTotal/{printf "%.1f GB", $2/1024/1024}' /proc/meminfo 2>/dev/null || echo 'unknown')
    printf 'RAM         : %s\n' "$ram"
    # Disk
    local disk
    disk=$(df -h "$SCRIPT_DIR" 2>/dev/null | awk 'NR==2{print $4 " free of " $2}' || echo 'unknown')
    printf 'Disk        : %s\n' "$disk"
    # GPU
    if command -v nvidia-smi &>/dev/null; then
      local gpu drv
      gpu=$(nvidia-smi --query-gpu=name          --format=csv,noheader 2>/dev/null | head -1 || echo 'unknown')
      drv=$(nvidia-smi --query-gpu=driver_version --format=csv,noheader 2>/dev/null | head -1 || echo 'unknown')
      printf 'GPU         : %s\n' "$gpu"
      printf 'Driver      : %s\n' "$drv"
    else
      printf 'GPU         : (nvidia-smi not found)\n'
    fi
    # Versions
    printf 'Python      : %s\n' "$(python3 --version 2>/dev/null || echo 'not found')"
    printf 'Node.js     : %s\n' "$(node --version 2>/dev/null || echo 'not found')"
    printf 'npm         : %s\n' "$(npm --version 2>/dev/null || echo 'not found')"
    printf 'uv          : %s\n' "$(uv --version 2>/dev/null | head -1 || echo 'not found')"
    printf 'Git         : %s\n' "$(git --version 2>/dev/null || echo 'not found')"
    printf 'Log file    : %s\n' "$INSTALL_LOG"
    printf '=%.0s' {1..64}; printf '\n\n'
  } >> "$INSTALL_LOG" 2>/dev/null || true
}

# ── Distro detection ───────────────────────────────────────────────────────────
DISTRO_ID="" DISTRO_FAMILY="" DISTRO_VERSION=""
detect_distro() {
  if [ -f /etc/os-release ]; then
    . /etc/os-release
    DISTRO_ID="${ID:-unknown}"
    DISTRO_LIKE="${ID_LIKE:-}"
    DISTRO_VERSION="${VERSION_ID:-}"
  fi
  case "$DISTRO_ID" in
    ubuntu|debian|linuxmint|pop) DISTRO_FAMILY="debian" ;;
    arch|manjaro|endeavouros|garuda|cachyos) DISTRO_FAMILY="arch" ;;
    fedora|rhel|centos|rocky|alma) DISTRO_FAMILY="fedora" ;;
    *)
      if echo "${DISTRO_LIKE:-}" | grep -q debian;   then DISTRO_FAMILY="debian"
      elif echo "${DISTRO_LIKE:-}" | grep -q arch;   then DISTRO_FAMILY="arch"
      elif echo "${DISTRO_LIKE:-}" | grep -q fedora; then DISTRO_FAMILY="fedora"
      else DISTRO_FAMILY="unknown"
      fi ;;
  esac
}

# ── Sudo ───────────────────────────────────────────────────────────────────────
SUDO=""
ensure_sudo() {
  if [ "$EUID" -eq 0 ]; then SUDO=""
  elif command -v sudo &>/dev/null; then
    SUDO="sudo"
    if ! sudo -n true 2>/dev/null; then
      info "Administrator access needed for system packages (sudo)."
      sudo -v || fail "Could not obtain sudo."
    fi
  else
    fail "Root or sudo required to install system packages."
  fi
}

# ── Package helpers ────────────────────────────────────────────────────────────
pkg_apt()  { $SUDO apt-get install -y --no-install-recommends "$@" >> "$INSTALL_LOG" 2>&1; }
pkg_pac()  { $SUDO pacman -Sy --noconfirm --needed "$@" >> "$INSTALL_LOG" 2>&1; }
pkg_dnf()  { $SUDO dnf install -y "$@" >> "$INSTALL_LOG" 2>&1; }

# ── Python finder ──────────────────────────────────────────────────────────────
PYTHON_EXE=""
find_python() {
  for candidate in python3.12 python3.11 python3.10 python3; do
    if command -v "$candidate" &>/dev/null; then
      local ver; ver=$("$candidate" -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')" 2>/dev/null) || continue
      local major="${ver%%.*}"; local minor="${ver#*.}"
      if [ "$major" -eq 3 ] && [ "$minor" -ge 10 ] && [ "$minor" -le 13 ]; then
        PYTHON_EXE="$candidate"; return 0
      fi
    fi
  done
  return 1
}

# Next.js 16 needs Node 20.9+ (app/node_modules/next → engines.node ">=20.9.0").
# Checking only the major version lets Node 18/20.0 pass, `npm install` then gets
# far enough to look fine and the app dies at startup — so compare the minor too.
node_supported() {
  command -v node &>/dev/null || return 1
  node -e 'const [a,b] = process.versions.node.split(".").map(Number); process.exit(a > 20 || (a === 20 && b >= 9) ? 0 : 1)' 2>/dev/null
}

# ── Custom-node pack helpers ────────────────────────────────────────────────────
# Bash uses dynamic scoping, so these see main()'s $UV when called from it.
# All steps are non-fatal: one bad pack warns and continues rather than aborting.
install_node_pack() {
  local name="$1" url="$2"; local dir="$COMFYUI_DIR/custom_nodes/$name"
  if [ -d "$dir/.git" ]; then
    spin_run "Updating $name" git -C "$dir" pull --ff-only \
      || warn "$name update failed (keeping existing copy)"
  elif [ -d "$dir" ]; then
    info "$name already present — leaving as-is"
  else
    spin_run "Cloning $name" git clone --depth=1 "$url" "$dir" \
      || { warn "$name clone failed — its nodes will be unavailable"; return 0; }
  fi
  if [ -f "$dir/requirements.txt" ]; then
    spin_run "Installing $name dependencies" \
      "$UV" pip install --python "$VENV_DIR/bin/python" -r "$dir/requirements.txt" \
      || warn "$name dependency install failed (some of its nodes may not load)"
  fi
}

# Copy a private pack vendored in the repo into ComfyUI's custom_nodes.
copy_vendor_pack() {
  local name="$1"; local src="$SCRIPT_DIR/comfyui/vendor-custom-nodes/$name"
  local dir="$COMFYUI_DIR/custom_nodes/$name"
  [ -d "$src" ] || { warn "Vendored pack $name missing from repo — skipping"; return 0; }
  run mkdir -p "$dir"
  run cp -r "$src/." "$dir/" || { warn "Copying vendored $name failed"; return 0; }
  if [ -f "$dir/requirements.txt" ]; then
    spin_run "Installing $name dependencies" \
      "$UV" pip install --python "$VENV_DIR/bin/python" -r "$dir/requirements.txt" \
      || warn "$name dependency install failed"
  fi
}

# ── AMD / ROCm guidance ────────────────────────────────────────────────────────
# Stated up front, before anything is installed. Names what is actually degraded
# rather than a vague "may not work" — a tester needs to know what to ignore.
show_amd_experimental_warning() { # adapter-name
  printf "\n  ${Y}┌──────────────────────────────────────────────────────────────┐${N}\n"
  printf   "  ${Y}│  EXPERIMENTAL - AMD / ROCm support                           │${N}\n"
  printf   "  ${Y}└──────────────────────────────────────────────────────────────┘${N}\n"
  printf   "     ${DIM}Card: %s${N}\n\n" "${1:-unknown}"
  printf   "     ${Y}This path has NOT been verified on real AMD hardware yet.${N}\n"
  printf   "     ${DIM}Known limitations:${N}\n"
  printf   "     ${DIM}  - Face swap runs on the CPU (slower); the ROCm EP is untested${N}\n"
  printf   "     ${DIM}  - ControlNet preprocessors run on the CPU (slower)${N}\n"
  printf   "     ${DIM}  - The VRAM meter in the top bar stays blank${N}\n"
  printf   "     ${DIM}Image and video generation are expected to work at full speed.${N}\n\n"
  printf   "     ${C}If something breaks, send us logs/amd-diagnostics.txt.${N}\n\n"
  log_raw "[AMD] experimental warning shown (adapter=${1:-unknown})"
}

# A supported RDNA generation. Hard-fails rather than installing a stack that
# provably cannot work. Unlike Windows there is no Python 3.12 gate: the
# pytorch.org ROCm index ships cp310-cp315 wheels.
assert_amd_prerequisites() { # adapter-name
  if [ -z "$1" ]; then
    fail "--gpu=amd was requested but no AMD/Radeon graphics card was found. Re-run without --gpu=amd."
  fi
  if ! amd_rocm_supported "$1"; then
    printf "\n    ${R}%s is not supported by ROCm for PyTorch.${N}\n" "$1"
    printf   "    ${Y}AMD ships ROCm PyTorch support for RDNA3 and RDNA4:${N}\n"
    printf   "    ${DIM}  - Radeon RX 9000 series (9070 XT, 9070, 9060 XT, ...)${N}\n"
    printf   "    ${DIM}  - Radeon RX 7000 series (7900 XTX/XT/GRE, 7800 XT, 7700 XT, ...)${N}\n"
    printf   "    ${DIM}  - Radeon PRO W7000 / AI PRO R9700${N}\n"
    printf   "    ${DIM}RX 6000 and older (RDNA2, RDNA1, Vega) and the Ryzen integrated${N}\n"
    printf   "    ${DIM}graphics are not officially supported. RDNA2 can sometimes be${N}\n"
    printf   "    ${DIM}coaxed along with HSA_OVERRIDE_GFX_VERSION=10.3.0, but that is${N}\n"
    printf   "    ${DIM}unofficial and we will not ship it as a supported path.${N}\n\n"
    printf   "    ${C}Re-run without --gpu=amd to install the CPU build (slow but working).${N}\n\n"
    fail "$1 has no official ROCm PyTorch support."
  fi
  ok "$1 is a supported RDNA3/RDNA4 card"
}

# ── AMD diagnostics ────────────────────────────────────────────────────────────
# One purpose-built file a tester can paste, instead of asking them to grep a
# 2000-line install log. Written on the AMD path only.
write_amd_diagnostics() {
  [ "$GPU_VENDOR" = amd ] || return 0
  [ "$DRY_RUN" = 1 ] && return 0
  local f="$LOG_DIR/amd-diagnostics.txt" py="$VENV_DIR/bin/python" probe="" reserve=""
  mkdir -p "$LOG_DIR"
  # An early failure leaves no venv; the non-torch fields are still worth having.
  if [ -x "$py" ]; then
    probe=$("$py" -c '
import json
r = {}
try:
    import torch, sys
    r["python"] = "%d.%d.%d" % sys.version_info[:3]
    r["torch"] = torch.__version__
    r["hip"] = str(torch.version.hip or "")
    r["available"] = bool(torch.cuda.is_available())
    if r["available"]:
        p = torch.cuda.get_device_properties(0)
        r["device"] = torch.cuda.get_device_name(0)
        r["arch"] = str(getattr(p, "gcnArchName", "") or "")
        r["vram"] = round(p.total_memory / (1024 ** 3), 1)
except Exception as e:
    r["err"] = str(e)
try:
    import onnxruntime
    r["ort"] = onnxruntime.__version__
    r["ort_providers"] = onnxruntime.get_available_providers()
except Exception as e:
    r["ort_err"] = str(e)
print(json.dumps(r))' 2>/dev/null || true)
    reserve=$("$py" "$SCRIPT_DIR/installer/reserve-vram.py" 2>/dev/null || true)
  fi
  {
    printf '=== Raccoon Studio - AMD diagnostics ===\n'
    printf 'generated         : %s\n' "$(date '+%Y-%m-%d %H:%M:%S')"
    printf 'adapter           : %s\n' "${AMD_ADAPTER:-unknown}"
    printf 'kernel            : %s\n' "$(uname -r 2>/dev/null || echo '?')"
    printf 'distro            : %s\n' "$( (. /etc/os-release 2>/dev/null && echo "$PRETTY_NAME") || echo '?')"
    printf 'amdgpu module     : %s\n' "$(lsmod 2>/dev/null | grep -c '^amdgpu' || echo 0)"
    printf 'reserve-vram      : %s\n' "${reserve:+$reserve GB}${reserve:-(none - ComfyUI default)}"
    printf 'torch/onnx probe  : %s\n' "${probe:-(venv not built yet)}"
    printf '\n=== AMD step results (from the install log) ===\n'
    grep -E '\[AMD\]|\[ONNX\]|\[GPU\]' "$LOG_FILE" 2>/dev/null || printf '(none found)\n'
  } >"$f" 2>/dev/null && ok "AMD diagnostics written to logs/amd-diagnostics.txt"
  log_raw "[AMD] diagnostics written"
}

# ── onnxruntime execution provider ─────────────────────────────────────────────
# The node packs disagree about which onnxruntime to pull: comfyui_controlnet_aux
# wants onnxruntime-gpu, comfyui-easy-use wants plain onnxruntime, and ReActor's
# install.py picks its own. All three share ONE package directory, so whichever
# lands last wins and orphans the other's provider DLLs — leaving a machine that
# looks fine but runs face swap and the ControlNet preprocessors on the CPU.
# Reconcile to exactly one build, AFTER every pack has had its say.
install_onnxruntime() {
  local pkg
  case "${GPU_VENDOR:-cpu}" in
    nvidia) pkg="onnxruntime-gpu" ;;
    amd)    pkg="onnxruntime-rocm" ;;   # Linux keeps the ROCm EP; Windows uses DirectML
    *)      pkg="onnxruntime" ;;
  esac
  # uv exits 0 for packages that aren't installed, so listing all three is safe.
  spin_run "Reconciling onnxruntime" \
    "$UV" pip uninstall --python "$VENV_DIR/bin/python" \
      onnxruntime onnxruntime-gpu onnxruntime-rocm || true
  spin_run "Installing $pkg for face swap / ControlNet preprocessors" \
    "$UV" pip install --python "$VENV_DIR/bin/python" "$pkg" \
    || warn "$pkg install failed — face swap will run on the CPU (slow)"
  [ "$DRY_RUN" = 1 ] && return 0
  # Report what actually resolved. A GPU box that prints CPU here means the
  # provider libs didn't load — the single most useful line in a support bundle.
  local eps
  eps=$("$VENV_DIR/bin/python" -c \
    "import onnxruntime; print(','.join(onnxruntime.get_available_providers()))" 2>/dev/null || true)
  if [ -n "$eps" ]; then
    log_raw "[ONNX] $pkg providers: $eps"
    case "$eps" in
      *CUDA*|*ROCM*|*MIGraphX*) ok "GPU inference ready ($pkg)" ;;
      *) warn "onnxruntime has no GPU provider — face swap will run on the CPU" ;;
    esac
  else
    warn "Could not verify onnxruntime providers"
  fi
}

# ── Desktop shortcut helper ────────────────────────────────────────────────────
install_desktop_shortcut() {
  [ "$DRY_RUN" = 1 ] && { _log "[DRY] install_desktop_shortcut"; return 0; }
  local icon_src="$SCRIPT_DIR/app/public/icon.svg"
  local icon_dst="$HOME/.local/share/icons/hicolor/scalable/apps/raccoon-studio.svg"
  local app_dir="$HOME/.local/share/applications"
  local desktop_dir="$HOME/Desktop"
  local start_script="$SCRIPT_DIR/start-desktop.sh"
  local stop_script="$SCRIPT_DIR/stop.sh"
  local launcher_script="$SCRIPT_DIR/raccoon-studio.sh"

  mkdir -p "$(dirname "$icon_dst")" "$app_dir"

  # Install icon
  if [ -f "$icon_src" ]; then
    cp "$icon_src" "$icon_dst" 2>/dev/null || true
    # Update icon cache if gtk-update-icon-cache is available
    command -v gtk-update-icon-cache &>/dev/null && \
      gtk-update-icon-cache -f -t "$(dirname "$(dirname "$icon_dst")")" 2>/dev/null || true
  fi

  local start_content="[Desktop Entry]
Version=1.0
Type=Application
Name=Start Raccoon Studio
Comment=Start ComfyUI and the Raccoon Studio web app
Exec=bash -c '\"${start_script}\"'
Icon=raccoon-studio
Terminal=false
Categories=Graphics;Application;
StartupNotify=true
Keywords=AI;image;generation;ComfyUI;"

  local stop_content="[Desktop Entry]
Version=1.0
Type=Application
Name=Stop Raccoon Studio
Comment=Stop the Raccoon Studio web app and ComfyUI
Exec=bash -c '\"${stop_script}\"'
Icon=raccoon-studio
Terminal=true
Categories=Graphics;Application;
StartupNotify=false
Keywords=AI;image;generation;ComfyUI;stop;"

  # The launcher (Install/Start/Update/Stop home base) is the primary entry; the
  # Start/Stop entries remain for power users who want one-click direct actions.
  local launcher_content="[Desktop Entry]
Version=1.0
Type=Application
Name=Raccoon Studio
Comment=Install, start and update Raccoon Studio
Exec=bash -c '\"${launcher_script}\"'
Icon=raccoon-studio
Terminal=true
Categories=Graphics;Application;
StartupNotify=true
Keywords=AI;image;generation;ComfyUI;launcher;"

  # Application menu entries — launcher is the primary 'raccoon-studio.desktop'.
  printf '%s\n' "$launcher_content" > "$app_dir/raccoon-studio.desktop"
  printf '%s\n' "$start_content"    > "$app_dir/raccoon-studio-start.desktop"
  printf '%s\n' "$stop_content"     > "$app_dir/raccoon-studio-stop.desktop"
  chmod +x "$app_dir/raccoon-studio.desktop" "$app_dir/raccoon-studio-start.desktop" "$app_dir/raccoon-studio-stop.desktop"

  # Desktop shortcuts (if ~/Desktop exists): launcher home base + Start/Stop.
  if [ -d "$desktop_dir" ]; then
    printf '%s\n' "$launcher_content" > "$desktop_dir/Raccoon Studio.desktop"
    printf '%s\n' "$start_content"    > "$desktop_dir/Start Raccoon Studio.desktop"
    printf '%s\n' "$stop_content"     > "$desktop_dir/Stop Raccoon Studio.desktop"
    chmod +x "$desktop_dir/Raccoon Studio.desktop" "$desktop_dir/Start Raccoon Studio.desktop" "$desktop_dir/Stop Raccoon Studio.desktop"
    # Try to trust the shortcuts (GNOME/Nautilus)
    gio set "$desktop_dir/Raccoon Studio.desktop"       metadata::trusted true 2>/dev/null || true
    gio set "$desktop_dir/Start Raccoon Studio.desktop" metadata::trusted true 2>/dev/null || true
    gio set "$desktop_dir/Stop Raccoon Studio.desktop"  metadata::trusted true 2>/dev/null || true
    ok "Desktop shortcuts created: 'Raccoon Studio' (+ Start/Stop) on ~/Desktop"
  fi

  # Update desktop database
  command -v update-desktop-database &>/dev/null && \
    update-desktop-database "$app_dir" 2>/dev/null || true

  ok "Application menu entries created"
}

# ── Main ───────────────────────────────────────────────────────────────────────
main() {
  print_banner

  # Optional ControlNet / IP-Adapter models (~9 GB). Explicit flags win (the
  # engine always passes one, so headless runs never prompt); an interactive
  # console run asks once, up front. Default is skip — the Models page can
  # download them any time later.
  INSTALL_CN_MODELS=0
  if [ "$WITH_CONTROLNET" = 1 ]; then
    INSTALL_CN_MODELS=1
  elif [ "$SKIP_CONTROLNET" = 0 ] && [ -t 0 ]; then
    printf "  Optional: ControlNet + IP-Adapter models (~9 GB download).\n"
    printf "  Only the ControlNet / IP-Adapter features need them; everything else works without.\n"
    printf "  You can also download them later from the Models page.\n"
    printf "  Download them now? [y/N] "
    read -r yn || yn=
    [[ "${yn,,}" == "y" || "${yn,,}" == "yes" ]] && INSTALL_CN_MODELS=1
    printf "\n"
  fi
  collect_sysinfo
  detect_distro
  info "Distro: ${DISTRO_ID} ${DISTRO_VERSION} (family: ${DISTRO_FAMILY})"
  info "Install dir: ${SCRIPT_DIR}"

  # ── Step 1: GPU check ───────────────────────────────────────────────────────
  step "Checking graphics card and driver"
  # Which acceleration stack the rest of the install targets. Read by
  # install_onnxruntime and the PyTorch step. Deliberately global, not local —
  # later steps run outside this function.
  AMD_ADAPTER="$(amd_adapter_name)"
  case "$GPU_REQUEST" in
    nvidia) GPU_VENDOR=nvidia ;;
    amd)    GPU_VENDOR=amd ;;
    cpu)    GPU_VENDOR=cpu ;;
    *)      if command -v nvidia-smi &>/dev/null; then GPU_VENDOR=nvidia; else GPU_VENDOR=cpu; fi ;;
  esac
  # NVIDIA is selected automatically; AMD is offered, never forced. On a
  # ROCm-capable Radeon with no NVIDIA present, `auto` asks rather than silently
  # installing the CPU stack — which for an image/video generator means "your card
  # does nothing". Only offered when amd_rocm_supported already says yes, so the
  # answer can never lead into assert_amd_prerequisites aborting the whole install.
  AMD_AUTO_OFFER=0
  if [ "$GPU_REQUEST" = auto ] && [ "$GPU_VENDOR" = cpu ] &&
     [ -n "$AMD_ADAPTER" ] && amd_rocm_supported "$AMD_ADAPTER"; then
    AMD_AUTO_OFFER=1
    GPU_VENDOR=amd
  fi
  log_raw "[GPU] requested=$GPU_REQUEST resolved=$GPU_VENDOR amd='$AMD_ADAPTER' offer=$AMD_AUTO_OFFER"

  if [ "$GPU_VENDOR" = amd ]; then
    show_amd_experimental_warning "$AMD_ADAPTER"
    assert_amd_prerequisites      "$AMD_ADAPTER"
    if [ "$DRY_RUN" != 1 ]; then
      if [ -t 0 ]; then
        printf "\n  ${Y}Install the experimental AMD/ROCm build? [y/N]${N} "
        read -r yn
        if [[ "${yn,,}" != "y" ]]; then
          # Declining an offer keeps the install going on CPU; declining an explicit
          # --gpu=amd aborts, because CPU is not what that user asked for.
          if [ "$AMD_AUTO_OFFER" = 1 ]; then
            GPU_VENDOR=cpu
            warn "Installing the CPU build instead — generation will be very slow."
          else
            info "Aborting."; exit 0
          fi
        fi
      elif [ "$AMD_AUTO_OFFER" = 1 ]; then
        # No tty (zenity GUI, piped, headless): nobody consented to an experimental
        # stack, so stay on CPU and name the flag that opts in.
        GPU_VENDOR=cpu
        info "No interactive terminal — installing the CPU build. Re-run with --gpu=amd for ROCm."
      else
        info "No interactive terminal — proceeding with the experimental AMD build."
      fi
    fi
  elif command -v nvidia-smi &>/dev/null; then
    local drv gpu
    drv=$(nvidia-smi --query-gpu=driver_version --format=csv,noheader 2>/dev/null | head -1 || echo "unknown")
    gpu=$(nvidia-smi --query-gpu=name          --format=csv,noheader 2>/dev/null | head -1 || echo "unknown")
    ok "Driver ${drv}  ·  ${gpu}"
    log_raw "[NVIDIA] driver=$drv gpu=$gpu"
    # ponytail: conservative CUDA-12.0 floor (525). The post-install torch check
    # is the real authority; this is only an early heads-up for clearly-old drivers.
    local drv_major="${drv%%.*}"
    if [[ "$drv_major" =~ ^[0-9]+$ ]] && [ "$drv_major" -lt 525 ]; then
      warn "Driver ${drv} may be too old for GPU acceleration."
      show_driver_update_help "$drv"
    fi
  else
    warn "nvidia-smi not found."
    if [ -n "$AMD_ADAPTER" ] && amd_rocm_supported "$AMD_ADAPTER"; then
      # Reachable only when something else was asked for explicitly (--gpu=cpu, or
      # --gpu=nvidia on a box with no driver): `auto` offers ROCm above instead.
      warn "AMD graphics card detected: $AMD_ADAPTER"
      printf "\n    ${C}Experimental AMD (ROCm) support is available. To use it, re-run:${N}\n"
      printf "        ${C}./install-linux.sh --gpu=amd${N}\n"
      printf "    ${DIM}It is unverified on real hardware — see the warning it prints.${N}\n"
      printf "    ${DIM}Continuing now installs the CPU build (works, but very slow).${N}\n\n"
      log_raw "[GPU] AMD card detected but not selected (opt-in via --gpu=amd)"
    elif [ -n "$AMD_ADAPTER" ]; then
      warn "AMD graphics card detected ($AMD_ADAPTER) but it is not ROCm-supported."
      info "RDNA3/RDNA4 only (RX 7000/9000). Generation will be CPU-only (very slow)."
    else
      warn "If you have an NVIDIA GPU, install the driver and re-run."
    fi
    warn "Generation will fall back to CPU (very slow) without CUDA."
    # Only prompt with an interactive terminal; the zenity GUI / headless runs
    # have no tty on stdin and must continue CPU-only rather than read EOF and
    # silently abort.
    if [ "$DRY_RUN" != 1 ]; then
      if [ -t 0 ]; then
        printf "\n  ${Y}Continue without NVIDIA driver? [y/N]${N} "
        read -r yn
        [[ "${yn,,}" == "y" ]] || { info "Aborting. Install NVIDIA driver first."; exit 0; }
      else
        warn "No interactive terminal — continuing CPU-only."
      fi
    fi
  fi

  # ── Step 2: Sudo ────────────────────────────────────────────────────────────
  step "Checking system privileges"
  [ "$DRY_RUN" != 1 ] && ensure_sudo
  ok "Privilege check passed"

  # ── Step 3: System packages ─────────────────────────────────────────────────
  step "Installing system packages"
  case "$DISTRO_FAMILY" in
    debian)
      spinner_start "Updating package lists"
      run $SUDO apt-get update -qq >> "$INSTALL_LOG" 2>&1 || true
      spinner_stop

      if ! command -v python3.12 &>/dev/null; then
        spinner_start "Adding deadsnakes PPA for Python 3.12"
        run pkg_apt software-properties-common
        run $SUDO add-apt-repository -y ppa:deadsnakes/ppa >> "$INSTALL_LOG" 2>&1 || true
        run $SUDO apt-get update -qq >> "$INSTALL_LOG" 2>&1 || true
        spinner_stop
      fi
      # ffmpeg/ffprobe power Movie Maker export, Director assembly, and video probing.
      # tar powers Tools → Backup & restore (single-.tar archive).
      spin_run "Installing git, python3.12, build tools, ffmpeg, tar" \
        $SUDO apt-get install -y --no-install-recommends \
          git curl wget python3.12 python3.12-venv python3.12-dev build-essential ffmpeg tar
      ;;
    arch)
      spin_run "Updating pacman and installing base packages" \
        $SUDO pacman -Sy --noconfirm --needed git curl wget python base-devel ffmpeg tar
      ;;
    fedora)
      spin_run "Installing packages via dnf" \
        $SUDO dnf install -y git curl wget python3.12 python3.12-devel gcc gcc-c++ make ffmpeg tar
      ;;
    *)
      warn "Unknown distro family — checking for required tools manually"
      for tool in git curl python3 ffmpeg tar; do
        command -v "$tool" &>/dev/null || fail "$tool not found. Install it and re-run."
      done
      ;;
  esac
  ok "System packages ready"

  # ── Step 4: Node.js 22 ──────────────────────────────────────────────────────
  step "Ensuring Node.js 20.9+ is installed"
  if node_supported; then
    ok "Node.js $(node --version) found"
  else
    if command -v node &>/dev/null; then
      warn "Node.js $(node --version) is too old for Next.js 16 (needs 20.9+) — upgrading"
    fi
    case "$DISTRO_FAMILY" in
      debian)
        spin_run "Installing Node.js 22 via NodeSource" \
          bash -c 'curl -fsSL https://deb.nodesource.com/setup_22.x | '"$SUDO"' -E bash - && '"$SUDO"' apt-get install -y nodejs'
        ;;
      arch) spin_run "Installing nodejs via pacman" $SUDO pacman -Sy --noconfirm --needed nodejs npm ;;
      fedora) spin_run "Installing nodejs via dnf" $SUDO dnf install -y nodejs npm ;;
      *) fail "Cannot auto-install Node.js. Install Node.js 20.9+ (22 LTS recommended) manually and re-run." ;;
    esac
    # Distro packages lag: re-verify instead of trusting the install.
    node_supported || fail "Node.js $(node --version 2>/dev/null || echo 'none') is still what's on PATH after installing. Install Node.js 22 LTS manually (nodejs.org or nvm) and re-run."
    ok "Node.js $(node --version) installed"
  fi

  # ── Step 5: uv ──────────────────────────────────────────────────────────────
  step "Ensuring uv (Python package manager) is installed"
  if command -v uv &>/dev/null; then
    ok "uv $(uv --version 2>/dev/null | head -1) found"
  else
    spin_run "Downloading and installing uv" \
      bash -c 'curl -LsSf https://astral.sh/uv/install.sh | sh'
    export PATH="$HOME/.local/bin:$HOME/.cargo/bin:$PATH"
    command -v uv &>/dev/null || fail "uv installation failed. See $INSTALL_LOG"
    ok "uv installed"
  fi
  local UV="$(command -v uv)"

  # ── Step 6: Clone ComfyUI ────────────────────────────────────────────────────
  step "Setting up ComfyUI"
  run mkdir -p "$SCRIPT_DIR/comfyui"
  if [ -f "$COMFYUI_DIR/main.py" ]; then
    spin_run "Pulling ComfyUI updates" git -C "$COMFYUI_DIR" pull --ff-only
    ok "ComfyUI updated"
  else
    spin_run "Cloning ComfyUI (this may take a minute)" \
      git clone --depth=1 https://github.com/comfyanonymous/ComfyUI.git "$COMFYUI_DIR"
    ok "ComfyUI cloned"
  fi

  # ── Step 7: Python venv + PyTorch ────────────────────────────────────────────
  step "Creating Python environment and installing PyTorch"
  find_python || fail "Python 3.10–3.13 not found. Install python3.12 and re-run."
  info "Using $PYTHON_EXE ($($PYTHON_EXE --version 2>&1 | head -1))"

  if [ ! -d "$VENV_DIR" ]; then
    spin_run "Creating virtual environment" \
      "$UV" venv "$VENV_DIR" --python "$PYTHON_EXE" --seed
    ok "Virtual environment created"
  else
    ok "Virtual environment already exists"
  fi

  # ROCm needs --index-url, not --extra-index-url: with an extra index pip/uv can
  # still prefer the default PyPI torch (CPU/CUDA build) since the version strings
  # differ, silently leaving an AMD box without HIP. Pointing the index at ROCm
  # makes the ROCm wheel the only candidate. The index carries cp310-cp315, so
  # unlike the Windows path there is no Python 3.12 requirement here.
  if [ "$GPU_VENDOR" = amd ]; then
    TORCH_ARGS=(--index-url https://download.pytorch.org/whl/rocm7.2)
    info "Installing PyTorch for AMD/ROCm 7.2 — downloading ~3 GB, this will take a while..."
  else
    # CPU-only boxes get the same wheels: the CUDA build runs fine on the CPU, so
    # this keeps one code path and matches the pre-AMD behaviour exactly.
    TORCH_ARGS=(--extra-index-url https://download.pytorch.org/whl/cu128)
    if [ "$GPU_VENDOR" = nvidia ]; then
      info "Installing PyTorch with CUDA 12.x — downloading ~2.5 GB, this will take a while..."
    else
      info "Installing PyTorch — downloading ~2.5 GB, this will take a while..."
    fi
  fi
  info "Progress is shown below. Do not close the terminal."
  if [ "$DRY_RUN" != 1 ]; then
    printf '\n'
    "$UV" pip install --python "$VENV_DIR/bin/python" \
      torch torchvision torchaudio \
      "${TORCH_ARGS[@]}" \
      2>&1 | tee -a "$INSTALL_LOG" | grep --line-buffered -E 'Downloading|Installed|error|Error|warning' || {
        printf '\n'
        [ "$GPU_VENDOR" = amd ] && log_raw '[AMD] torch rocm wheels : FAILED'
        fail "PyTorch installation failed. See $INSTALL_LOG"
      }
    [ "$GPU_VENDOR" = amd ] && log_raw '[AMD] torch rocm wheels : OK'
    printf '\n'
  fi
  ok "PyTorch installed"

  spin_run "Installing ComfyUI requirements" \
    "$UV" pip install --python "$VENV_DIR/bin/python" \
      -r "$COMFYUI_DIR/requirements.txt"
  ok "ComfyUI requirements installed"

  # ── Step 8: Custom nodes (Manager + rgthree + ReActor + Impact Pack) ─────────
  step "Installing custom nodes (Manager + rgthree + ReActor + Impact)"
  local MGR="$COMFYUI_DIR/custom_nodes/ComfyUI-Manager"
  run mkdir -p "$COMFYUI_DIR/custom_nodes"
  if [ -d "$MGR/.git" ]; then
    spin_run "Updating ComfyUI Manager" git -C "$MGR" pull --ff-only
    ok "ComfyUI Manager updated"
  else
    spin_run "Cloning ComfyUI Manager" \
      git clone --depth=1 https://github.com/ltdrdata/ComfyUI-Manager.git "$MGR"
    ok "ComfyUI Manager installed"
  fi
  if [ -f "$MGR/requirements.txt" ]; then
    spin_run "Installing ComfyUI Manager dependencies" \
      "$UV" pip install --python "$VENV_DIR/bin/python" -r "$MGR/requirements.txt"
  fi

  # rgthree-comfy — provides the "Lora Loader Stack (rgthree)" node the default
  # Z Image Turbo workflow uses to load the model/CLIP and stack LoRAs.
  local RGTHREE="$COMFYUI_DIR/custom_nodes/rgthree-comfy"
  if [ -d "$RGTHREE/.git" ]; then
    spin_run "Updating rgthree-comfy" git -C "$RGTHREE" pull --ff-only \
      || warn "rgthree-comfy update failed (keeping existing copy)"
  else
    spin_run "Cloning rgthree-comfy" \
      git clone --depth=1 https://github.com/rgthree/rgthree-comfy.git "$RGTHREE" \
      || warn "rgthree-comfy clone failed — the default workflow won't load"
  fi
  if [ -f "$RGTHREE/requirements.txt" ]; then
    spin_run "Installing rgthree-comfy dependencies" \
      "$UV" pip install --python "$VENV_DIR/bin/python" -r "$RGTHREE/requirements.txt" \
      || warn "rgthree-comfy dependency install failed"
  fi

  # ReActor face-swap node — powers the Z Image Turbo face-swap workflow.
  local REACTOR="$COMFYUI_DIR/custom_nodes/comfyui-reactor-node"
  if [ -d "$REACTOR/.git" ]; then
    spin_run "Updating ReActor face-swap node" git -C "$REACTOR" pull --ff-only \
      || warn "ReActor update failed (keeping existing copy)"
  else
    spin_run "Cloning ReActor face-swap node" \
      git clone --depth=1 https://codeberg.org/Gourieff/comfyui-reactor-node.git "$REACTOR" \
      || warn "ReActor clone failed — face swap will be unavailable"
  fi
  # install.py installs deps (incl. onnxruntime) and downloads inswapper_128.onnx.
  # ReActor 0.7.0+ needs no Insightface. Non-fatal so the install still completes.
  if [ -f "$REACTOR/install.py" ]; then
    spin_run "Installing ReActor deps + face-swap model" \
      bash -c "cd '$REACTOR' && '$VENV_DIR/bin/python' install.py" \
      || warn "ReActor setup incomplete — open ComfyUI once to finish model download"
  fi
  # Pre-fetch the face-restore model our default workflow references, so the
  # first face swap runs without an on-demand download.
  local FR_DIR="$COMFYUI_DIR/models/facerestore_models"
  if [ ! -f "$FR_DIR/codeformer-v0.1.0.pth" ]; then
    run mkdir -p "$FR_DIR"
    spin_run "Downloading CodeFormer face-restore model" \
      curl -fL --retry 3 -o "$FR_DIR/codeformer-v0.1.0.pth" \
        https://huggingface.co/datasets/Gourieff/ReActor/resolve/main/models/facerestore_models/codeformer-v0.1.0.pth \
      || { warn "CodeFormer download failed (ReActor fetches it on first use)"; rm -f "$FR_DIR/codeformer-v0.1.0.pth"; }
  fi
  # GPEN-BFR-1024 drives the realistic face-boost/restore in the swap chain
  # (face-swap.ts default — 1024 preserves texture the 512 model downscales
  # away). ReActor only auto-fetches restorers when the folder is empty, so
  # grab it explicitly.
  if [ ! -f "$FR_DIR/GPEN-BFR-1024.onnx" ]; then
    run mkdir -p "$FR_DIR"
    spin_run "Downloading GPEN-BFR-1024 face-restore model" \
      curl -fL --retry 3 -o "$FR_DIR/GPEN-BFR-1024.onnx" \
        https://huggingface.co/datasets/Gourieff/ReActor/resolve/main/models/facerestore_models/GPEN-BFR-1024.onnx \
      || { warn "GPEN-BFR-1024 download failed — grab it from the Models page (face swap needs it)"; rm -f "$FR_DIR/GPEN-BFR-1024.onnx"; }
  fi
  # Hi-res upscale models (ESRGAN). The image workflows reference these by name in
  # UpscaleModelLoader, so without them the (default-on) upscale stage fails prompt
  # validation: 4x-UltraSharp (Ernie / Z-Image / SDXL) and 4x-AnimeSharp (Anima /
  # Pony / Illustrious). sha256-verified against the canonical Kim2091 repos.
  local UPSCALE_DIR="$COMFYUI_DIR/models/upscale_models"
  run mkdir -p "$UPSCALE_DIR"
  if [ ! -f "$UPSCALE_DIR/4x-UltraSharp.pth" ]; then
    spin_run "Downloading 4x-UltraSharp upscale model" \
      curl -fL --retry 3 -o "$UPSCALE_DIR/4x-UltraSharp.pth" \
        https://huggingface.co/Kim2091/UltraSharp/resolve/main/4x-UltraSharp.pth \
      || { warn "4x-UltraSharp download failed (grab it via the Models tab, or turn Upscale off)"; rm -f "$UPSCALE_DIR/4x-UltraSharp.pth"; }
  fi
  if [ ! -f "$UPSCALE_DIR/4x-AnimeSharp.pth" ]; then
    spin_run "Downloading 4x-AnimeSharp upscale model" \
      curl -fL --retry 3 -o "$UPSCALE_DIR/4x-AnimeSharp.pth" \
        https://huggingface.co/Kim2091/AnimeSharp/resolve/main/4x-AnimeSharp.pth \
      || { warn "4x-AnimeSharp download failed (grab it via the Models tab, or turn Upscale off)"; rm -f "$UPSCALE_DIR/4x-AnimeSharp.pth"; }
  fi
  # ComfyUI Impact Pack + Subpack — provide FaceDetailer, UltralyticsDetectorProvider,
  # and SAMLoader for the optional Face Detailer stage on all image workflows.
  install_node_pack "comfyui-impact-pack"    https://github.com/ltdrdata/ComfyUI-Impact-Pack.git
  install_node_pack "comfyui-impact-subpack" https://github.com/ltdrdata/ComfyUI-Impact-Subpack.git
  # Face Detailer models: the bbox face detector (UltralyticsDetectorProvider) and
  # the SAM segmenter (SAMLoader). The workflows reference these by name, so the
  # (default-on) detailer stage needs them present to pass prompt validation.
  local BBOX_DIR="$COMFYUI_DIR/models/ultralytics/bbox"
  if [ ! -f "$BBOX_DIR/face_yolov8m.pt" ]; then
    run mkdir -p "$BBOX_DIR"
    spin_run "Downloading face_yolov8m detector (detailer)" \
      curl -fL --retry 3 -o "$BBOX_DIR/face_yolov8m.pt" \
        https://huggingface.co/Bingsu/adetailer/resolve/main/face_yolov8m.pt \
      || { warn "face_yolov8m download failed (grab it via the Models tab, or turn Detailer off)"; rm -f "$BBOX_DIR/face_yolov8m.pt"; }
  fi
  local SAM_DIR="$COMFYUI_DIR/models/sams"
  if [ ! -f "$SAM_DIR/sam_vit_b_01ec64.pth" ]; then
    run mkdir -p "$SAM_DIR"
    spin_run "Downloading SAM ViT-B segmenter (detailer)" \
      curl -fL --retry 3 -o "$SAM_DIR/sam_vit_b_01ec64.pth" \
        https://dl.fbaipublicfiles.com/segment_anything/sam_vit_b_01ec64.pth \
      || { warn "SAM model download failed (grab it via the Models tab, or turn Detailer off)"; rm -f "$SAM_DIR/sam_vit_b_01ec64.pth"; }
  fi
  # ComfyUI-Crystools — powers the studio top bar's live CPU/RAM/VRAM meters
  # (SystemMonitor reads its `crystools.monitor` websocket stream). Without it the
  # meters silently stay idle ("—"). Its requirements (deepdiff) are installed by
  # install_node_pack.
  install_node_pack "ComfyUI-Crystools"      https://github.com/crystian/ComfyUI-Crystools.git
  ok "Custom nodes ready"

  # ── Step 9: ControlNet Aux + IP-Adapter Plus nodes + models ──────────────────
  step "Installing ControlNet / IP-Adapter nodes and models"
  # comfyui_controlnet_aux — preprocessors (Canny, Depth, Pose, etc.) used by
  # the ControlNet graph helper (appendControlNet / appendImg2Img).
  install_node_pack "comfyui_controlnet_aux"  https://github.com/Fannovel16/comfyui_controlnet_aux.git
  # ComfyUI_IPAdapter_plus — IPAdapterUnifiedLoader + apply nodes used by
  # the IP-Adapter graph helper (appendIpAdapter). The node packs are small and
  # always installed; only the multi-GB model downloads below are optional.
  install_node_pack "ComfyUI_IPAdapter_plus"  https://github.com/cubiq/ComfyUI_IPAdapter_plus.git
  if [ "$INSTALL_CN_MODELS" = 1 ]; then
  # comfyui_controlnet_aux fetches its preprocessor weights on FIRST use of each
  # node (OpenPose ~500 MB, DepthAnythingV2 ~1.3 GB). That first ControlNet run
  # would otherwise block on a large download and, until it finishes, emit an
  # empty control map — so the pose/depth is silently ignored. Pre-fetch them
  # here so ControlNet works on the first try; ckpts paths mirror the HF repos
  # the aux pack reads from (Canny/Scribble need no weights). Non-fatal.
  local AUX_CKPTS="$COMFYUI_DIR/custom_nodes/comfyui_controlnet_aux/ckpts"
  # rows: "<dest-subdir>|<filename>|<url>"
  local aux_rows=(
    "lllyasviel/Annotators|body_pose_model.pth|https://huggingface.co/lllyasviel/Annotators/resolve/main/body_pose_model.pth"
    "lllyasviel/Annotators|hand_pose_model.pth|https://huggingface.co/lllyasviel/Annotators/resolve/main/hand_pose_model.pth"
    "lllyasviel/Annotators|facenet.pth|https://huggingface.co/lllyasviel/Annotators/resolve/main/facenet.pth"
    "depth-anything/Depth-Anything-V2-Large|depth_anything_v2_vitl.pth|https://huggingface.co/depth-anything/Depth-Anything-V2-Large/resolve/main/depth_anything_v2_vitl.pth"
  )
  local row
  for row in "${aux_rows[@]}"; do
    local sub="${row%%|*}"; local rest="${row#*|}"
    local fname="${rest%%|*}"; local url="${rest#*|}"
    local ddir="$AUX_CKPTS/$sub"
    if [ ! -f "$ddir/$fname" ]; then
      run mkdir -p "$ddir"
      spin_run "Downloading ControlNet preprocessor weight: $fname" \
        curl -fL --retry 3 -o "$ddir/$fname" "$url" \
        || { warn "$fname download failed — it will be fetched on first ControlNet use instead"; rm -f "$ddir/$fname"; }
    fi
  done
  # ControlNet Union SDXL ProMax — single model covers all 7 control types.
  # Filename must match UNION_MODEL in app/src/lib/workflows/controlnet.ts.
  local CN_DIR="$COMFYUI_DIR/models/controlnet"
  if [ ! -f "$CN_DIR/controlnet-union-sdxl-promax.safetensors" ]; then
    run mkdir -p "$CN_DIR"
    spin_run "Downloading ControlNet Union SDXL ProMax" \
      curl -fL --retry 3 -o "$CN_DIR/controlnet-union-sdxl-promax.safetensors" \
        https://huggingface.co/xinsir/controlnet-union-sdxl-1.0/resolve/main/diffusion_pytorch_model_promax.safetensors \
      || { warn "ControlNet Union download failed (grab it via the Models tab)"; rm -f "$CN_DIR/controlnet-union-sdxl-promax.safetensors"; }
  fi
  # IP-Adapter Plus SDXL ViT-H — used by IPAdapterUnifiedLoader preset
  # 'PLUS (high strength)' for style/face-reference conditioning.
  local IPA_DIR="$COMFYUI_DIR/models/ipadapter"
  if [ ! -f "$IPA_DIR/ip-adapter-plus_sdxl_vit-h.safetensors" ]; then
    run mkdir -p "$IPA_DIR"
    spin_run "Downloading IP-Adapter Plus SDXL ViT-H" \
      curl -fL --retry 3 -o "$IPA_DIR/ip-adapter-plus_sdxl_vit-h.safetensors" \
        https://huggingface.co/h94/IP-Adapter/resolve/main/sdxl_models/ip-adapter-plus_sdxl_vit-h.safetensors \
      || { warn "IP-Adapter Plus download failed (grab it via the Models tab)"; rm -f "$IPA_DIR/ip-adapter-plus_sdxl_vit-h.safetensors"; }
  fi
  # CLIP ViT-H vision encoder — required by IPAdapterUnifiedLoader alongside the
  # IP-Adapter weights. Hosted as model.safetensors; renamed to the canonical
  # CLIP-ViT-H-14-laion2B-s32B-b79K.safetensors filename ComfyUI expects.
  local CV_DIR="$COMFYUI_DIR/models/clip_vision"
  if [ ! -f "$CV_DIR/CLIP-ViT-H-14-laion2B-s32B-b79K.safetensors" ]; then
    run mkdir -p "$CV_DIR"
    spin_run "Downloading CLIP ViT-H-14 vision encoder (IP-Adapter)" \
      curl -fL --retry 3 -o "$CV_DIR/CLIP-ViT-H-14-laion2B-s32B-b79K.safetensors" \
        https://huggingface.co/h94/IP-Adapter/resolve/main/models/image_encoder/model.safetensors \
      || { warn "CLIP ViT-H download failed (grab it via the Models tab)"; rm -f "$CV_DIR/CLIP-ViT-H-14-laion2B-s32B-b79K.safetensors"; }
  fi
  # Z-Image Turbo Fun Union ControlNet — model patch for the z-image control path
  # (ModelPatchLoader + QwenImageDiffsynthControlnet). 8-step distilled 2601 build
  # keeps Turbo's 8-step speed and adds scribble. Filename must match FUN_MODEL in
  # app/src/lib/workflows/zimage-controlnet.ts.
  local MP_DIR="$COMFYUI_DIR/models/model_patches"
  local ZFUN="Z-Image-Turbo-Fun-Controlnet-Union-2.1-2601-8steps.safetensors"
  if [ ! -f "$MP_DIR/$ZFUN" ]; then
    run mkdir -p "$MP_DIR"
    spin_run "Downloading Z-Image Fun Union ControlNet" \
      curl -fL --retry 3 -o "$MP_DIR/$ZFUN" \
        "https://huggingface.co/alibaba-pai/Z-Image-Turbo-Fun-Controlnet-Union-2.1/resolve/main/$ZFUN" \
      || { warn "Z-Image Fun ControlNet download failed (grab it via the Models tab)"; rm -f "$MP_DIR/$ZFUN"; }
  fi
  else
    info "Skipping ControlNet / IP-Adapter models (optional; download them any time from the Models page)."
  fi
  # SDXL fp16-fix VAE — decoded through by the SDXL/Pony/Illustrious workflows in
  # place of a checkpoint's baked VAE, which fixes washed-out / desaturated colors
  # (the SDXL fp16 VAE overflow, notably on Illustrious). Filename must match
  # SDXL_FIX_VAE in app/src/lib/workflows/sdxl.ts.
  local VAE_DIR="$COMFYUI_DIR/models/vae"
  if [ ! -f "$VAE_DIR/sdxl_vae.safetensors" ]; then
    run mkdir -p "$VAE_DIR"
    spin_run "Downloading SDXL fp16-fix VAE" \
      curl -fL --retry 3 -o "$VAE_DIR/sdxl_vae.safetensors" \
        https://huggingface.co/madebyollin/sdxl-vae-fp16-fix/resolve/main/sdxl.vae.safetensors \
      || { warn "SDXL VAE download failed (grab it via the Models tab)"; rm -f "$VAE_DIR/sdxl_vae.safetensors"; }
  fi
  ok "ControlNet / IP-Adapter nodes and models ready"

  # ── Step 10: LTX 2.3 video nodes ─────────────────────────────────────────────
  step "Installing LTX 2.3 video nodes"
  info "Video generation adds ~9 node packs. The large LTX models are NOT fetched"
  info "here — download them later from the Models page when you want video."
  install_node_pack "comfyui-kjnodes"          https://github.com/kijai/ComfyUI-KJNodes.git
  install_node_pack "comfyui-videohelpersuite" https://github.com/Kosinkadink/ComfyUI-VideoHelperSuite.git
  install_node_pack "comfyui-easy-use"         https://github.com/yolain/ComfyUI-Easy-Use.git
  install_node_pack "ComfyMath"                https://github.com/evanspearman/ComfyMath.git
  install_node_pack "ComfyLiterals"            https://github.com/M1kep/ComfyLiterals.git
  install_node_pack "RES4LYF"                  https://github.com/ClownsharkBatwing/RES4LYF.git
  install_node_pack "controlaltai-nodes"       https://github.com/gseth/ControlAltAI-Nodes.git
  install_node_pack "10S_Nodes"                https://github.com/TenStrip/10S-Comfy-nodes.git
  install_node_pack "ComfyUI-mxToolkit"        https://github.com/Smirnov75/ComfyUI-mxToolkit.git
  install_node_pack "comfyui-various"          https://github.com/jamesWalker55/comfyui-various.git
  install_node_pack "ComfyUI-LTXVideo"         https://github.com/Lightricks/ComfyUI-LTXVideo.git
  install_node_pack "ComfyUI-VFI"              https://github.com/GACLove/ComfyUI-VFI.git
  # comfyui-various imports soundfile lazily (not in its requirements.txt), and
  # ComfyUI-LTXVideo's pyramid blending breaks on kornia 0.8.3 — pin what works.
  spin_run "Installing video node extra deps" \
    "$UV" pip install --python "$VENV_DIR/bin/python" soundfile "kornia==0.8.1" \
    || warn "video node extra deps failed (comfyui-various / LTXVideo may not load)"
  # RTX video super-resolution — needs an RTX GPU + TensorRT (nvidia-vfx). The
  # single most fragile piece; kept fully non-fatal so the install still finishes.
  # Needs nvidia-vfx (TensorRT), which has no AMD build at all — pip would just
  # fail noisily. No workflow references these nodes, so skipping costs nothing.
  if [ "$GPU_VENDOR" = amd ]; then
    info "Skipping NVIDIA RTX video nodes (NVIDIA-only; not used by any workflow)."
    log_raw '[AMD] skipped pack: comfyui_nvidia_rtx_nodes (NVIDIA-only)'
  else
    install_node_pack "comfyui_nvidia_rtx_nodes" https://github.com/Comfy-Org/Nvidia_RTX_Nodes_ComfyUI.git
  fi
  # RaccoonVideoNodes — the studio's video prompt node pack, vendored in the repo.
  copy_vendor_pack  "RaccoonVideoNodes"
  # RaccoonSwapNodes — pixel-boost face swap, vendored in the repo.
  copy_vendor_pack  "RaccoonSwapNodes"
  ok "LTX 2.3 video nodes ready"

  # Must come after every pack above — see install_onnxruntime for why order matters.
  install_onnxruntime

  # ── Step 11: App Node.js deps ────────────────────────────────────────────────
  step "Installing Raccoon Studio app dependencies"
  [ -f "$APP_DIR/package.json" ] || fail "app/package.json not found at $APP_DIR"
  spin_run "Running npm install" npm install --prefix "$APP_DIR"
  ok "Node.js dependencies installed"

  # ── Step 12: Start scripts + .env.local ──────────────────────────────────────
  step "Writing start scripts and configuration"

  if [ "$DRY_RUN" != 1 ]; then
  # start-comfyui.sh — stub only; real logic is installer/start-comfyui-core.sh
  write_start_comfyui_stub "$SCRIPT_DIR/start-comfyui.sh"

  # start.sh — opens terminal with both services
  cat > "$SCRIPT_DIR/start.sh" <<'STARTALL'
#!/usr/bin/env bash
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
printf '\n  Raccoon Studio — Starting up\n  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n'
echo "  → Starting ComfyUI (background)..."
"$SCRIPT_DIR/start-comfyui.sh" &
CPID=$!
sleep 2
echo "  → Starting Raccoon Studio web app..."
echo "  → Open http://localhost:3000 in your browser"
echo ""
cd "$SCRIPT_DIR/app" && npm run dev
kill $CPID 2>/dev/null || true
STARTALL
  chmod +x "$SCRIPT_DIR/start.sh"

  # start-desktop.sh — for the .desktop launcher (no terminal, opens browser)
  cat > "$SCRIPT_DIR/start-desktop.sh" <<'DESKTOPSTART'
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
DESKTOPSTART
  chmod +x "$SCRIPT_DIR/start-desktop.sh"

  # stop.sh — stops the web app and ComfyUI
  cat > "$SCRIPT_DIR/stop.sh" <<'STOPSCRIPT'
#!/usr/bin/env bash
# Raccoon Studio — Stop the web app and ComfyUI
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

stopped=0
kill_port() {
  local port="$1" pids=""
  if command -v lsof &>/dev/null; then pids="$(lsof -ti tcp:"$port" 2>/dev/null || true)"
  elif command -v fuser &>/dev/null; then pids="$(fuser "$port"/tcp 2>/dev/null || true)"
  fi
  for pid in $pids; do kill "$pid" 2>/dev/null && stopped=1; done
}
kill_pattern() {
  if command -v pkill &>/dev/null; then pkill -f "$1" 2>/dev/null && stopped=1; fi
}

echo "[Raccoon Studio] Stopping web app (port 3000)..."
kill_port 3000
kill_pattern "next dev"
kill_pattern "next-server"

echo "[Raccoon Studio] Stopping ComfyUI (port 8188)..."
kill_port 8188
kill_pattern "comfyui/ComfyUI/main.py"

if [ "$stopped" -eq 1 ]; then echo "[Raccoon Studio] Stopped."; else echo "[Raccoon Studio] Nothing was running."; fi
STOPSCRIPT
  chmod +x "$SCRIPT_DIR/stop.sh"

  # .env.local
  local env_file="$APP_DIR/.env.local"
  [ -f "$env_file" ] && cp "$env_file" "$env_file.bak" && info ".env.local backed up"
  cat > "$env_file" <<ENVFILE
COMFYUI_BASE_URL=http://127.0.0.1:8188
COMFYUI_OUTPUT_DIR=${COMFYUI_DIR}/output
COMFYUI_MODELS_DIR=${COMFYUI_DIR}/models
COMFYUI_START_SCRIPT=${SCRIPT_DIR}/start-comfyui.sh
ENVFILE
  ok "start-comfyui.sh, start.sh, start-desktop.sh, stop.sh created"
  ok ".env.local written"
  fi # end DRY_RUN guard for file writes

  # ── Step 13: Desktop shortcut + CUDA check ───────────────────────────────────
  step "Creating desktop shortcut and verifying CUDA"
  install_desktop_shortcut

  # GPU verification. torch.cuda is the right namespace for BOTH vendors:
  # PyTorch-ROCm aliases HIP into it, so one probe covers CUDA and ROCm.
  # torch.version.hip distinguishes them, and gcnArchName is the authoritative
  # AMD arch check (the earlier name match is only a pre-flight gate).
  local cuda_json
  cuda_json=$("$VENV_DIR/bin/python" - <<'PYCHECK' 2>/dev/null
import json, sys
r = {'ok': False, 'device': '', 'err': '', 'hip': '', 'arch': ''}
try:
    import torch
    r['hip'] = str(torch.version.hip or '')
    r['ok'] = bool(torch.cuda.is_available())
    if r['ok']:
        r['device'] = torch.cuda.get_device_name(0)
        r['arch'] = str(getattr(torch.cuda.get_device_properties(0), 'gcnArchName', '') or '')
except Exception as e:
    r['err'] = str(e)
print(json.dumps(r))
PYCHECK
  ) || true

  local cuda_ok cuda_dev cuda_err cuda_hip cuda_arch stack
  cuda_ok=$(printf '%s' "$cuda_json"  | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('available',d.get('ok','False')))" 2>/dev/null || echo "False")
  cuda_dev=$(printf '%s' "$cuda_json" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('device',''))" 2>/dev/null || echo "")
  cuda_err=$(printf '%s' "$cuda_json" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('err',''))" 2>/dev/null || echo "")
  cuda_hip=$(printf '%s' "$cuda_json" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('hip',''))" 2>/dev/null || echo "")
  cuda_arch=$(printf '%s' "$cuda_json" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('arch',''))" 2>/dev/null || echo "")
  if [ -n "$cuda_hip" ]; then stack="ROCm $cuda_hip"; else stack="CUDA"; fi

  if [ "$cuda_ok" = "True" ]; then
    ok "${stack} acceleration ready: ${cuda_dev}"
    [ -n "$cuda_arch" ] && info "GPU architecture: ${cuda_arch}"
    log_raw "[GPU] Available: stack=$stack device=$cuda_dev arch=$cuda_arch"
  elif [ "$GPU_VENDOR" = amd ]; then
    warn "GPU acceleration is not active yet: ${cuda_err:-unknown}"
    info "First, RESTART your computer and run './start.sh' — this fixes it in most cases."
    info "If it persists, check that the amdgpu kernel module is loaded and your"
    info "kernel/ROCm versions match: https://rocm.docs.amd.com/projects/radeon-ryzen/"
    log_raw "[GPU] Unavailable: ${cuda_err:-unknown}"
  elif command -v nvidia-smi &>/dev/null; then
    warn "GPU acceleration is not active yet: ${cuda_err:-unknown}"
    info "First, RESTART your computer and run './start.sh' — this fixes it in most cases."
    info "If it still does not work after a restart, your driver is too old:"
    show_driver_update_help "$(nvidia-smi --query-gpu=driver_version --format=csv,noheader 2>/dev/null | head -1)"
  else
    warn "No GPU acceleration — generation will use CPU (slow)"
  fi

  # AMD-only: one pasteable file so a tester's report is actionable.
  write_amd_diagnostics

  # ── Done ─────────────────────────────────────────────────────────────────────
  printf '\n'
  printf "${G}${BOLD}  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${N}\n"
  printf "${G}${BOLD}  ✓  Installation complete!${N}\n"
  printf "${G}${BOLD}  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${N}\n\n"
  printf "  ${BOLD}How to start Raccoon Studio:${N}\n"
  printf "  ${G}→${N}  Double-click ${BOLD}Raccoon Studio${N} on your desktop\n"
  printf "  ${G}→${N}  Or in terminal: ${BOLD}./start.sh${N}\n"
  printf "  ${G}→${N}  Then open: ${C}http://localhost:3000${N}\n\n"
  printf "  ${DIM}Download models from the Models page before generating${N}\n"
  printf "  ${DIM}Log saved to: %s${N}\n\n" "$INSTALL_LOG"
  printf "  ${Y}If anything ever misbehaves, run ./collect-support.sh and send${N}\n"
  printf "  ${Y}the file it saves to your Desktop.${N}\n\n"
}

trap 'on_error' ERR
main "$@"
trap - ERR   # install finished cleanly; drop the safety net before the epilogue
[ -n "${RS_FROM_ENGINE:-}" ] || emit_done install
