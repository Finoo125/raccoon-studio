import type { GenerationParams } from '@/types/workflow'

/** ControlNet reference mode (shared by the SDXL and Z-Image control paths). */
export type ControlNetMode = NonNullable<GenerationParams['controlNet']>['mode']

/**
 * Per-mode `comfyui_controlnet_aux` preprocessor class name. The user uploads a
 * plain photo; this node extracts the control map for the chosen mode. Class
 * names depend on the installed comfyui_controlnet_aux version — this is the
 * single point of adjustment (confirm against object_info in e2e). Shared by
 * `appendControlNet` (SDXL) and `appendZImageControlNet` (Z-Image).
 */
export const CN_PREPROCESSOR: Record<ControlNetMode, string> = {
  pose: 'OpenposePreprocessor',
  depth: 'DepthAnythingV2Preprocessor',
  canny: 'CannyEdgePreprocessor',
  scribble: 'ScribblePreprocessor',
}
