import { animaWorkflow, animaTurboWorkflow } from './anima'
import { ernieTurboWorkflow } from './ernie-turbo'
import { krea2TurboWorkflow, krea2RawWorkflow } from './krea2'
import { zImageTurboWorkflow } from './z-image-turbo'
import { sdxlWorkflow, ponyWorkflow, illustriousWorkflow } from './sdxl'
import { applyTiledVaeDecode } from './tiled-vae'
import type { WorkflowDefinition } from '@/types/workflow'

/**
 * Tiled VAE decode is a property of the render, not of any one model family, so
 * it is layered on here instead of being copy-pasted into every builder. Wrapping
 * at registration means a family added to the list below gets it for free and
 * cannot forget it — the failure mode of the per-builder alternative, where the
 * one family nobody updated is also the one that OOMs on an 8 GB card.
 */
function withTiledVaeDecode(workflow: WorkflowDefinition): WorkflowDefinition {
  return {
    ...workflow,
    buildPrompt: (params) => applyTiledVaeDecode(workflow.buildPrompt(params), params),
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
].map(withTiledVaeDecode)

export function getWorkflow(id: string): WorkflowDefinition | undefined {
  return workflows.find((w) => w.id === id)
}
