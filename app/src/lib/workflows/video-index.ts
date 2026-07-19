import { ltx23Workflow } from './ltx23'
import type { VideoWorkflowDefinition } from '@/types/video-workflow'

export const videoWorkflows: VideoWorkflowDefinition[] = [ltx23Workflow]

export function getVideoWorkflow(id: string): VideoWorkflowDefinition | undefined {
  return videoWorkflows.find((w) => w.id === id)
}
