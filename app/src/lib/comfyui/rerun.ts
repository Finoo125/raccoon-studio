import { workflows } from '@/lib/workflows'
import { videoWorkflows } from '@/lib/workflows/video-index'
import type { GenerationParams } from '@/types/workflow'
import type { VideoGenerationParams } from '@/types/video-workflow'

/** Rebuilds a ComfyUI prompt graph from a stored job record so it can be re-queued. */
export function buildRerunPrompt(rec: {
  kind: 'image' | 'video'
  workflowId: string
  generationParams: unknown
}): { prompt: unknown; workflowName: string } {
  if (rec.kind === 'video') {
    const wf = videoWorkflows.find((w) => w.id === rec.workflowId)
    if (!wf) throw new Error('Unknown workflow')
    return { prompt: wf.buildPrompt(rec.generationParams as VideoGenerationParams), workflowName: wf.name }
  }
  const wf = workflows.find((w) => w.id === rec.workflowId)
  if (!wf) throw new Error('Unknown workflow')
  return { prompt: wf.buildPrompt(rec.generationParams as GenerationParams), workflowName: wf.name }
}
