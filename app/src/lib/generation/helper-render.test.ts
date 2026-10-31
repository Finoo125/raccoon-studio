import { describe, it, expect } from 'vitest'
import { helperGraph, renderStatus, HELPER_FORM } from './helper-render'
import { H3_SPARSEREF, H3_EROS } from '@/lib/workflows/minimax-h3'

const payload = (params: Record<string, unknown> = {}) => ({
  v: 1, workflowId: 'minimax-h3',
  params: {
    mode: 'ref2v', h3Checkpoint: 'sparseref', durationSeconds: 10, orientation: 'portrait',
    refImages: ['video-helper/p0.png', 'video-helper/p1.png', 'video-helper/face.png'],
    refImageRoles: ['character', 'character', 'face'], prompt: 'For the target video …',
    keyframes: { start: { image: 'video-helper/p0.png', width: 736, height: 1344 }, end: { image: 'video-helper/p1.png', width: 736, height: 1344 } },
    ...params,
  },
})
const nodes = (g: object) => Object.values(g) as { class_type: string; inputs: Record<string, unknown> }[]

describe('helperGraph', () => {
  it('builds a SparseRef15 reference loop at the full canvas with both pictures as guides', () => {
    const r = helperGraph(payload({ seed: 324481168041 }))
    if ('error' in r) throw new Error(r.error)
    expect(r.seed).toBe(324481168041)
    expect(nodes(r.graph).find((n) => n.class_type === 'RandomNoise')!.inputs.noise_seed).toBe(324481168041)
    // 10 s = h3FrameCount(10) = 243 frames, so the end guide sits on frame 242.
    expect(nodes(r.graph).filter((n) => n.class_type === 'MiniMaxH3AddGuide').map((n) => n.inputs.frame_idx)).toEqual([0, 242])
    const cond = nodes(r.graph).find((n) => n.class_type === 'MiniMaxH3ReferenceToVideo')!
    expect([cond.inputs.width, cond.inputs.height]).toEqual([736, 1344])
    expect(r.files).toEqual({ unet: H3_SPARSEREF.ckpt, loras: [H3_SPARSEREF.lora.name] })
  })

  it('draws a seed when the payload has none, and reports it', () => {
    const r = helperGraph(payload(), () => 777)
    if ('error' in r) throw new Error(r.error)
    expect(r.seed).toBe(777)
  })

  it('renders an explicit clip on 10Eros with MysticXXX', () => {
    const r = helperGraph(payload({ h3Checkpoint: 'eros', loras: [{ name: 'MysticXXX_MMH3-V4.safetensors', strength: 1 }] }))
    if ('error' in r) throw new Error(r.error)
    expect(r.files).toEqual({ unet: H3_EROS.ckpt, loras: ['MysticXXX_MMH3-V4.safetensors'] })
  })

  it('renders with the sampler the helper asks for, else the checkpoint\'s own (helper tests 2026-10-18: lcm on 10Eros)', () => {
    const sampler = (p: Record<string, unknown>) => {
      const r = helperGraph(payload(p))
      if ('error' in r) throw new Error(r.error)
      return nodes(r.graph).find((n) => n.class_type === 'KSamplerSelect')!.inputs.sampler_name
    }
    expect(sampler({ h3Checkpoint: 'eros', sampler: 'lcm' })).toBe('lcm')
    expect(sampler({ h3Checkpoint: 'eros' })).toBe(H3_EROS.sampler)
    expect(helperGraph(payload({ sampler: 'dpmpp_2m; rm -rf' }))).toEqual({ error: 'Invalid helper payload' })
  })

  it('uses the harness form values (no realism LoRA, single shot)', () => {
    expect(HELPER_FORM).toMatchObject({ realismLora: false, singleShot: true, turbo: false, rife: false })
  })

  it('refuses a payload the handoff would refuse', () => {
    expect(helperGraph({ v: 1, workflowId: 'minimax-h3', params: { mode: 't2v' } })).toEqual({ error: 'Invalid helper payload' })
    expect(helperGraph({ v: 2 })).toEqual({ error: 'Invalid helper payload' })
  })
})

describe('renderStatus', () => {
  it('is unknown for an id ComfyUI has never seen', () => {
    expect(renderStatus(undefined, false)).toEqual({ status: 'unknown', files: [] })
  })
  it('is queued while ComfyUI still lists it and has no history', () => {
    expect(renderStatus(undefined, true)).toEqual({ status: 'queued', files: [] })
  })
  it('lists the saved video relative to the output folder when done', () => {
    const entry = { status: { completed: true, status_str: 'success' }, outputs: { '15': { images: [{ filename: 'x_00001_.mp4', subfolder: 'video/MinimaxH3/2026-10-17', type: 'output' }] } } }
    expect(renderStatus(entry, false)).toEqual({ status: 'done', files: ['video/MinimaxH3/2026-10-17/x_00001_.mp4'] })
  })
  it('turns a Windows ComfyUI subfolder into / separators', () => {
    // As ComfyUI on Windows reported the 2026-10-16 live render.
    const entry = { status: { completed: true, status_str: 'success' }, outputs: { '15': { images: [{ filename: 'x_00001_.mp4', subfolder: 'video\\MinimaxH3\\2026-10-16', type: 'output' }] } } }
    expect(renderStatus(entry, false).files).toEqual(['video/MinimaxH3/2026-10-16/x_00001_.mp4'])
  })
  it('reports a ComfyUI error with its message', () => {
    const entry = { status: { completed: false, status_str: 'error', messages: [['execution_error', { exception_message: 'CUDA out of memory' }]] }, outputs: {} }
    expect(renderStatus(entry as never, false)).toEqual({ status: 'error', files: [], error: 'CUDA out of memory' })
  })
})
