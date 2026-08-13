import { useQueueStore, type GenerationJob } from './queue'

/**
 * Stop the given video jobs: interrupt whatever ComfyUI is running, drop the
 * still-queued prompts, and mark them cancelled locally so the websocket handlers
 * ignore the late interrupt frames.
 *
 * Marking happens in `finally` — a dead ComfyUI must still leave the UI in a
 * terminal state, or the form is stuck showing Cancel forever. The error then
 * propagates so the caller owns the toast.
 *
 * Two callers: the video form's Cancel button, and picking a seed-hunt candidate
 * (which abandons the rest — otherwise the real render queues behind candidates
 * already rejected, which is the whole point of picking early).
 */
export async function cancelVideoJobs(jobs: GenerationJob[]): Promise<void> {
  const active = jobs.filter((j) => j.status === 'pending' || j.status === 'running')
  if (active.length === 0) return

  try {
    await fetch('/api/comfyui/interrupt', { method: 'POST' })
    // A running job's prompt has already left the queue — only pending ids can
    // be deleted, and an empty delete list is a pointless round trip.
    const pendingIds = active.filter((j) => j.status === 'pending').map((j) => j.promptId)
    if (pendingIds.length > 0) {
      await fetch('/api/comfyui/queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ delete: pendingIds }),
      })
    }
  } finally {
    const { updateJob } = useQueueStore.getState()
    for (const j of active) {
      if (j.livePreview) URL.revokeObjectURL(j.livePreview)
      updateJob(j.id, {
        status: 'cancelled',
        endedAt: Date.now(),
        livePreview: undefined,
        previewVideo: undefined,
      })
    }
  }
}
