import { describe, it, expect } from 'vitest'
import { ltx23DirectorWorkflow } from './ltx23-director'
import { emptyTimeline, type DirectorTimeline } from './director-timeline'
import type { VideoGenerationParams } from '@/types/video-workflow'
import type { ComfyUIPromptNode } from '@/types/comfyui'

type Wf = Record<string, ComfyUIPromptNode>

const build = (over: Partial<VideoGenerationParams> = {}) =>
  ltx23DirectorWorkflow.buildPrompt({
    prompt: 'a raccoon dancing in the rain',
    mode: 'director',
    orientation: 'landscape',
    durationSeconds: 3,
    fps: 30,
    seed: 42,
    ...over,
  }) as unknown as Wf

const byClass = (wf: Wf, cls: string) =>
  Object.values(wf).filter((n) => n.class_type === cls)

/** Every link target that does not exist in the graph. */
function dangling(wf: Wf): string[] {
  const out: string[] = []
  for (const [id, n] of Object.entries(wf)) {
    for (const [k, v] of Object.entries(n.inputs)) {
      if (Array.isArray(v) && v.length === 2 && typeof v[0] === 'string' && !(v[0] in wf)) {
        out.push(`${id}.${k} -> ${v[0]}`)
      }
    }
  }
  return out
}

const timeline: DirectorTimeline = {
  ...emptyTimeline(3, 30),
  globalPrompt: 'cinematic daylight',
  segments: [
    { id: 'a', startSec: 0, lengthSec: 1.5, prompt: 'a red car' },
    { id: 'b', startSec: 1.5, lengthSec: 1.5, prompt: 'the car turns' },
  ],
}

