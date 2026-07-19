import { NextResponse, after } from 'next/server'
import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import {
  appendLog,
  buildStartCommand,
  clearLogs,
  clearPid,
  getComfyUIBase,
  getComfyUIDir,
  getPhase,
  getStartScriptPath,
  readPid,
  setPhase,
  setUpdateCheck,
  stopTrackedProcess,
  writePid,
} from '@/lib/comfyui/server-state'
import { log } from '@/lib/logging/logger'

/**
 * Locate the Python interpreter bundled with the ComfyUI install. ComfyUI-Manager
 * relies on the packages installed in that virtualenv, so we must invoke it with
 * the venv interpreter rather than a system Python.
 */
function findVenvPython(dir: string): string | null {
  const isWin = process.platform === 'win32'
  const candidates = isWin
    ? [path.join(dir, '.venv', 'Scripts', 'python.exe'), path.join(dir, 'venv', 'Scripts', 'python.exe')]
    : [path.join(dir, '.venv', 'bin', 'python'), path.join(dir, 'venv', 'bin', 'python')]
  return candidates.find((p) => fs.existsSync(p)) ?? null
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

async function isComfyUIAnswering(): Promise<boolean> {
  try {
    const res = await fetch(`${getComfyUIBase()}/system_stats`, {
      signal: AbortSignal.timeout(1500),
      cache: 'no-store',
    })
    return res.ok
  } catch {
    return false
  }
}

/** Wait until ComfyUI stops answering, so the update applies to a dead tree and the restart can bind its port. */
async function waitUntilOffline(timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!(await isComfyUIAnswering())) return true
    await sleep(1000)
  }
  return false
}

/**
 * Restart ComfyUI via the configured start script, mirroring the Start route so
 * output streams to the same boot-log ring buffer and the PID is tracked again.
 */
async function restartComfyUI() {
  const scriptPath = getStartScriptPath()
  if (!scriptPath) {
    const msg = 'No COMFYUI_START_SCRIPT configured — cannot auto-restart ComfyUI'
    appendLog(`[raccoon-studio] ${msg}`)
    setPhase('error', msg)
    return
  }
  if (await isComfyUIAnswering()) {
    const msg = 'Another ComfyUI instance is still answering — skipping restart to avoid a port conflict'
    appendLog(`[raccoon-studio] ${msg}`)
    setPhase('error', msg)
    return
  }
  appendLog(`[raccoon-studio] Restarting ComfyUI: ${scriptPath}`)
  const { cmd, args } = buildStartCommand(scriptPath)
  const child = spawn(cmd, args, {
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform !== 'win32',
  })
  child.stdout?.on('data', (chunk: Buffer) => {
    String(chunk).split('\n').filter(Boolean).forEach(appendLog)
  })
  child.stderr?.on('data', (chunk: Buffer) => {
    String(chunk).split('\n').filter(Boolean).forEach(appendLog)
  })
  const myPid = child.pid ?? null
  child.on('exit', (code: number | null) => {
    // code === null means killed by signal — i.e. an intentional stop.
    appendLog(code === null
      ? '[raccoon-studio] ComfyUI process stopped'
      : `[raccoon-studio] Process exited with code ${code}`)
    if (myPid !== null && readPid() === myPid) clearPid()
    if (getPhase().phase === 'restarting') {
      setPhase('error', `ComfyUI exited with code ${code ?? 'unknown'} after the update — check the log`)
    }
  })
  child.unref()
  if (child.pid) writePid(child.pid)
}

