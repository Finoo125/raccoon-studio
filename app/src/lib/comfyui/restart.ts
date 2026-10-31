import { toast } from 'sonner'

/**
 * Resolves once the engine answers again (after a restart, or a first start
 * that was still booting); throws after `timeoutMs` with words a person can act on.
 */
export async function waitForEngine(timeoutMs = 180_000, pollMs = 2000): Promise<void> {
  const until = Date.now() + timeoutMs
  while (Date.now() < until) {
    try {
      if ((await fetch('/api/comfyui/system_stats', { cache: 'no-store' })).ok) return
    } catch { /* still down */ }
    await new Promise((r) => setTimeout(r, pollMs))
  }
  throw new Error('The engine did not come back on its own — press Start on the status light at the top right.')
}

/**
 * ComfyUI's own queue holds a job (queued or rendering) that a restart would
 * kill — asked of the engine, so renders from any browser count and a job this
 * browser still believes is running after an engine crash cannot wait forever.
 * A dead or unreachable engine has nothing to protect.
 */
export async function engineRendering(): Promise<boolean> {
  try {
    const res = await fetch('/api/comfyui/queue', { cache: 'no-store' })
    if (!res.ok) return false
    const q = (await res.json()) as { queue_running?: unknown[]; queue_pending?: unknown[] }
    return (q.queue_running?.length ?? 0) + (q.queue_pending?.length ?? 0) > 0
  } catch {
    return false
  }
}

/**
 * Stop ComfyUI, then start it again — for whenever something lands on disk that
 * ComfyUI only reads at startup: newly downloaded model files, or a regenerated
 * `extra_model_paths.yaml` after a restore.
 *
 * Client-side on purpose: there is no restart route, and the two existing ones
 * already carry the guards that matter (stop waits for the process to actually
 * exit; start refuses to boot a second instance). The status pill picks the new
 * phase up on its next poll.
 *
 * Resolves `false` (after toasting why) if the stop or the start failed, `true` once the start was accepted.
 */
export async function restartComfyUI(): Promise<boolean> {
  const why = async (res: Response) =>
    ((await res.json().catch(() => ({}))) as { error?: string }).error ?? res.statusText

  const stop = await fetch('/api/comfyui-control/stop', { method: 'POST' })
  if (!stop.ok) {
    toast.error(`Could not stop ComfyUI: ${await why(stop)}`)
    return false
  }
  const start = await fetch('/api/comfyui-control/start', { method: 'POST' })
  if (!start.ok) {
    toast.error(`ComfyUI stopped, but would not start: ${await why(start)} — start it from the status bar.`)
    return false
  }
  toast.success('ComfyUI is restarting — the new files load once it is back online.')
  return true
}
