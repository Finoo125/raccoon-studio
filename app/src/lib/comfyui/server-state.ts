import { EventEmitter } from 'events'
import { spawnSync } from 'child_process'
import os from 'os'
import path from 'path'
import fs from 'fs'
import { log, type LogLevel } from '@/lib/logging/logger'
import { getSettings } from '@/lib/settings/settings'

export type ComfyUIPhase = 'idle' | 'starting' | 'updating' | 'restarting' | 'error'

// ---------------------------------------------------------------------------
// Shared mutable state. Next.js compiles each route into its own bundle, so a
// plain module-level variable would exist once PER ROUTE — the logs route
// would never see lines appended by the start route. Stashing the state on
// globalThis gives every bundle (and HMR generation) the same instance.
// ---------------------------------------------------------------------------
export interface UpdateCheckState {
  available: boolean | null // null = not checked yet
  checkedAt: number
  inFlight: boolean
}

interface SharedState {
  discoveredBase: string | null
  logBuffer: string[]
  logEmitter: EventEmitter
  phase: ComfyUIPhase
  phaseMessage: string | null
  phaseSince: number
  updateCheck: UpdateCheckState
}

const globalStore = globalThis as typeof globalThis & { __raccoonComfyUIState?: SharedState }
const state: SharedState = (globalStore.__raccoonComfyUIState ??= (() => {
  const emitter = new EventEmitter()
  emitter.setMaxListeners(32)
  return {
    discoveredBase: null,
    logBuffer: [],
    logEmitter: emitter,
    phase: 'idle' as ComfyUIPhase,
    phaseMessage: null,
    phaseSince: Date.now(),
    updateCheck: { available: null, checkedAt: 0, inFlight: false },
  }
})())

// ---------------------------------------------------------------------------
// Discovered base URL (updated by /api/comfyui-control/detect)
// ---------------------------------------------------------------------------
export function getComfyUIBase(): string {
  const configured = getSettings().comfyuiBaseUrl
  // getSettings() always returns a value (env or default); prefer a discovered
  // base only when the setting is still the hard default and discovery found one.
  if (configured && configured !== 'http://127.0.0.1:8188') return configured
  return state.discoveredBase ?? configured
}

export function setDiscoveredBase(url: string) {
  state.discoveredBase = url
}

// ---------------------------------------------------------------------------
// Boot log ring buffer + emitter
// ---------------------------------------------------------------------------
const MAX_LOG_LINES = 500

