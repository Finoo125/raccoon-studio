import { NextResponse } from 'next/server'
import {
  appendLog,
  clearLogs,
  clearPid,
  comfyUIServerPids,
  readPid,
  readAlivePid,
  getStartScriptPath,
  getPhase,
  setPhase,
  spawnComfyUI,
} from '@/lib/comfyui/server-state'
import { log } from '@/lib/logging/logger'

export async function POST() {
  const scriptPath = getStartScriptPath()
  if (!scriptPath) {
    return NextResponse.json({ error: 'COMFYUI_START_SCRIPT is not set in .env.local' }, { status: 400 })
  }
  if (readAlivePid() !== null) {
    return NextResponse.json({ error: 'A tracked ComfyUI process is already running' }, { status: 409 })
  }
  // Process check, not just the tracked PID: the launcher is how ComfyUI
  // normally starts, so on an ordinary install there is no tracked PID at all
  // and the check above waves a second instance straight through. That costs a
  // ~45s boot that dies on "Port 8188 is already in use" — and worse, the
  // duplicate's ComfyUI-Manager prestartup pip-installs into the same venv as
  // the live instance. Catch onnxruntime mid-reinstall and its directory has no
  // __init__.py, so Python imports it as a PEP 420 namespace package with no
  // attributes; RaccoonSwapNodes then dies on `get_available_providers` and face
  // swap is silently gone for the whole session. Same guard the update route's
  // restart already uses. (Field-reported 2026-07-27.)
  const running = comfyUIServerPids()
  if (running.length > 0) {
    return NextResponse.json(
      { error: `ComfyUI is already running (PID ${running.join(', ')})` },
      { status: 409 },
    )
  }

  clearLogs()
  setPhase('starting')
  appendLog(`[raccoon-studio] Starting ComfyUI: ${scriptPath}`)
  log('info', 'system', `ComfyUI start requested: ${scriptPath}`)

  const child = spawnComfyUI(scriptPath)

  child.on('error', (err: Error) => {
    appendLog(`[raccoon-studio] Error: ${err.message}`)
    setPhase('error', err.message)
  })

  const myPid = child.pid ?? null
  child.on('exit', (code: number | null) => {
    // code === null means killed by signal — i.e. an intentional stop.
    appendLog(code === null
      ? '[raccoon-studio] ComfyUI process stopped'
      : `[raccoon-studio] Process exited with code ${code}`)
    if (myPid !== null && readPid() === myPid) clearPid()
    // Exiting while still booting means the start failed; exiting later (after
    // a Stop, or a crash while idle) is picked up by the detect poll instead.
    if (getPhase().phase === 'starting') {
      setPhase('error', `ComfyUI exited with code ${code ?? 'unknown'} before coming online`)
    }
  })

  return NextResponse.json({ ok: true, pid: child.pid ?? null })
}
