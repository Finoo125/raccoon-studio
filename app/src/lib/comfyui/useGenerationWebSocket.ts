'use client'

import { useEffect, useRef } from 'react'
import { useQueueStore } from './queue'
import { useConnectionStore } from './connection'
import { ComfyUIWebSocket } from './websocket'
import { resolveOutputMedia } from './output-media'
import { useStudioStore } from '@/lib/generation/studio-store'
import type { WSMessage } from '@/types/comfyui'
import type { JobRecord } from '@/lib/queue/history'

/** Best-effort append of a terminal job to the persisted history file. */
function persistHistory(rec: JobRecord) {
  void fetch('/api/queue/history', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(rec),
  }).catch(() => { /* history is best-effort — never blocks the UI */ })
}

function toRecord(job: ReturnType<typeof useQueueStore.getState>['jobs'][number]): JobRecord {
  return {
    id: job.id,
    promptId: job.promptId,
    kind: job.kind,
    workflowId: job.workflowId,
    workflowName: job.workflowName,
    prompt: job.prompt,
    generationParams: job.generationParams,
    status: job.status as JobRecord['status'],
    createdAt: job.createdAt,
    endedAt: job.endedAt,
    outputImages: job.outputImages,
    outputVideos: job.outputVideos,
    error: job.error,
  }
}

export function useGenerationWebSocket() {
  const { clientId, updateJob } = useQueueStore()
  const { wsBase } = useConnectionStore()
  const wsRef = useRef<ComfyUIWebSocket | null>(null)

  useEffect(() => {
    const ws = new ComfyUIWebSocket(clientId, wsBase)
    wsRef.current = ws
    ws.connect()

    const offMsg = ws.on((msg: WSMessage) => {
      const id = msg.data.prompt_id
      if (!id) return

      const job = useQueueStore.getState().jobs.find((j) => j.promptId === id)
      if (!job) return
      // A user-cancelled job is terminal; ignore any late frames (e.g. the
      // execution_error that an interrupt triggers) so it stays 'cancelled'.
      if (job.status === 'cancelled') return

      if (msg.type === 'execution_start') {
        updateJob(job.id, { status: 'running', startedAt: Date.now() })
      } else if (msg.type === 'progress') {
        updateJob(job.id, { progress: msg.data.value ?? 0, maxProgress: msg.data.max ?? 0 })
      } else if (msg.type === 'executing') {
        if (msg.data.node !== null) {
          updateJob(job.id, { currentNode: msg.data.node ?? null })
        }
      } else if (msg.type === 'executed') {
        const { urls, isVideo } = resolveOutputMedia(msg.data.output)
        // A workflow has several output nodes; only the one that produced media
        // for this job's kind matters. Ignore unrelated `executed` frames so a
        // video job's first-pass image preview node doesn't clobber the result.
        if (urls.length === 0) return
        if (job.kind === 'video' && !isVideo) return
        if (job.kind === 'image' && isVideo) return

        const currentJob = useQueueStore.getState().jobs.find((j) => j.promptId === id)
        if (currentJob?.livePreview) URL.revokeObjectURL(currentJob.livePreview)
        updateJob(job.id, {
          status: 'done',
          ...(isVideo ? { outputVideos: urls } : { outputImages: urls }),
          progress: job.maxProgress,
          endedAt: Date.now(),
          livePreview: undefined,
        })
        if (isVideo) {
          useStudioStore.getState().setActiveVideo(urls[0])
        } else {
          useStudioStore.getState().setActiveImage(urls[0])
        }
        const doneJob = useQueueStore.getState().jobs.find((j) => j.id === job.id)
        if (doneJob) persistHistory(toRecord(doneJob))
      } else if (msg.type === 'execution_error') {
        const currentJob = useQueueStore.getState().jobs.find((j) => j.promptId === id)
        if (currentJob?.livePreview) URL.revokeObjectURL(currentJob.livePreview)
        updateJob(job.id, {
          status: 'error',
          error: msg.data.exception_message,
          endedAt: Date.now(),
          livePreview: undefined,
        })
        const erroredJob = useQueueStore.getState().jobs.find((j) => j.id === job.id)
        if (erroredJob) persistHistory(toRecord(erroredJob))
      }
    })

    const offPreview = ws.onPreview((blob) => {
      const runningJob = useQueueStore.getState().jobs.find((j) => j.status === 'running')
      if (!runningJob) return
      if (runningJob.livePreview) URL.revokeObjectURL(runningJob.livePreview)
      const url = URL.createObjectURL(blob)
      updateJob(runningJob.id, { livePreview: url })
    })

    return () => {
      offMsg()
      offPreview()
      ws.disconnect()
    }
  }, [clientId, wsBase, updateJob])
}
