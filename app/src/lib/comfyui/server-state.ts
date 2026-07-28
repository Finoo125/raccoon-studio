import { EventEmitter } from 'events'
import { spawn, spawnSync, type ChildProcess, type SpawnOptions } from 'child_process'
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
interface SharedState {
  discoveredBase: string | null
  logBuffer: string[]
  logEmitter: EventEmitter
  phase: ComfyUIPhase
  phaseMessage: string | null
  phaseSince: number
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

/**
 * ComfyUI's port from its configured base URL, or null if that URL yields no
 * usable one. `comfyuiBaseUrl` is editable in Settings, and the port is
 * interpolated into a shell command below — so this is a trust boundary, not a
 * formality. Anything that is not a plain port number is refused outright.
 */
export function getComfyUIPort(): number | null {
  let raw: string
  try {
    raw = new URL(getComfyUIBase()).port
  } catch {
    return null
  }
  if (raw === '') return 8188 // default port, omitted from the URL
  if (!/^\d+$/.test(raw)) return null
  const port = Number(raw)
  return port > 0 && port <= 65535 ? port : null
}

/**
 * Stop whatever is listening on ComfyUI's port, tracked or not.
 *
 * `stopTrackedProcess` can only stop a process this app started. The normal way
 * to run Raccoon Studio is the launcher, which starts ComfyUI itself — so on a
 * typical install there is no tracked PID at all, and anything that needs
 * ComfyUI actually stopped (the repair) would otherwise just give up.
 *
 * Same mechanism as stop.ps1: find the listener on the port and kill it. The
 * port comes from our own configured base URL and is re-validated as an integer
 * before it reaches a shell, since the Windows branch needs one.
 */
export async function stopComfyUIByPort(): Promise<boolean> {
  const port = getComfyUIPort()
  if (port === null) return false

  try {
    if (process.platform === 'win32') {
      spawnSync(
        'powershell.exe',
        ['-NoProfile', '-Command',
          `Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | ` +
          `ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }`],
        { stdio: 'ignore', timeout: 15_000 },
      )
    } else {
      // fuser is not everywhere; lsof covers the rest. Either failing is fine —
      // the caller decides what to do based on whether the port actually freed.
      spawnSync('sh', ['-c', `fuser -k ${port}/tcp || lsof -ti tcp:${port} | xargs -r kill -9`], {
        stdio: 'ignore',
        timeout: 15_000,
      })
    }
  } catch {
    return false
  }
  clearPid()
  return true
}

/**
 * PIDs of ComfyUI server processes — serving *or* still booting — belonging to
 * THIS install.
 *
 * Liveness must not be inferred from HTTP. ComfyUI spends a minute or more
 * loading custom nodes before it binds its port, so "not answering" covers both
 * "stopped" and "still starting". Conflating those is how a repair ended up
 * checking out revisions underneath a booting ComfyUI and then skipping the
 * restart because the thing it thought it had stopped came up mid-run.
 *
 * "This install" is not a detail: stopComfyUI() KILLS whatever this returns.
 * The previous match ('*ComfyUI*main.py*' on Windows, `pgrep -f ComfyUI/main.py`
 * on POSIX) was far too broad for that. It hit any ComfyUI on the box — a second
 * install, ComfyUI Desktop — so Stop could kill a stranger's session, and Start
 * refused because someone else's ComfyUI was up. Worse on POSIX, where pgrep -f
 * matches ANY process: an editor or a grep holding that path on its command line
 * was a kill target.
 */
export function comfyUIMainPath(): string | null {
  const dir = getComfyUIDir()
  return dir ? path.join(dir, 'main.py') : null
}

/**
 * Does this command line belong to THIS install's ComfyUI?
 *
 * Windows only ever hands us one command-line string (CIM has no argv), so the
 * best available test is a substring — normalised, because Windows paths are
 * case-insensitive and mix separators, and comparing them raw silently misses.
 * POSIX gets the exact-argv treatment in the caller instead.
 */
export function matchesComfyUIMain(
  cmdline: string,
  mainPy: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  if (!cmdline || !mainPy) return false
  const norm = (s: string) =>
    platform === 'win32' ? s.toLowerCase().replace(/\//g, '\\') : s
  return norm(cmdline).includes(norm(mainPy))
}

/** POSIX: read argv straight from /proc — no subprocess, and exact elements. */
function procComfyUIPids(mainPy: string): number[] {
  let entries: string[]
  try { entries = fs.readdirSync('/proc') } catch { return [] }
  const pids: number[] = []
  for (const entry of entries) {
    const pid = Number(entry)
    if (!Number.isInteger(pid) || pid <= 0) continue
    let raw: string
    try { raw = fs.readFileSync(`/proc/${entry}/cmdline`, 'utf8') } catch { continue }
    const argv = raw.split('\0').filter(Boolean)
    // argv[0] must be a python, and main.py must be an argument in its own
    // right — not merely a substring somewhere in the line.
    if (!argv.length || !path.basename(argv[0]).toLowerCase().startsWith('python')) continue
    if (argv.slice(1).includes(mainPy)) pids.push(pid)
  }
  return pids
}

/** Windows: one CIM call, matched in JS so no path is interpolated into PowerShell. */
function windowsComfyUIPids(mainPy: string): number[] {
  const script =
    `Get-CimInstance Win32_Process -Filter "Name='python.exe' OR Name='pythonw.exe'" | ` +
    `ForEach-Object { "$($_.ProcessId)|$($_.CommandLine)" }`
  let stdout = ''
  try {
    stdout = String(
      spawnSync('powershell.exe', ['-NoProfile', '-Command', script], {
        encoding: 'utf8',
        timeout: 15_000,
      }).stdout ?? '',
    )
  } catch { return [] }
  const pids: number[] = []
  for (const line of stdout.split('\n')) {
    const sep = line.indexOf('|')
    if (sep < 0) continue
    const pid = Number(line.slice(0, sep).trim())
    if (!Number.isInteger(pid) || pid <= 0) continue
    if (matchesComfyUIMain(line.slice(sep + 1), mainPy, 'win32')) pids.push(pid)
  }
  return pids
}

export function comfyUIServerPids(): number[] {
  const mainPy = comfyUIMainPath()
  if (!mainPy) return []
  return process.platform === 'win32' ? windowsComfyUIPids(mainPy) : procComfyUIPids(mainPy)
}

function killPid(pid: number) {
  if (process.platform === 'win32') {
    try { spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' }) } catch { /* gone */ }
    return
  }
  try { process.kill(-pid, 'SIGKILL') } catch {
    try { process.kill(pid, 'SIGKILL') } catch { /* gone */ }
  }
}

/**
 * Stop ComfyUI however it was started, and confirm it is actually gone.
 *
 * Tracked PID first — a clean process-group kill for an instance this app
 * spawned — then the port, then any ComfyUI process still standing. The launcher
 * is how ComfyUI normally starts, so there is usually no tracked PID at all;
 * treating that as "cannot stop" left both the Stop button and the repair unable
 * to touch an ordinary install.
 *
 * `stopped` means no ComfyUI process remains, verified by looking for one — not
 * inferred from the port going quiet, which is also true of one that is booting.
 */
export async function stopComfyUI(timeoutMs = 30_000): Promise<{ stopped: boolean; pid: number | null }> {
  const { pid } = await stopTrackedProcess()

  // Without a known install path we cannot identify this install's processes, so
  // an empty scan means "don't know", not "nothing is running". Do the two things
  // that need no identification and say so, rather than reporting a stop we never
  // verified — or spinning to the timeout waiting for a scan that always returns
  // empty.
  if (!comfyUIMainPath()) {
    await stopComfyUIByPort()
    return { stopped: true, pid }
  }

  if (comfyUIServerPids().length === 0) return { stopped: true, pid }

  await stopComfyUIByPort()
  for (const p of comfyUIServerPids()) killPid(p)

  const deadline = Date.now() + timeoutMs
  for (;;) {
    if (comfyUIServerPids().length === 0) return { stopped: true, pid }
    if (Date.now() >= deadline) return { stopped: false, pid }
    await sleep(500)
  }
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

/**
 * Launch ComfyUI from its start script, streaming output into the boot log and
 * tracking the PID. Callers attach their own `exit`/`error` handling.
 *
 * `detached` is POSIX-only, deliberately. On Linux it puts the child in its own
 * process group so stopTrackedProcess can signal the whole tree. On Windows the
 * same flag means DETACHED_PROCESS — the child gets no console, and
 * powershell.exe then exits 0 within ~100ms *without running the script*. That
 * failure is completely silent: no output, no error, just an immediate clean
 * exit that reads as "the start script did nothing". Windows kills the tree via
 * `taskkill /T` instead, so detaching buys it nothing anyway.
 */
export function comfyUISpawnOptions(platform: NodeJS.Platform = process.platform): SpawnOptions {
  return {
    detached: platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: platform !== 'win32',
    windowsHide: true,
  }
}

export function spawnComfyUI(scriptPath: string): ChildProcess {
  const { cmd, args } = buildStartCommand(scriptPath)
  const child = spawn(cmd, args, comfyUISpawnOptions())
  const pipe = (chunk: Buffer) => String(chunk).split('\n').filter(Boolean).forEach(appendLog)
  child.stdout?.on('data', pipe)
  child.stderr?.on('data', pipe)
  child.unref()
  if (child.pid) writePid(child.pid)
  return child
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
