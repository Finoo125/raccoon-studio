import { NextResponse } from 'next/server'
import { spawn } from 'child_process'
import {
  appendLog,
  buildStartCommand,
  clearLogs,
  clearPid,
  writePid,
  readPid,
  readAlivePid,
  getStartScriptPath,
  getPhase,
  setPhase,
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

  clearLogs()
  setPhase('starting')
  appendLog(`[raccoon-studio] Starting ComfyUI: ${scriptPath}`)
  log('info', 'system', `ComfyUI start requested: ${scriptPath}`)

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

  child.unref()

  if (child.pid) writePid(child.pid)

  return NextResponse.json({ ok: true, pid: child.pid ?? null })
}
