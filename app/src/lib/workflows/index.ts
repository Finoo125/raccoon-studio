import { animaWorkflow, animaTurboWorkflow } from './anima'
import { ernieTurboWorkflow } from './ernie-turbo'
import { zImageTurboWorkflow } from './z-image-turbo'
import { sdxlWorkflow, ponyWorkflow, illustriousWorkflow } from './sdxl'
import type { WorkflowDefinition } from '@/types/workflow'

export const workflows: WorkflowDefinition[] = [
  animaWorkflow,
  animaTurboWorkflow,
  ernieTurboWorkflow,
  zImageTurboWorkflow,
  sdxlWorkflow,
  ponyWorkflow,
  illustriousWorkflow,
]

export function getWorkflow(id: string): WorkflowDefinition | undefined {
  return workflows.find((w) => w.id === id)
}
