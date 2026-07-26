import { NextResponse, after } from 'next/server'
import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import {
  appendLog,
  clearLogs,
  clearPid,
  comfyUIServerPids,
  getComfyUIDir,
  getPhase,
  getStartScriptPath,
  readPid,
  setPhase,
  spawnComfyUI,
  stopComfyUI,
} from '@/lib/comfyui/server-state'
import { readPins, pinDir } from '@/lib/comfyui/pinned-versions'
import { getProjectRoot } from '@/lib/system/paths'
import { log } from '@/lib/logging/logger'

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
  // Process check, not HTTP: an instance that is still loading custom nodes is
  // not answering yet but very much running, and starting a second one on top of
  // it is the port conflict this guard exists to prevent.
  const running = comfyUIServerPids()
  if (running.length > 0) {
    const msg = `Another ComfyUI is still running (PID ${running.join(', ')}) — skipping restart to avoid a port conflict`
    appendLog(`[raccoon-studio] ${msg}`)
    setPhase('error', msg)
    return
  }
  appendLog(`[raccoon-studio] Restarting ComfyUI: ${scriptPath}`)
  const child = spawnComfyUI(scriptPath)
  const myPid = child.pid ?? null
  child.on('exit', (code: number | null) => {
    // code === null means killed by signal — i.e. an intentional stop.
    appendLog(code === null
      ? '[raccoon-studio] ComfyUI process stopped'
      : `[raccoon-studio] Process exited with code ${code}`)
    if (myPid !== null && readPid() === myPid) clearPid()
    if (getPhase().phase === 'restarting') {
      setPhase('error', `ComfyUI exited with code ${code ?? 'unknown'} after the repair — check the log`)
    }
  })
}

/**
 * Run a command to completion, streaming its output into the boot log.
 *
 * No shell: pin names and shas reach git as argv entries, never as a command
 * line. (`parsePins` also refuses anything that is not a 40-char hex sha, so a
 * manifest cannot smuggle a git flag through here either.)
 */
function run(cmd: string, args: string[]): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    const pipe = (chunk: Buffer) => String(chunk).split('\n').filter(Boolean).forEach(appendLog)
    child.stdout?.on('data', pipe)
    child.stderr?.on('data', pipe)
    child.on('error', (err: Error) => {
      appendLog(`[raccoon-studio] ${cmd} failed to start: ${err.message}`)
      resolve(-1)
    })
    child.on('exit', (code: number | null) => resolve(code ?? -1))
  })
}

/**
 * Move one clone onto its pinned revision. Mirrors `Set-PinnedRev` in
 * install-windows.ps1 / install-linux.sh, deliberately — the installer and this
 * button must land an install in the same state.
 */
async function pinOne(dir: string, sha: string, name: string): Promise<boolean> {
  // Shallow-fetching the one object is what keeps this quick, but it needs the
  // host to allow fetching an arbitrary sha — GitHub does, Codeberg (ReActor)
  // is not guaranteed to — so fall back to full history rather than giving up.
  if ((await run('git', ['-C', dir, 'fetch', '--depth=1', 'origin', sha])) !== 0) {
    appendLog(`[raccoon-studio] ${name}: shallow fetch failed — retrying with full history`)
    await run('git', ['-C', dir, 'fetch', '--unshallow', 'origin'])
    await run('git', ['-C', dir, 'fetch', 'origin'])
  }
  // Detached on purpose: a branch here would just drift again on the next pull.
  if ((await run('git', ['-C', dir, 'checkout', '-f', '--detach', sha])) !== 0) {
    appendLog(`[raccoon-studio] ${name}: could not pin to ${sha} — left on its current revision`)
    return false
  }
  appendLog(`[raccoon-studio] ${name} → ${sha.slice(0, 8)}`)
  return true
}

/**
 * Reset ComfyUI and every pinned custom node to the revisions in
 * installer/pinned-versions.txt.
 *
 * Non-fatal per pack, matching the installer: one pack that will not pin warns
 * and the rest still get repaired. ComfyUI core is the exception — a half-pinned
 * core is worse than an untouched one, so a failure there aborts.
 *
 * Returns false only when core was attempted and failed.
 */
async function syncToPins(comfyuiDir: string): Promise<boolean> {
  const pins = readPins()
  if (pins.length === 0) {
    appendLog('[raccoon-studio] No pins found in installer/pinned-versions.txt — nothing to re-apply')
    return true
  }
  appendLog(`[raccoon-studio] Re-applying ${pins.length} tested versions from installer/pinned-versions.txt`)
  let coreOk = true
  for (const { name, sha } of pins) {
    const dir = pinDir(name, comfyuiDir)
    if (!fs.existsSync(path.join(dir, '.git'))) {
      // Not installed, or not a clone (vendored packs are plain directories).
      appendLog(`[raccoon-studio] ${name}: no git checkout at ${dir} — skipping`)
      continue
    }
    const ok = await pinOne(dir, sha, name)
    if (!ok && name === 'ComfyUI') coreOk = false
  }
  return coreOk
}

