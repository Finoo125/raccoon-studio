#!/usr/bin/env bash
# Raccoon Studio installer — shared logging + structured progress helpers.
# Output protocol (one line each): PROGRESS|step|total|pct|msg · WARN|msg · DONE|verb · FAIL|verb|msg
: "${RACCOON_ROOT:="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"}"
: "${DRY_RUN:=0}"
LOG_DIR="$RACCOON_ROOT/logs"
: "${LOG_FILE:="$LOG_DIR/install-$(date +%Y%m%d-%H%M%S).log"}"

_log() { mkdir -p "$(dirname "$LOG_FILE")"; printf '%s %s\n' "$(date +%H:%M:%S)" "$1" >>"$LOG_FILE" 2>/dev/null || true; }

# Pinned upstream revision for a dependency, or empty when unpinned (caller
# then follows the default branch). See installer/pinned-versions.txt for why.
pinned_rev() { # name
  local file="$RACCOON_ROOT/installer/pinned-versions.txt" name="$1" n rev
  [ -f "$file" ] || return 0
  while read -r n rev _; do
    case "$n" in ''|'#'*) continue;; esac
    [ "$n" = "$name" ] && { printf '%s' "$rev"; return 0; }
  done <"$file"
}

emit_progress() { # step total message
  local pct=$(( $1 * 100 / $2 ))
  printf 'PROGRESS|%s|%s|%s|%s\n' "$1" "$2" "$pct" "$3"
  _log "[STEP $1/$2] $3"
}
emit_warn() { printf 'WARN|%s\n' "$1"; _log "[WARN] $1"; }
emit_done() { printf 'DONE|%s\n' "$1"; _log "[DONE] $1"; }
emit_fail() { printf 'FAIL|%s|%s\n' "$1" "$2"; _log "[FAIL] $1: $2"; }

# ── GPU detection ─────────────────────────────────────────────────────────────
# AMD cards AMD's own ROCm matrix covers for PyTorch: gfx1100/1101 (discrete
# RDNA3) and gfx1200/1201 (RDNA4). RX 6000/5000 (RDNA2/RDNA1), Vega, and the
# Ryzen iGPUs are not officially supported, so we refuse instead of installing a
# stack that cannot work. (On Linux RDNA2 can be coaxed along with
# HSA_OVERRIDE_GFX_VERSION, but that is unofficial and we will not ship it.)
#
# Matching on the marketing name is a pre-flight gate only. The authoritative
# check is gcnArchName from torch after install, which the AMD diagnostics report.
amd_rocm_supported() { # adapter-name
  case "$1" in
    *RX\ 9[0-9][0-9][0-9]*|*RX\ 7[0-9][0-9][0-9]*)  return 0 ;;
    *RX9[0-9][0-9][0-9]*|*RX7[0-9][0-9][0-9]*)      return 0 ;;
    *PRO\ W7[0-9][0-9][0-9]*)                       return 0 ;;
    *AI\ PRO\ R9[0-9][0-9][0-9]*)                   return 0 ;;
    *) return 1 ;;
  esac
}

# The acceleration stack the existing venv was built with, read from the torch
# dist-info directory name (torch-2.13.0+rocm7.2.dist-info -> amd). Empty when
# nothing is installed yet.
#
# This exists so `update` re-runs the installer with the SAME stack: without it,
# an update would reinstall CUDA wheels straight over a working ROCm venv and
# silently break every AMD user. Reading a directory name is free; importing
# torch to ask would cost ~1.5s.
installed_gpu_vendor() {
  local d
  for d in "$RACCOON_ROOT"/comfyui/ComfyUI/.venv/lib/python*/site-packages/torch-*.dist-info; do
    [ -d "$d" ] || continue
    case "$d" in
      *rocm*)    printf 'amd';    return 0 ;;
      *+cu[0-9]*) printf 'nvidia'; return 0 ;;
      *)         printf 'cpu';    return 0 ;;
    esac
  done
  printf ''
}

# The most capable Radeon adapter present, or empty when there isn't one.
#
# Prefers a ROCm-capable card rather than taking the first match: a Ryzen APU
# exposes an integrated Radeon adapter alongside any discrete card, and
# enumeration order is not guaranteed. Picking blindly would refuse a perfectly
# good RX 9070 XT on the very common Ryzen + Radeon build.
amd_adapter_name() {
  local names=() n f
  # DRM product_name is more reliable than lspci's PCI-ID table on new silicon,
  # so it goes first; lspci is the fallback for kernels that don't expose it.
  for f in /sys/class/drm/card*/device/product_name; do
    [ -r "$f" ] || continue
    n=$(cat "$f" 2>/dev/null || true)
    case "$n" in *[Aa][Mm][Dd]*|*[Rr]adeon*) names+=("$n") ;; esac
  done
  if command -v lspci &>/dev/null; then
    # Take the 4th quoted field (slot, class, vendor, DEVICE), not the last one:
    # lspci -mm appends quoted subsystem vendor/device, so anchoring on the end
    # yields the board partner's "Device 5100" instead of "Radeon RX 9070 XT" -
    # which then fails amd_rocm_supported and refuses a perfectly supported card.
    while IFS= read -r n; do
      [ -n "$n" ] && names+=("$n")
    done < <(lspci -mm 2>/dev/null | grep -i 'vga\|3d\|display' | grep -i 'amd\|radeon\|ati' |
             sed -E 's/^[^"]*"[^"]*"[[:space:]]*"[^"]*"[[:space:]]*"([^"]*)".*/\1/')
  fi
  [ "${#names[@]}" -eq 0 ] && { printf ''; return 0; }
  for n in "${names[@]}"; do
    amd_rocm_supported "$n" && { printf '%s' "$n"; return 0; }
  done
  printf '%s' "${names[0]}"   # unsupported, but naming it makes the refusal useful
}

# start-comfyui.* is generated and gitignored, so `git pull` can never update a
# user's copy. Bump this whenever the generated launcher's *shape* changes (new
# flag, new helper call) and the launcher regenerates itself on next start.
# Tuning values must NOT live in the generated script — see installer/reserve-vram.py.
START_SCRIPT_VERSION=2

# 0 (true) when the generated launcher predates START_SCRIPT_VERSION or is absent.
start_script_stale() { # path
  [ -f "$1" ] || return 0
  local v
  v=$(sed -n 's/.*raccoon-start-version:[[:space:]]*\([0-9]\+\).*/\1/p' "$1" | head -1)
  [ -n "$v" ] || return 0            # pre-versioning script
  [ "$v" -lt "$START_SCRIPT_VERSION" ]
}

# Write the generated launcher. Deliberately a stub: it holds no flags and no
# tuning, so a shape bump should never be needed again. exec keeps the python
# child in the same process tree that stop.sh's process-group kill relies on.
write_start_comfyui_stub() { # path
  cat > "$1" <<STUB
#!/usr/bin/env bash
# Raccoon Studio — Start ComfyUI
# raccoon-start-version: $START_SCRIPT_VERSION
# Generated stub. All logic lives in installer/start-comfyui-core.sh, which is
# tracked so \`git pull\` updates it. Safe to delete — rebuilt on next launch.
exec "\$(cd "\$(dirname "\${BASH_SOURCE[0]}")" && pwd)/installer/start-comfyui-core.sh"
STUB
  chmod +x "$1"
}
