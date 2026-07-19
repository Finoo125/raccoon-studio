import { NextResponse } from 'next/server'
import { readAlivePid, stopTrackedProcess, appendLog, setPhase } from '@/lib/comfyui/server-state'
import { log } from '@/lib/logging/logger'

export async function POST() {
  const pid = readAlivePid()
  if (!pid) {
    return NextResponse.json({ error: 'No tracked ComfyUI process found' }, { status: 404 })
  }

  appendLog(`[raccoon-studio] Stopping ComfyUI (PID ${pid})`)
  log('info', 'system', `ComfyUI stop requested (PID ${pid})`)
  // Reset the phase before signalling so the child's exit handler doesn't
  // mistake an intentional stop for a failed boot.
  setPhase('idle')

  const { stopped } = await stopTrackedProcess()
  if (!stopped) {
    return NextResponse.json(
      { error: `ComfyUI (PID ${pid}) did not exit — try again or stop it manually` },
      { status: 500 },
    )
  }
  return NextResponse.json({ ok: true })
}
