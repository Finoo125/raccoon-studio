'use client'

import { useEffect } from 'react'
import { toast } from 'sonner'
import { useQueueStore } from '@/lib/comfyui/queue'
import { useGenerationWebSocket } from '@/lib/comfyui/useGenerationWebSocket'
import { buildRerunPrompt } from '@/lib/comfyui/rerun'
import { submitPrompt } from '@/lib/comfyui/submit'
import type { JobRecord } from '@/lib/queue/history'

/**
 * The single owner of the ComfyUI generation websocket for the whole studio
 * shell. Mounted once in the (studio) layout so jobs progress on every page.
 * Also hydrates persisted job history on mount. Renders nothing.
 */
export default function QueueProvider() {
  // The one and only generation websocket connection for the app shell.
  useGenerationWebSocket()

  const hydrateHistory = useQueueStore((s) => s.hydrateHistory)
  const addJob = useQueueStore((s) => s.addJob)

  // Hydrate persisted history once on mount so past generations survive reloads.
  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch('/api/queue/history')
        const { jobs } = (await res.json()) as { jobs: JobRecord[] }
        hydrateHistory(jobs)
      } catch { /* offline — skip */ }
    })()
  }, [hydrateHistory])

  // Re-run and remove listeners wired here (single owner of window events).
  useEffect(() => {
    const onRerun = async (e: Event) => {
      const id = (e as CustomEvent<string>).detail
      const job = useQueueStore.getState().jobs.find((j) => j.id === id)
      if (!job) return
      try {
        const { prompt, workflowName } = buildRerunPrompt({
          kind: job.kind,
          workflowId: job.workflowId,
          generationParams: job.generationParams,
        })
        const prompt_id = await submitPrompt({
          prompt,
          client_id: useQueueStore.getState().clientId,
          extra_data: { preview_method: 'auto' },
        })
        addJob(prompt_id, job.workflowId, workflowName, job.prompt, job.generationParams, job.kind)
      } catch (err) {
        toast.error(`Re-run failed: ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    const onRemove = (e: Event) => {
      const id = (e as CustomEvent<string>).detail
      void fetch(`/api/queue/history?id=${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => {})
    }

    window.addEventListener('queue:rerun', onRerun as EventListener)
    window.addEventListener('queue:remove', onRemove as EventListener)
    return () => {
      window.removeEventListener('queue:rerun', onRerun as EventListener)
      window.removeEventListener('queue:remove', onRemove as EventListener)
    }
  }, [addJob])

  return null
}
