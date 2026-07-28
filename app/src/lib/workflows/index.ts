import { animaWorkflow, animaTurboWorkflow } from './anima'
import { ernieTurboWorkflow } from './ernie-turbo'
import { krea2TurboWorkflow, krea2RawWorkflow } from './krea2'
import { zImageTurboWorkflow } from './z-image-turbo'
import { sdxlWorkflow, ponyWorkflow, illustriousWorkflow } from './sdxl'
import { applyTiledVaeDecode } from './tiled-vae'
import { applyExpertSampler } from './expert-sampler'
import type { WorkflowDefinition } from '@/types/workflow'

/**
 * Render-wide options are layered on here instead of being copy-pasted into every
 * builder: tiled VAE decode and Expert Mode are properties of the render, not of
 * any one model family. Wrapping at registration means a family added to the list
 * below gets both for free and cannot forget them — the failure mode of the
 * per-builder alternative, where the one family nobody updated is also the one
 * that OOMs on an 8 GB card.
 *
 * Order is immaterial: the two passes touch disjoint nodes (VAEDecode vs KSampler).
 */
function withRenderOptions(workflow: WorkflowDefinition): WorkflowDefinition {
  return {
    ...workflow,
    buildPrompt: (params) =>
      applyExpertSampler(applyTiledVaeDecode(workflow.buildPrompt(params), params), params),
  }
}

export const workflows: WorkflowDefinition[] = [
  animaWorkflow,
  animaTurboWorkflow,
  ernieTurboWorkflow,
  krea2TurboWorkflow,
  krea2RawWorkflow,
  zImageTurboWorkflow,
  sdxlWorkflow,
  ponyWorkflow,
  illustriousWorkflow,
].map(withRenderOptions)

export function getWorkflow(id: string): WorkflowDefinition | undefined {
  return workflows.find((w) => w.id === id)
}
