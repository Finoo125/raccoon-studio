import { ltx23Workflow } from './ltx23'
import { ltx23DirectorWorkflow } from './ltx23-director'
import { minimaxH3Workflow } from './minimax-h3'
import type { VideoGenerationParams, VideoWorkflowDefinition } from '@/types/video-workflow'

export const videoWorkflows: VideoWorkflowDefinition[] = [
  ltx23Workflow,
  ltx23DirectorWorkflow,
  minimaxH3Workflow,
]

export function getVideoWorkflow(id: string): VideoWorkflowDefinition | undefined {
  return videoWorkflows.find((w) => w.id === id)
}

/**
 * Is this workflow the LTX 2.3 graph?
 *
 * Several form features exist only in that graph's builder — the seed hunt, RIFE
 * interpolation, FaceID identity lock, the stabilised-motion LoRA and the four
 * LoRA stack slots. `minimax-h3.ts` reads none of them, so offering them there
 * shows knobs that do nothing (and, for the seed hunt, silently multiplies the
 * render cost). Director rides the same LTX graph, so it counts.
 */
export function isLtxWorkflow(id: string | undefined): boolean {
  return id === 'ltx23' || id === 'ltx23-director'
}

/**
 * Does this workflow's builder make a seed-hunt candidate genuinely cheaper?
 *
 * Both current graphs do, by different means — LTX truncates after its half-res
 * first pass, H3 forces Turbo at 6 steps — but a builder that simply ignores
 * `seedHunt` would render N clips at full price while the UI promised cheap
 * previews. That already happened once with H3, so this stays an allowlist:
 * a new model has to opt in, not inherit the promise.
 */
export function supportsSeedHunt(id: string | undefined): boolean {
  return isLtxWorkflow(id) || id === 'minimax-h3'
}

/**
 * Promote a seed-hunt candidate to the real render.
 *
 * Two things must be written explicitly rather than inherited, and both have
 * bitten already: `seedHunt` off (that flag *is* what makes it a candidate),
 * and `turbo` — the H3 builder forces Draft on candidates whatever the form
 * said, so a promotion that merely left `turbo` alone would ship a draft as the
 * keeper. The speed is the caller's choice at pick time, not the candidate's.
 */
export function promoteSeedHunt(
  params: VideoGenerationParams,
  turbo: VideoGenerationParams['turbo'],
): VideoGenerationParams {
  return { ...params, seedHunt: false, turbo }
}
