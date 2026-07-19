import type { VideoGenerationParams } from '@/types/video-workflow'
import type { DirectorRun } from '@/types/director'
import { ltx23Workflow } from '@/lib/workflows/ltx23'

/**
 * Build the LTX 2.3 image-to-video params for one beat. The clip is seeded by
 * `seedImageFilename` (a file already in ComfyUI's input dir — the opening image
 * for beat 0, or the previous clip's extracted last frame) and runs for the run's
 * fixed clip length. LoRAs are left to the ltx23 defaults.
 */
export function buildBeatVideoParams(
  run: DirectorRun,
  beatIndex: number,
  seedImageFilename: string,
  seedDims?: { w: number; h: number },
): VideoGenerationParams {
  const d = ltx23Workflow.defaultParams
  return {
    prompt: run.beats[beatIndex]?.videoPrompt ?? '',
    mode: 'i2v',
    inputImage: seedImageFilename,
    inputImageWidth: seedDims?.w,
    inputImageHeight: seedDims?.h,
    durationSeconds: run.clipSeconds,
    fps: d.fps ?? 30,
    seed: -1,
  }
}

export interface ComfyViewRef {
  filename: string
  subfolder: string
  type: string
}

/** Parse a `/api/comfyui/view?...` URL back into its ComfyUI file descriptor. */
export function parseComfyViewUrl(url: string): ComfyViewRef | null {
  const q = url.indexOf('?')
  if (q < 0) return null
  const sp = new URLSearchParams(url.slice(q + 1))
  const filename = sp.get('filename')
  if (!filename) return null
  return {
    filename,
    subfolder: sp.get('subfolder') ?? '',
    type: sp.get('type') ?? 'output',
  }
}
