'use client'

import { useCallback, useState } from 'react'
import { useQueueStore } from '@/lib/comfyui/queue'
import { submitPrompt } from '@/lib/comfyui/submit'
import { awaitPromptOutputs } from '@/lib/comfyui/await-prompt'
import { comboOptions } from '@/lib/models/installed'
import {
  buildDetectFacesPrompt,
  buildDetectPictureFacesPrompt,
  isNoFaceError,
  buildVideoFaceSwapPrompt,
  OCCLUSION_OFF,
  VIDEO_SWAP_NODE,
  type SwapCharacter,
  type VideoFaceSwapOptions,
  type VideoSource,
} from '@/lib/workflows/video-face-swap'
import type { VideoGenerationParams } from '@/types/video-workflow'

/** One face the detector found, ready to show as a thumbnail. */
export interface DetectedFace {
  /** Crop filename in ComfyUI's input dir — what goes back in as `reference_N`. */
  filename: string
  /** Proxy URL for the thumbnail. */
  url: string
}

/** What the swap node reports about itself, read once when the dialog opens. */
export interface SwapCapabilities {
  /** False when RaccoonSwapNodes failed to import — the feature cannot work. */
  available: boolean
  /** Installed swapper filenames, best-for-video first as the node orders them. */
  swapModels: string[]
  /** Installed occlusion segmenters, `OCCLUSION_OFF` excluded. */
  occluders: string[]
}

const DETECT_NODE_ID = 'det:detect'

function viewUrl(i: { filename: string; subfolder: string; type: string }): string {
  const q = new URLSearchParams({ filename: i.filename, subfolder: i.subfolder, type: i.type })
  return `/api/comfyui/view?${q}`
}

/**
 * Drives the video face-swap picker: probe, detect, queue.
 *
 * Detection goes through `/history` polling rather than the generation
 * websocket. It takes about a second and produces no gallery output, so putting
 * it in the queue would show the user a "render" that is really a UI lookup —
 * while the swap itself, which takes minutes and writes a clip, does go in the
 * queue where it can be watched and cancelled.
 */
export function useVideoFaceSwap() {
  const [busy, setBusy] = useState(false)
  const clientId = useQueueStore((s) => s.clientId)
  const addJob = useQueueStore((s) => s.addJob)

  /**
   * What this install can actually do, read off `/object_info`.
   *
   * The same doctrine as every other model probe here: never offer a control
   * that names a file which is not on disk. ComfyUI rejects the whole prompt at
   * validation rather than degrading, and the user sees a bare "Generation
   * failed" with no clue which of their choices caused it.
   */
  const probe = useCallback(async (): Promise<SwapCapabilities> => {
    const empty: SwapCapabilities = { available: false, swapModels: [], occluders: [] }
    try {
      const res = await fetch(`/api/comfyui/object_info/${VIDEO_SWAP_NODE}`, { cache: 'no-store' })
      if (!res.ok) return empty
      const data = await res.json()
      if (!data?.[VIDEO_SWAP_NODE]) return empty
      return {
        available: true,
        swapModels: comboOptions(data, VIDEO_SWAP_NODE, 'swap_model'),
        // The node lists `off` first and then whatever is installed, so the
        // occluder download is discoverable without a second endpoint.
        occluders: comboOptions(data, VIDEO_SWAP_NODE, 'occlusion').filter((o) => o !== OCCLUSION_OFF),
      }
    } catch {
      return empty
    }
  }, [])

  /**
   * Run the detector on one frame and hand back the crops it wrote.
   * `position` is the scrubber's `currentTime / duration`.
   */
  const detectFaces = useCallback(
    async (clip: VideoSource, position: number, namePrefix: string): Promise<DetectedFace[]> => {
      setBusy(true)
      try {
        const prompt = buildDetectFacesPrompt({ clip, position, namePrefix })
        const promptId = await submitPrompt({ prompt, client_id: clientId })
        const outputs = await awaitPromptOutputs(promptId, { timeoutMs: 60_000 })
        return (outputs[DETECT_NODE_ID]?.images ?? []).map((i) => ({
          filename: i.filename,
          url: viewUrl(i),
        }))
      } finally {
        setBusy(false)
      }
    },
    [clientId],
  )

  /** Is there a face in this input/ picture? Edit's Person picture, before the swap is offered. */
  const detectPictureFace = useCallback(
    async (file: string): Promise<boolean> => {
      const prompt = buildDetectPictureFacesPrompt(file, 'edit_face')
      const promptId = await submitPrompt({ prompt, client_id: clientId, front: true })
      try {
        // Queued at the front, but still behind the render ComfyUI is running —
        // an edit takes minutes — so wait as long as one can take.
        const outputs = await awaitPromptOutputs(promptId, { timeoutMs: 30 * 60_000 })
        return (outputs[DETECT_NODE_ID]?.images ?? []).length > 0
      } catch (e) {
        if (isNoFaceError(e)) return false
        throw e
      }
    },
    [clientId],
  )

  /** Queue the swap. Returns the prompt id; the queue takes it from there. */
  const swapFaces = useCallback(
    async (clip: VideoSource, characters: SwapCharacter[], options: VideoFaceSwapOptions = {}) => {
      setBusy(true)
      try {
        const refs = { clip, characters, ...options }
        const promptId = await submitPrompt({
          prompt: buildVideoFaceSwapPrompt(refs),
          client_id: clientId,
        })
        const label = characters
          .map((c) => (c.faceModel ?? c.sourceImage ?? '').replace(/\.[a-z0-9]+$/i, ''))
          .filter(Boolean)
          .join(', ')
        // Registered as a video job so it lands in the queue and the gallery
        // rescan like any render. Its params are the swap refs rather than
        // render params: this is not a workflow the video registry knows, so
        // Rerun on it reports an unknown workflow instead of quietly rebuilding
        // something else. Re-running a swap means reopening the picker.
        addJob(
          promptId,
          'video-face-swap',
          'Face swap',
          label ? `Face swap — ${label}` : 'Face swap',
          refs as unknown as VideoGenerationParams,
          'video',
        )
        return promptId
      } finally {
        setBusy(false)
      }
    },
    [clientId, addJob],
  )

  return { busy, probe, detectFaces, detectPictureFace, swapFaces }
}