/**
 * Re-copy the node packs vendored in this repo. They carry no git history, so
 * the pin loop cannot touch them, but they are just as much part of the tested
 * set — the video workflow refuses to run without RaccoonVideoNodes. Mirrors
 * `Copy-VendorPack` in the installers.
 */
function restoreVendorPacks(comfyuiDir: string) {
  const src = path.join(getProjectRoot(), 'comfyui', 'vendor-custom-nodes')
  let names: string[]
  try {
    names = fs.readdirSync(src)
  } catch {
    appendLog(`[raccoon-studio] No vendored packs at ${src} — skipping`)
    return
  }
  for (const name of names) {
    const from = path.join(src, name)
    if (!fs.statSync(from).isDirectory()) continue
    try {
      fs.cpSync(from, path.join(comfyuiDir, 'custom_nodes', name), { recursive: true, force: true })
      appendLog(`[raccoon-studio] Restored vendored pack ${name}`)
    } catch (err) {
      appendLog(`[raccoon-studio] ${name}: vendored copy failed — ${String(err)}`)
    }
  }
}

async function runRepair(comfyuiDir: string) {
  // ComfyUI genuinely has to be down first: checking out over a running install
  // leaves half-swapped files (and on Windows, locked ones), and starting a
  // second instance on a busy port is how this silently "succeeds" while the old
  // process keeps serving. stopComfyUI covers both a tracked PID and — the
  // normal case — one the launcher started, which the app never tracked.
  appendLog('[raccoon-studio] Stopping ComfyUI before the repair…')
  const { stopped, pid } = await stopComfyUI()
  if (!stopped) {
    const msg = 'Could not stop ComfyUI — something else is holding its port. Stop it manually, then retry'
    appendLog(`[error] ${msg}`)
    log('error', 'system', `ComfyUI repair aborted: ${msg}`)
    setPhase('error', msg)
    return
  }
  appendLog(`[raccoon-studio] ComfyUI stopped${pid !== null ? ` (PID ${pid})` : ''}`)

  const coreOk = await syncToPins(comfyuiDir)
  if (!coreOk) {
    const msg = 'ComfyUI itself could not be reset to its tested revision — check the log, then re-run the installer'
    appendLog(`[error] ${msg}`)
    log('error', 'system', `ComfyUI repair failed: ${msg}`)
    setPhase('error', msg)
    return
  }
  restoreVendorPacks(comfyuiDir)

  appendLog('[raccoon-studio] Tested versions re-applied. Restarting ComfyUI…')
  log('info', 'system', 'ComfyUI re-pinned to installer/pinned-versions.txt')
  setPhase('restarting')
  await restartComfyUI()
}

/**
 * Reset the ComfyUI install to the versions this release was tested against.
 *
 * This is a repair, not an update: it never fetches a newer Raccoon Studio and
 * never moves anything past its pin. Getting *new* versions is the launcher's
 * Update button, which pulls the release repo and re-runs the installer — that
 * is the only path that should ever change what `pinned-versions.txt` says.
 *
 * It replaces a call to ComfyUI-Manager's `cm-cli.py update all`, which pulled
 * ComfyUI core and every custom node to whatever master happened to be that day
 * — undoing the pins on a shipped install and reproducing precisely the
 * overnight breakage the manifest exists to prevent.
 *
 * Flow: stop the running instance (and wait for its port to free up) → check
 * out every pinned sha → re-copy the vendored packs → restart ComfyUI. Output
 * streams to the shared boot-log ring buffer so the UI can follow progress over
 * SSE, and progress is tracked in the server-side phase state
 * (updating → restarting → idle) that the detect endpoint reports.
 */
export async function POST() {
  const { phase } = getPhase()
  if (phase === 'updating' || phase === 'restarting') {
    return NextResponse.json({ error: 'A repair is already in progress' }, { status: 409 })
  }

  const dir = getComfyUIDir()
  if (!dir) {
    return NextResponse.json(
      { error: 'ComfyUI directory not found. Set COMFYUI_DIR (or COMFYUI_OUTPUT_DIR) in .env.local' },
      { status: 400 },
    )
  }

  clearLogs()
  setPhase('updating')
  appendLog(`[raccoon-studio] Re-applying tested versions in ${dir}`)
  log('info', 'system', `ComfyUI repair started (re-pin to manifest) in ${dir}`)

  // The stop → repair → restart pipeline runs after the response so the client
  // can immediately attach to the log stream and follow the phase via detect.
  after(() => runRepair(dir))

  return NextResponse.json({ ok: true })
}