// CSI sequences (colors, cursor movement) plus stray carriage returns from
// progress bars — ComfyUI's terminal output is full of both.
const ANSI_RE = /\u001b\[[0-9;?]*[A-Za-z]/g

export function stripAnsi(line: string): string {
  return line.replace(ANSI_RE, '').replace(/\r/g, '')
}

/** Map ComfyUI's own terminal markers onto structured log levels. */
export function inferLogLevel(line: string): LogLevel {
  if (line.startsWith('[error]') || line.includes('[ERROR]') || line.includes('Traceback (most recent call last)')) {
    return 'error'
  }
  if (line.includes('[WARNING]') || line.includes('WARN')) return 'warn'
  return 'info'
}

export function appendLog(line: string) {
  const clean = stripAnsi(line).trimEnd()
  if (!clean) return
  state.logBuffer.push(clean)
  if (state.logBuffer.length > MAX_LOG_LINES) state.logBuffer.shift()
  state.logEmitter.emit('line', clean)
  // Mirror every ComfyUI terminal line into the persistent app log so the
  // Logs tab shows the full history (boot, updates, generation output) with
  // filtering and search — the ring buffer above only feeds the live overlay.
  log(inferLogLevel(clean), 'comfyui-server', clean)
}

export function getRecentLogs(n = 100): string[] {
  return state.logBuffer.slice(-n)
}

export function onLog(handler: (line: string) => void): () => void {
  state.logEmitter.on('line', handler)
  return () => state.logEmitter.off('line', handler)
}

export function clearLogs() {
  state.logBuffer.length = 0
}

// ---------------------------------------------------------------------------
// Lifecycle phase — server-side source of truth for the start/update/restart
// state machine, so the UI survives page reloads and never sticks on a stale
// client-only "starting…" / "updating…" state.
// ---------------------------------------------------------------------------
export function setPhase(phase: ComfyUIPhase, message: string | null = null) {
  state.phase = phase
  state.phaseMessage = message
  state.phaseSince = Date.now()
}

export function getPhase(): { phase: ComfyUIPhase; message: string | null; since: number } {
  return { phase: state.phase, message: state.phaseMessage, since: state.phaseSince }
}

// ---------------------------------------------------------------------------
// Update availability cache (filled by lib/comfyui/update-check.ts)
// ---------------------------------------------------------------------------
export function getUpdateCheck(): UpdateCheckState {
  return { ...state.updateCheck }
}

export function setUpdateCheck(patch: Partial<UpdateCheckState>) {
  Object.assign(state.updateCheck, patch)
}

// ---------------------------------------------------------------------------
// PID file
// ---------------------------------------------------------------------------
const PID_FILE = process.env.COMFYUI_PID_FILE ?? path.join(os.tmpdir(), 'raccoon-studio-comfyui.pid')

export function writePid(pid: number) {
  fs.writeFileSync(PID_FILE, String(pid), 'utf8')
}

export function readPid(): number | null {
  try {
    const n = parseInt(fs.readFileSync(PID_FILE, 'utf8').trim(), 10)
    return isNaN(n) ? null : n
  } catch {
    return null
  }
}

export function clearPid() {
  try { fs.unlinkSync(PID_FILE) } catch { /* ignore */ }
}

export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** Read the tracked PID, clearing the file if the process is no longer alive. */
export function readAlivePid(): number | null {
  const pid = readPid()
  if (pid === null) return null
  if (!isPidAlive(pid)) {
    clearPid()
    return null
  }
  return pid
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * Poll until `pid` is gone; returns false if it outlived `timeoutMs`.
 *
 * Termination is asynchronous on every platform — the kill call returns once
 * the request is queued, not once the tree has been reaped. A fixed sleep is
 * therefore always either too short (a busy box reports a successful stop as a
 * failure, and strands the PID file) or needlessly slow. Checking before the
 * first sleep keeps the common case immediate.
 */
export async function waitForExit(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    if (!isPidAlive(pid)) return true
    if (Date.now() >= deadline) return false
    await sleep(250)
  }
}

/**
 * Stop the tracked ComfyUI process. The child is spawned detached, so its PID
 * is also its process-group ID — signal the whole group, otherwise only the
 * start-script wrapper shell dies while the Python process keeps running.
 * Escalates to SIGKILL if the group is still alive after ~10s.
 *
 * Windows has no POSIX process groups (`kill(-pid)` is unsupported), and the
 * tracked PID is a `cmd.exe` wrapper whose ComfyUI python lives in a child
 * process. `taskkill /T` walks and terminates that whole tree; `/F` forces it.
 */
export async function stopTrackedProcess(): Promise<{ stopped: boolean; pid: number | null }> {
  const pid = readAlivePid()
  if (pid === null) return { stopped: true, pid: null }

  if (process.platform === 'win32') {
    try {
      spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' })
    } catch { /* already gone */ }
    const stopped = await waitForExit(pid, 10_000)
    if (stopped) clearPid()
    return { stopped, pid }
  }

  try {
    process.kill(-pid, 'SIGTERM')
  } catch {
    try { process.kill(pid, 'SIGTERM') } catch { /* already gone */ }
  }
  if (await waitForExit(pid, 10_000)) {
    clearPid()
    return { stopped: true, pid }
  }
  try { process.kill(-pid, 'SIGKILL') } catch { /* already gone */ }
  const stopped = await waitForExit(pid, 5_000)
  if (stopped) clearPid()
  return { stopped, pid }
}

// ---------------------------------------------------------------------------
// Start script path
// ---------------------------------------------------------------------------
export function getStartScriptPath(): string | null {
  if (process.env.COMFYUI_START_SCRIPT) return process.env.COMFYUI_START_SCRIPT
  return null
}

/**
 * Build the [command, args] that launches a ComfyUI start script. On Windows a
 * PowerShell (.ps1) script must run through powershell.exe — `cmd /c foo.ps1`
 * opens it in Notepad via the file association rather than executing it — while
 * .bat/.cmd go through cmd.exe (and forward slashes are normalised to back-
 * slashes for cmd). POSIX runs the executable script directly (the caller spawns
 * it with `shell: true`). Shared by the start and update (restart) routes; the
 * platform is injectable so both branches are testable on one OS.
 */
export function buildStartCommand(
  scriptPath: string,
  platform: NodeJS.Platform = process.platform,
): { cmd: string; args: string[] } {
  if (platform === 'win32') {
    const winPath = scriptPath.replace(/\//g, '\\')
    return /\.ps1$/i.test(winPath)
      ? { cmd: 'powershell.exe', args: ['-ExecutionPolicy', 'Bypass', '-NoProfile', '-File', winPath] }
      : { cmd: 'cmd.exe', args: ['/c', winPath] }
  }
  return { cmd: scriptPath, args: [] }
}

// ---------------------------------------------------------------------------
// ComfyUI install directory (for the Update button: git pull + pip install)
// ---------------------------------------------------------------------------
export function getComfyUIDir(): string | null {
  if (process.env.COMFYUI_DIR) return process.env.COMFYUI_DIR
  // Derive from the output/models dir: both live directly under the ComfyUI
  // install root (…/ComfyUI/output, …/ComfyUI/models).
  const fromOutput = process.env.COMFYUI_OUTPUT_DIR
  if (fromOutput) return path.dirname(fromOutput)
  const fromModels = process.env.COMFYUI_MODELS_DIR
  if (fromModels) return path.dirname(fromModels)
  return null
}