function runCmCliUpdate(python: string, cmCli: string, managerDir: string, dir: string) {
  const child = spawn(python, [cmCli, 'update', 'all'], {
    cwd: managerDir,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, COMFYUI_PATH: dir, PYTHONUNBUFFERED: '1' },
  })

  child.stdout?.on('data', (chunk: Buffer) => {
    String(chunk).split('\n').filter(Boolean).forEach(appendLog)
  })
  child.stderr?.on('data', (chunk: Buffer) => {
    String(chunk).split('\n').filter(Boolean).forEach(appendLog)
  })

  child.on('exit', (code: number | null) => {
    const ok = code === 0
    appendLog(`[raccoon-studio] cm-cli update all exited with code ${code ?? 'unknown'}`)
    appendLog(
      ok
        ? '[raccoon-studio] Update completed — ComfyUI core and all custom nodes are up to date. Restarting ComfyUI…'
        : `[raccoon-studio] Update reported errors (exit code ${code ?? 'unknown'}). Check the log above. Restarting ComfyUI anyway…`,
    )
    log(ok ? 'info' : 'warn', 'system', `ComfyUI update (cm-cli) finished with code ${code ?? 'unknown'}`)

    // Everything was just updated — mark up to date so the Update button hides
    // until the next periodic check finds something new.
    if (ok) setUpdateCheck({ available: false, checkedAt: Date.now() })

    // Restart ComfyUI at the end of every update so the user lands on a running
    // instance regardless of outcome.
    setPhase('restarting')
    void restartComfyUI()
  })

  child.on('error', (err: Error) => {
    appendLog(`[raccoon-studio] Update error: ${err.message}`)
    log('error', 'system', `ComfyUI update error: ${err.message}`)
    setPhase('error', err.message)
  })

  child.unref()
}

async function runUpdate(dir: string, managerDir: string, cmCli: string, python: string) {
  // Stop the tracked instance (whole process group) and wait until the port is
  // actually released — updating a live install and then starting a second
  // instance on a busy port is how updates silently "succeed" while the old
  // process keeps serving.
  const { stopped, pid } = await stopTrackedProcess()
  if (pid !== null) {
    appendLog(
      stopped
        ? `[raccoon-studio] Stopped running ComfyUI (PID ${pid}) before update`
        : `[raccoon-studio] ComfyUI (PID ${pid}) did not exit cleanly`,
    )
  }
  if (await isComfyUIAnswering()) {
    appendLog('[raccoon-studio] Waiting for ComfyUI to go offline…')
    if (!(await waitUntilOffline(20_000))) {
      const msg =
        'A ComfyUI instance is still running (probably started outside Raccoon Studio) — stop it manually, then retry the update'
      appendLog(`[error] ${msg}`)
      log('error', 'system', `ComfyUI update aborted: ${msg}`)
      setPhase('error', msg)
      return
    }
  }
  runCmCliUpdate(python, cmCli, managerDir, dir)
}

/**
 * Updates the ComfyUI install using ComfyUI-Manager's CLI "update all" command.
 * This saves a snapshot, updates ComfyUI core (git pull) and every custom node,
 * then repairs broken pip dependencies — far more reliable than a bare git pull.
 *
 * Flow: stop the running instance (and wait for its port to free up) → run
 * `cm-cli.py update all` → restart ComfyUI. Output streams to the shared boot-log
 * ring buffer so the UI can follow progress over SSE, and progress is tracked in
 * the server-side phase state (updating → restarting → idle) that the detect
 * endpoint reports.
 */
export async function POST() {
  const { phase } = getPhase()
  if (phase === 'updating' || phase === 'restarting') {
    return NextResponse.json({ error: 'An update is already in progress' }, { status: 409 })
  }

  const dir = getComfyUIDir()
  if (!dir) {
    return NextResponse.json(
      { error: 'ComfyUI directory not found. Set COMFYUI_DIR (or COMFYUI_OUTPUT_DIR) in .env.local' },
      { status: 400 },
    )
  }

  const managerDir = path.join(dir, 'custom_nodes', 'ComfyUI-Manager')
  const cmCli = path.join(managerDir, 'cm-cli.py')
  if (!fs.existsSync(cmCli)) {
    return NextResponse.json(
      { error: `ComfyUI-Manager not found at ${managerDir} — install it to enable "update all"` },
      { status: 400 },
    )
  }

  const python = findVenvPython(dir)
  if (!python) {
    return NextResponse.json(
      { error: `No Python virtualenv found under ${dir} (.venv / venv) — cannot run ComfyUI-Manager` },
      { status: 400 },
    )
  }

  clearLogs()
  setPhase('updating')
  appendLog(`[raccoon-studio] Updating ComfyUI via ComfyUI-Manager (update all) in ${dir}`)
  log('info', 'system', `ComfyUI update started (cm-cli update all) in ${dir}`)

  // The stop → update → restart pipeline runs after the response so the client
  // can immediately attach to the log stream and follow the phase via detect.
  after(() => runUpdate(dir, managerDir, cmCli, python))

  return NextResponse.json({ ok: true })
}