describe('ltx23DirectorWorkflow.buildPrompt', () => {
  it('feeds the serialized timeline into LTXDirector', () => {
    const [d] = byClass(build({ timeline }), 'LTXDirector')
    expect(d.inputs.local_prompts).toBe('a red car|the car turns')
    expect(d.inputs.segment_lengths).toBe('45,46')
    expect(d.inputs.global_prompt).toBe('cinematic daylight')
    expect(JSON.parse(d.inputs.timeline_data as string).segments).toEqual([])
  })

  it('sizes the FIRST pass — half the delivered dimensions, still /32', () => {
    const dims = (o: string) => {
      const [d] = byClass(build({ orientation: o, timeline }), 'LTXDirector')
      return [d.inputs.custom_width, d.inputs.custom_height] as number[]
    }
    expect(dims('landscape')).toEqual([960, 544]) // delivers 1920x1088
    expect(dims('portrait')).toEqual([544, 960])
    expect(dims('square')).toEqual([512, 512])
    for (const o of ['landscape', 'portrait', 'square']) {
      for (const v of dims(o)) expect(v % 32).toBe(0)
    }
  })

  // Regression: with a keyframe present the node throws custom_width/height
  // away and takes the clip's latent size from the resized first keyframe.
  // Under 'maintain aspect ratio' a 1280x704 render silently delivered 704x704.
  describe('keyframe dimension handling', () => {
    const withKf = (width?: number, height?: number) => ({
      ...timeline,
      segments: [
        { ...timeline.segments[0], file: 'k.png', strength: 1, width, height },
        timeline.segments[1],
      ],
    })

    it('never asks for a resize method that fails to fill the box', () => {
      for (const p of [{ timeline }, { timeline: withKf(832, 1216) }, { timeline: withKf() }]) {
        const [d] = byClass(build(p), 'LTXDirector')
        expect(d.inputs.resize_method).not.toBe('maintain aspect ratio')
        expect(['crop', 'pad', 'pad green', 'stretch to fit']).toContain(d.inputs.resize_method)
      }
    })

    it('rejects an unknown fit rather than passing it through', () => {
      const [d] = byClass(
        build({ timeline, keyframeFit: 'maintain aspect ratio' as never }),
        'LTXDirector',
      )
      expect(d.inputs.resize_method).toBe('crop')
    })

    it('fits the render to the first keyframe aspect when its size is known', () => {
      const [d] = byClass(build({ timeline: withKf(832, 1216) }), 'LTXDirector')
      // portrait source -> portrait render, not the landscape orientation default
      expect(d.inputs.custom_height as number).toBeGreaterThan(d.inputs.custom_width as number)
      for (const v of [d.inputs.custom_width, d.inputs.custom_height]) expect((v as number) % 32).toBe(0)
    })

    it('uses the first picture in START order, matching the node', () => {
      const t: DirectorTimeline = {
        ...timeline,
        segments: [
          { id: 'late', startSec: 2, lengthSec: 1, prompt: '', file: 'l.png', strength: 1, width: 1920, height: 1080 },
          { id: 'early', startSec: 0, lengthSec: 1, prompt: '', file: 'e.png', strength: 1, width: 832, height: 1216 },
        ],
      }
      const [d] = byClass(build({ timeline: t }), 'LTXDirector')
      expect(d.inputs.custom_height as number).toBeGreaterThan(d.inputs.custom_width as number)
    })

    it('falls back to the orientation when keyframe size is unknown', () => {
      const [d] = byClass(build({ timeline: withKf(), orientation: 'landscape' }), 'LTXDirector')
      expect([d.inputs.custom_width, d.inputs.custom_height]).toEqual([960, 544])
    })
  })

  it('drops the pixel budget with the VRAM tier', () => {
    const [low] = byClass(build({ vramMode: 'low', timeline }), 'LTXDirector')
    expect([low.inputs.custom_width, low.inputs.custom_height]).toEqual([640, 352])
    const [chunk] = byClass(build({ vramMode: 'low', timeline }), 'LTXVChunkFeedForward')
    expect(chunk.inputs.chunks).toBe(3)
    expect(byClass(build({ timeline }), 'LTXVChunkFeedForward')[0].inputs.chunks).toBe(1)
  })

  it('carries duration and fps to the node and the value nodes', () => {
    const wf = build({ durationSeconds: 5, fps: 24, timeline })
    const [d] = byClass(wf, 'LTXDirector')
    expect(d.inputs.duration_frames).toBe(121)
    expect(d.inputs.end_frame).toBe(121)
    expect(d.inputs.duration_seconds).toBe(5)
    expect(d.inputs.frame_rate).toBe(24)
    expect(byClass(wf, 'JWFloat')[0].inputs.value).toBe(5)
    expect(byClass(wf, 'PrimitiveInt')[0].inputs.value).toBe(24)
  })

  it('maps the boundary knob to epsilon', () => {
    expect(byClass(build({ timeline }), 'LTXDirector')[0].inputs.epsilon).toBe(0.001)
    expect(
      byClass(build({ timeline, promptBoundary: 'soft' }), 'LTXDirector')[0].inputs.epsilon,
    ).toBe(0.5)
  })

  it('falls back to a single segment carrying prompt when no timeline is given', () => {
    const [d] = byClass(build(), 'LTXDirector')
    // No blocks at all is the node's own fast path: the whole clip on the
    // global prompt, no attention masking.
    expect(d.inputs.local_prompts).toBe('')
    expect(d.inputs.segment_lengths).toBe('')
    expect(d.inputs.global_prompt).toBe('a raccoon dancing in the rain')
  })

  it('resolves a negative seed to a concrete int', () => {
    const seed = byClass(build({ seed: -1, timeline }), 'Seed (rgthree)')[0].inputs.seed as number
    expect(Number.isInteger(seed)).toBe(true)
    expect(seed).toBeGreaterThanOrEqual(0)
  })
})

