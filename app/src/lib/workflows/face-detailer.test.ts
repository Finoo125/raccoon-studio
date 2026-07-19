import { describe, it, expect } from 'vitest'
import { appendFaceDetailer } from './face-detailer'
import type { ComfyUIPrompt } from '@/types/comfyui'

function makeWf(): ComfyUIPrompt {
  return {
    '99': {
      class_type: 'SaveImage',
      inputs: { filename_prefix: 'test', images: ['decode', 0] },
    },
    decode: {
      class_type: 'VAEDecode',
      inputs: { samples: ['ksampler', 0], vae: ['ckpt', 2] },
    },
  }
}

const refs = {
  saveNodeId: '99',
  model: ['ckpt', 0] as [string, number],
  clip: ['ckpt', 1] as [string, number],
  vae: ['ckpt', 2] as [string, number],
  positive: ['pos', 0] as [string, number],
  negative: ['neg', 0] as [string, number],
  sampler: { steps: 30, cfg: 4, sampler_name: 'er_sde', scheduler: 'simple', denoise: 0.4 },
}

describe('appendFaceDetailer', () => {
  it('adds det:provider, det:sam, det:face nodes', () => {
    const wf = makeWf()
    appendFaceDetailer(wf, refs)
    expect(wf['det:provider'].class_type).toBe('UltralyticsDetectorProvider')
    expect(wf['det:provider'].inputs.model_name).toBe('bbox/face_yolov8m.pt')
    expect(wf['det:sam'].class_type).toBe('SAMLoader')
    expect(wf['det:sam'].inputs.model_name).toBe('sam_vit_b_01ec64.pth')
    expect(wf['det:face'].class_type).toBe('FaceDetailer')
  })

  it('wraps the prior SaveImage image source as the FaceDetailer image input', () => {
    const wf = makeWf()
    appendFaceDetailer(wf, refs)
    // The original source was ['decode', 0]; it should now be the FaceDetailer's image input.
    expect(wf['det:face'].inputs.image).toEqual(['decode', 0])
  })

  it('repoints SaveImage to the FaceDetailer output', () => {
    const wf = makeWf()
    appendFaceDetailer(wf, refs)
    expect(wf['99'].inputs.images).toEqual(['det:face', 0])
  })

  it('wires model/clip/vae/positive/negative from refs', () => {
    const wf = makeWf()
    appendFaceDetailer(wf, refs)
    expect(wf['det:face'].inputs.model).toEqual(['ckpt', 0])
    expect(wf['det:face'].inputs.clip).toEqual(['ckpt', 1])
    expect(wf['det:face'].inputs.vae).toEqual(['ckpt', 2])
    expect(wf['det:face'].inputs.positive).toEqual(['pos', 0])
    expect(wf['det:face'].inputs.negative).toEqual(['neg', 0])
  })

  it('wires bbox_detector from det:provider and sam_model_opt from det:sam', () => {
    const wf = makeWf()
    appendFaceDetailer(wf, refs)
    expect(wf['det:face'].inputs.bbox_detector).toEqual(['det:provider', 0])
    expect(wf['det:face'].inputs.sam_model_opt).toEqual(['det:sam', 0])
  })

  it('applies sampler fields from refs', () => {
    const wf = makeWf()
    appendFaceDetailer(wf, refs)
    expect(wf['det:face'].inputs.steps).toBe(30)
    expect(wf['det:face'].inputs.cfg).toBe(4)
    expect(wf['det:face'].inputs.sampler_name).toBe('er_sde')
    expect(wf['det:face'].inputs.scheduler).toBe('simple')
    expect(wf['det:face'].inputs.denoise).toBe(0.4)
  })

  it('composes correctly when SaveImage already points to an upscale node', () => {
    const wf = makeWf()
    // Simulate upscale already having repointed SaveImage.
    wf['99'].inputs.images = ['upscale_out', 0]
    appendFaceDetailer(wf, refs)
    // FaceDetailer wraps the upscale output, not the raw decode.
    expect(wf['det:face'].inputs.image).toEqual(['upscale_out', 0])
    expect(wf['99'].inputs.images).toEqual(['det:face', 0])
  })
})
