import { NextResponse } from 'next/server'
import { readAlivePid, stopComfyUI, appendLog, setPhase } from '@/lib/comfyui/server-state'
import { log } from '@/lib/logging/logger'

export async function POST() {
  // A tracked PID is a nice-to-have, not a precondition. The launcher starts
  // ComfyUI on a normal install, so there usually isn't one — this used to 404
  // and leave the user with no way to stop ComfyUI from the app at all.
  const pid = readAlivePid()
  const what = pid ? `PID ${pid}` : 'the process holding its port'
  appendLog(`[raccoon-studio] Stopping ComfyUI (${what})`)
  log('info', 'system', `ComfyUI stop requested (${what})`)
  // Reset the phase before signalling so the child's exit handler doesn't
  // mistake an intentional stop for a failed boot.
  setPhase('idle')

  const { stopped } = await stopComfyUI()
  if (!stopped) {
    return NextResponse.json(
      { error: `ComfyUI (${what}) did not exit — try again or stop it manually` },
      { status: 500 },
    )
  }
  return NextResponse.json({ ok: true })
}