describe('media lanes', () => {
  const withMotion: DirectorTimeline = {
    ...timeline,
    motion: [{ id: 'm', startSec: 0, lengthSec: 2, trimStartSec: 0, file: 'ref.mp4' }],
  }

  it('arms the audio flag only when the lane has clips', () => {
    expect(byClass(build({ timeline }), 'LTXDirector')[0].inputs.use_custom_audio).toBe(false)
    const withAudio = {
      ...timeline,
      audio: [{ id: 'a', startSec: 0, lengthSec: 2, trimStartSec: 0, file: 'v.wav' }],
    }
    expect(
      byClass(build({ timeline: withAudio }), 'LTXDirector')[0].inputs.use_custom_audio,
    ).toBe(true)
  })

  // Motion segments do nothing without the IC-LoRA that reads them.
  it('only sets the IC-LoRA when motion clips exist AND one is chosen', () => {
    const lora = (p: Partial<VideoGenerationParams>) =>
      byClass(build(p), 'LTXDirectorGuide').map((g) => g.inputs.ic_lora_name)
    expect(lora({ timeline, motionIcLora: 'cam.safetensors' })).toEqual(['None', 'None'])
    expect(lora({ timeline: withMotion, motionIcLora: 'cam.safetensors' })).toEqual([
      'cam.safetensors',
      'cam.safetensors',
    ])
    expect(lora({ timeline: withMotion })).toEqual(['None', 'None'])
  })

  // The builder's node flags must agree with what the serializer emitted, or
  // the node waits on a track the timeline_data no longer contains.
  it('a switched-off lane disarms its node flag too', () => {
    const withAudio = {
      ...timeline,
      audio: [{ id: 'a', startSec: 0, lengthSec: 1, trimStartSec: 0, file: 'v.wav' }],
    }
    const flags = (t: DirectorTimeline) => {
      const [d] = byClass(build({ timeline: t }), 'LTXDirector')
      return [d.inputs.use_custom_audio, d.inputs.use_custom_motion]
    }
    expect(flags(withAudio)).toEqual([true, false])
    expect(flags({ ...withAudio, audioOn: false })).toEqual([false, false])
    expect(flags({ ...withMotion, motionOn: false })).toEqual([false, false])
  })

  it('drops the IC-LoRA when the motion lane is switched off', () => {
    const off = { ...withMotion, motionOn: false, motionIcLora: 'cam.safetensors' }
    expect(byClass(build({ timeline: off }), 'LTXDirectorGuide').map((g) => g.inputs.ic_lora_name))
      .toEqual(['None', 'None'])
  })

  it('takes the IC-LoRA off the timeline', () => {
    const t = { ...withMotion, motionIcLora: 'from-timeline.safetensors' }
    expect(byClass(build({ timeline: t }), 'LTXDirectorGuide')[0].inputs.ic_lora_name).toBe(
      'from-timeline.safetensors',
    )
  })

  it('passes the audio inpaint switch through', () => {
    expect(byClass(build({ timeline }), 'LTXDirector')[0].inputs.inpaint_audio).toBe(true)
    expect(
      byClass(build({ timeline: { ...timeline, audioInpaint: false } }), 'LTXDirector')[0].inputs
        .inpaint_audio,
    ).toBe(false)
  })

  it('flags retake mode on both guide passes', () => {
    const retake = {
      ...timeline,
      retake: { videoFile: 'p.mp4', startSec: 1, lengthSec: 1, videoDurationSec: 3 },
    }
    expect(byClass(build({ timeline: retake }), 'LTXDirectorGuide').map((g) => g.inputs.retake_mode))
      .toEqual([true, true])
    expect(byClass(build({ timeline }), 'LTXDirectorGuide').map((g) => g.inputs.retake_mode))
      .toEqual([false, false])
  })
})

describe('LoRA stack', () => {
  it('always leads with DMD and appends user slots', () => {
    const wf = build({ timeline, lora1: 'style.safetensors', lora1Strength: 0.7 })
    const rows = JSON.parse(byClass(wf, 'RaccoonLoraStack')[0].inputs.stack_data as string)
    expect(rows[0].lora).toContain('DMD')
    expect(rows.at(-1)).toMatchObject({ lora: 'style.safetensors', str: 0.7 })
  })

  it('omits unset and None slots', () => {
    const wf = build({ timeline, lora1: 'None', lora2: undefined })
    expect(JSON.parse(byClass(wf, 'RaccoonLoraStack')[0].inputs.stack_data as string)).toHaveLength(1)
  })
})

