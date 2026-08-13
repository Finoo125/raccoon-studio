import { toast } from 'sonner'

/**
 * Stop ComfyUI, then start it again — for whenever something lands on disk that
 * ComfyUI only reads at startup: newly downloaded model files, or a regenerated
 * `extra_model_paths.yaml` after a restore.
 *
 * Client-side on purpose: there is no restart route, and the two existing ones
 * already carry the guards that matter (stop waits for the process to actually
 * exit; start refuses to boot a second instance). The status pill picks the new
 * phase up on its next poll.
 */
export async function restartComfyUI(): Promise<void> {
  const why = async (res: Response) =>
    ((await res.json().catch(() => ({}))) as { error?: string }).error ?? res.statusText

  const stop = await fetch('/api/comfyui-control/stop', { method: 'POST' })
  if (!stop.ok) {
    toast.error(`Could not stop ComfyUI: ${await why(stop)}`)
    return
  }
  const start = await fetch('/api/comfyui-control/start', { method: 'POST' })
  if (!start.ok) {
    toast.error(`ComfyUI stopped, but would not start: ${await why(start)} — start it from the status bar.`)
    return
  }
  toast.success('ComfyUI is restarting — the new files load once it is back online.')
}
