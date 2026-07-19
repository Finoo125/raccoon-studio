import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import {
  setDiscoveredBase,
  getStartScriptPath,
  readAlivePid,
  getComfyUIDir,
  getPhase,
  setPhase,
  appendLog,
} from '@/lib/comfyui/server-state'
import { maybeRefreshUpdateCheck } from '@/lib/comfyui/update-check'

const PORTS = [8188, 8189, 8190]
// How long a boot ('starting'/'restarting') or an update may stay offline
// before the phase is demoted to an error so the UI doesn't spin forever.
const BOOT_TIMEOUT_MS = 5 * 60_000
const UPDATE_TIMEOUT_MS = 30 * 60_000

function hasComfyUIGit(): boolean {
  const dir = getComfyUIDir()
  return !!dir && fs.existsSync(path.join(dir, '.git'))
}

async function probe(url: string, timeoutMs: number): Promise<boolean> {
  try {
    const res = await fetch(`${url}/system_stats`, {
      signal: AbortSignal.timeout(timeoutMs),
      cache: 'no-store',
    })
    return res.ok
  } catch {
    return false
  }
}

/** Reconcile the server-side lifecycle phase with the observed reality. */
function reconcilePhase(online: boolean) {
  const { phase, since } = getPhase()
  if (online) {
    // Boot finished, or a previous error is moot — ComfyUI is answering.
    // 'updating' is deliberately kept: the port can still answer briefly while
    // the update pipeline is shutting the old instance down.
    if (phase === 'starting' || phase === 'restarting' || phase === 'error') setPhase('idle')
    return
  }
  const age = Date.now() - since
  if ((phase === 'starting' || phase === 'restarting') && age > BOOT_TIMEOUT_MS) {
    const msg = 'ComfyUI did not come online within 5 minutes — check the boot log'
    setPhase('error', msg)
    appendLog(`[error] ${msg}`)
  } else if (phase === 'updating' && age > UPDATE_TIMEOUT_MS) {
    const msg = 'Update has been running for over 30 minutes — check the update log'
    setPhase('error', msg)
    appendLog(`[error] ${msg}`)
  }
}

export async function GET() {
  let url: string | null = null
  let online = false
  let source: 'env' | 'detected' | 'none' = 'none'
  let port: number | undefined

  // Env var wins
  if (process.env.COMFYUI_BASE_URL) {
    url = process.env.COMFYUI_BASE_URL
    online = await probe(url, 2000)
    source = 'env'
  } else {
    // Probe ports
    for (const p of PORTS) {
      const candidate = `http://127.0.0.1:${p}`
      if (await probe(candidate, 1000)) {
        setDiscoveredBase(candidate)
        url = candidate
        online = true
        port = p
        source = 'detected'
        break
      }
    }
  }

  reconcilePhase(online)
  const { phase, message } = getPhase()
  const { available: updateAvailable } = maybeRefreshUpdateCheck()

  return NextResponse.json({
    url,
    online,
    ...(port !== undefined ? { port } : {}),
    source,
    phase,
    phaseMessage: message,
    updateAvailable,
    hasStartScript: !!getStartScriptPath(),
    hasPid: readAlivePid() !== null,
    hasComfyUIDir: hasComfyUIGit(),
  })
}
