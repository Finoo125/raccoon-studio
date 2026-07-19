import type { GenerationParams } from '@/types/workflow'
import type { DirectorRun } from '@/types/director'
import { getWorkflow } from '@/lib/workflows'

/**
 * Build the image-generation params for a run's opening still.
 *
 * The opening image only seeds clip 1 of the i2v chain (Phase 3 downscales it to
 * LTX's working resolution), so we generate a cheap, dependency-free 16:9 frame:
 * upscale + face-detailer are off. The prompt/negative come from the storyboard.
 */
export function buildOpeningImageParams(run: DirectorRun): GenerationParams {
  const wf = getWorkflow(run.imageModel)
  const ratio =
    wf?.aspectRatios.find((r) => r.label.includes('16:9')) ?? wf?.aspectRatios[0]
  return {
    prompt: run.openingImagePrompt,
    negativePrompt: run.negativePrompt,
    width: ratio?.width ?? 1344,
    height: ratio?.height ?? 768,
    seed: -1,
    batchSize: 1,
    upscale: false,
    detailer: false,
  }
}