describe('FaceID', () => {
  const kf: DirectorTimeline = {
    ...timeline,
    segments: [{ ...timeline.segments[0], file: 'face.png', strength: 1 }, timeline.segments[1]],
  }

  it('is absent unless asked for', () => {
    expect(byClass(build({ timeline: kf }), 'RaccoonLTXFaceIdentity')).toHaveLength(0)
  })

  it('inserts a reinforcer per pass, referencing the first keyframe', () => {
    const wf = build({ timeline: kf, faceId: true })
    const ids = byClass(wf, 'RaccoonLTXFaceIdentity')
    expect(ids).toHaveLength(2)
    expect(byClass(wf, 'LoadImage')[0].inputs.image).toBe('face.png')
    for (const n of ids) expect(n.inputs.reference_image).toEqual(['faceid_ref', 0])
    // and it joins the LoRA stack
    const rows = JSON.parse(byClass(wf, 'RaccoonLoraStack')[0].inputs.stack_data as string)
    expect(rows.at(-1).lora).toContain('FaceID')
  })

  it('rewires every NAG node onto the reinforcer', () => {
    const wf = build({ timeline: kf, faceId: true })
    for (const nag of byClass(wf, 'LTX2_NAG')) {
      const src = (nag.inputs.model as [string, number])[0]
      expect(wf[src].class_type).toBe('RaccoonLTXFaceIdentity')
    }
  })

  it('honours the explicit reference override', () => {
    const wf = build({ timeline: kf, faceId: true, faceIdImage: 'other.png' })
    expect(byClass(wf, 'LoadImage')[0].inputs.image).toBe('other.png')
  })

  // Director mode has no source image to fall back on.
  it('is skipped with no keyframe and no override', () => {
    expect(byClass(build({ timeline, faceId: true }), 'RaccoonLTXFaceIdentity')).toHaveLength(0)
  })
})

describe('output branch', () => {
  it('seed hunt drops the upscale branch outputs', () => {
    const wf = build({ timeline, seedHunt: true })
    expect(byClass(wf, 'VHS_PruneOutputs')).toHaveLength(0)
    expect(byClass(wf, 'VHS_VideoCombine').filter((n) => n.inputs.save_output === true)).toHaveLength(0)
    // the first-pass combine that writes the candidate survives
    expect(byClass(wf, 'VHS_VideoCombine')).toHaveLength(1)
  })

  it('rife:false removes the node and reroutes the saving combine', () => {
    const on = build({ timeline })
    const rife = byClass(on, 'RIFEInterpolation')[0]
    const off = build({ timeline, rife: false })
    expect(byClass(off, 'RIFEInterpolation')).toHaveLength(0)
    const save = byClass(off, 'VHS_VideoCombine').find((n) => n.inputs.save_output === true)!
    expect(save.inputs.images).toEqual(rife.inputs.images)
    expect(save.inputs.frame_rate).toEqual(rife.inputs.source_fps)
  })

  it('writes under the Director filename prefix', () => {
    const save = byClass(build({ timeline }), 'VHS_VideoCombine').find(
      (n) => n.inputs.save_output === true,
    )!
    expect(save.inputs.filename_prefix).toContain('LTX23Director_')
  })
})

// The builder rewires the model chain in several branches; a dangling link is
// a 400 from ComfyUI at submit time, which is expensive to discover live.
describe('graph integrity', () => {
  const cases: [string, Partial<VideoGenerationParams>][] = [
    ['default', { timeline }],
    ['no timeline', {}],
    ['seed hunt', { timeline, seedHunt: true }],
    ['rife off', { timeline, rife: false }],
    ['low tier', { timeline, vramMode: 'low' }],
    [
      'faceid',
      {
        timeline: {
          ...timeline,
          segments: [{ ...timeline.segments[0], file: 'f.png', strength: 1 }, timeline.segments[1]],
        },
        faceId: true,
      },
    ],
    [
      'faceid + rife off + seed hunt',
      {
        timeline: {
          ...timeline,
          segments: [{ ...timeline.segments[0], file: 'f.png', strength: 1 }, timeline.segments[1]],
        },
        faceId: true,
        rife: false,
        seedHunt: true,
      },
    ],
  ]

  it.each(cases)('%s leaves no dangling links', (_name, params) => {
    expect(dangling(build(params))).toEqual([])
  })

  it.each(cases)('%s keeps every node reachable from a link or an output', (_name, params) => {
    const wf = build(params)
    // Nothing should reference a node id that was deleted mid-build.
    expect(dangling(wf)).toEqual([])
    expect(Object.keys(wf).length).toBeGreaterThan(50)
  })
})
