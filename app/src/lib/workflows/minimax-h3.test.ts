import { describe, it, expect } from 'vitest'
import {
  minimaxH3Workflow,
  h3FrameCount,
  h3Dims,
  BUDGET_MP,
  tierOf,
  H3_FPS,
  ORIENTATIONS,
  H3_STEPS,
  H3_TURBO_LORA,
  H3_RIFE_FPS,
  H3_TURBO_STRENGTH,
  H3_GRAIN_INTENSITY,
  H3_REF2VA_CKPT,
  H3_REF_BUDGET,
  h3RefCount,
  compactRefs,
} from './minimax-h3'
import type { VideoGenerationParams } from '@/types/video-workflow'
import type { ComfyUIPromptNode } from '@/types/comfyui'

const base = (over: Partial<VideoGenerationParams> = {}): VideoGenerationParams => ({
  prompt: 'a raccoon operating a film camera',
  mode: 't2v',
  orientation: 'landscape',
  durationSeconds: 5,
  fps: H3_FPS,
  seed: 42,
  ...over,
})

const build = (over: Partial<VideoGenerationParams> = {}) =>
  minimaxH3Workflow.buildPrompt(base(over)) as unknown as Record<string, ComfyUIPromptNode>

/** Every `[nodeId, slot]` reference in the graph must point at a node that exists. */
function danglingLinks(wf: Record<string, ComfyUIPromptNode>): string[] {
  const bad: string[] = []
  for (const [id, node] of Object.entries(wf)) {
    for (const [key, value] of Object.entries(node.inputs)) {
      if (Array.isArray(value) && typeof value[0] === 'string' && !wf[value[0]]) {
        bad.push(`${id}.${key} -> ${value[0]}`)
      }
    }
  }
  return bad
}

const nodeOf = (wf: Record<string, ComfyUIPromptNode>, cls: string) =>
  Object.values(wf).find((n) => n.class_type === cls)

describe('h3FrameCount', () => {
  it('matches the official template formula at 5 s', () => {
    // The docs and the Turbo README both quote 124 frames ≈ 5 s.
    expect(h3FrameCount(5)).toBe(124)
  })

  it('always lands on the 17k+5 grid', () => {
    for (let s = 1; s <= 15; s++) expect(h3FrameCount(s) % 17).toBe(5)
  })

  it('never returns fewer than the 5-frame floor', () => {
    expect(h3FrameCount(0)).toBeGreaterThanOrEqual(5)
    expect(h3FrameCount(0.01)).toBeGreaterThanOrEqual(5)
  })

  it('rounds up to the grid rather than down, so a clip is never short', () => {
    for (let s = 1; s <= 15; s++) {
      const raw = Math.max(5, Math.round(s * H3_FPS))
      expect(h3FrameCount(s)).toBeGreaterThanOrEqual(raw)
    }
  })

  it('agrees with the ComfyMathExpression it replaces, under Python modulo', () => {
    // max(5, round(a * 24)) + (5 - (max(5, round(a * 24)) % 17)) % 17
    //
    // Evaluated the way ComfyMath evaluates it — Python's `%` floors, so it is
    // never negative for a positive divisor. Transcribing this with JavaScript's
    // `%` silently shortens the clip; that is what this reference guards.
    const pyMod = (n: number, m: number) => ((n % m) + m) % m
    const reference = (a: number) => {
      const r = Math.max(5, Math.round(a * 24))
      return r + pyMod(5 - pyMod(r, 17), 17)
    }
    for (let s = 1; s <= 15; s += 0.5) expect(h3FrameCount(s)).toBe(reference(s))
    // The case that exposed the difference: JS gives 22, Python gives 39.
    expect(h3FrameCount(1)).toBe(39)
  })
})

describe('h3Dims', () => {
  it('snaps both sides to a multiple of 32', () => {
    for (const o of ORIENTATIONS) {
      for (const mp of Object.values(BUDGET_MP)) {
        const { w, h } = h3Dims(o.aspect, mp)
        expect(w % 32).toBe(0)
        expect(h % 32).toBe(0)
      }
    }
  })

  it('respects the model canvas: short edge ≤768, long edge ≤1344', () => {
    for (const o of ORIENTATIONS) {
      for (const mp of [...Object.values(BUDGET_MP), 4]) {
        const { w, h } = h3Dims(o.aspect, mp)
        expect(Math.min(w, h)).toBeLessThanOrEqual(768)
        expect(Math.max(w, h)).toBeLessThanOrEqual(1344)
      }
    }
  })

  it('keeps the requested aspect within a snap step', () => {
    for (const o of ORIENTATIONS) {
      const { w, h } = h3Dims(o.aspect, BUDGET_MP.low)
      expect(Math.abs(w / h - o.aspect)).toBeLessThan(0.12)
    }
  })

  it('lands near ComfyUI’s own 0.4 MP default for 16:9', () => {
    const { w, h } = h3Dims(16 / 9, 0.4)
    expect((w * h) / (1024 * 1024)).toBeGreaterThan(0.3)
    expect((w * h) / (1024 * 1024)).toBeLessThan(0.5)
  })

  it('grows with the budget', () => {
    const low = h3Dims(16 / 9, BUDGET_MP.low)
    const high = h3Dims(16 / 9, BUDGET_MP.high)
    expect(high.w * high.h).toBeGreaterThan(low.w * low.h)
  })
})

describe('tierOf', () => {
  it('falls back to the documented default for unknown or legacy values', () => {
    expect(tierOf(undefined)).toBe('low')
    expect(tierOf('ultra')).toBe('low')
    expect(tierOf('high')).toBe('high')
    expect(tierOf('medium')).toBe('medium')
  })
})

describe('minimaxH3Workflow.buildPrompt', () => {
  it('leaves no dangling links in either mode', () => {
    expect(danglingLinks(build({ mode: 't2v' }))).toEqual([])
    expect(
      danglingLinks(build({ mode: 'i2v', inputImage: 'src.png', inputImageWidth: 1024, inputImageHeight: 1024 })),
    ).toEqual([])
  })

  it('drops the image loader and the first_frame link for t2v', () => {
    const wf = build({ mode: 't2v' })
    expect(nodeOf(wf, 'LoadImage')).toBeUndefined()
    expect(nodeOf(wf, 'MiniMaxH3ImageToVideo')!.inputs.first_frame).toBeUndefined()
  })

  it('wires the source image for i2v', () => {
    const wf = build({ mode: 'i2v', inputImage: 'src.png' })
    expect(nodeOf(wf, 'LoadImage')!.inputs.image).toBe('src.png')
    expect(nodeOf(wf, 'MiniMaxH3ImageToVideo')!.inputs.first_frame).toBeDefined()
  })

  it('falls back to t2v framing when i2v has no uploaded image', () => {
    // A half-filled form must not emit a LoadImage pointing at the placeholder
    // filename baked into the base graph.
    const wf = build({ mode: 'i2v' })
    expect(nodeOf(wf, 'LoadImage')).toBeUndefined()
    expect(danglingLinks(wf)).toEqual([])
  })

  it('fits the render to the source aspect for i2v', () => {
    const wf = build({ mode: 'i2v', inputImage: 's.png', inputImageWidth: 1920, inputImageHeight: 1080 })
    const c = nodeOf(wf, 'MiniMaxH3ImageToVideo')!.inputs
    expect((c.width as number) / (c.height as number)).toBeCloseTo(16 / 9, 1)
  })

  it('carries the prompt and the snapped frame count onto the conditioning node', () => {
    const c = nodeOf(build({ durationSeconds: 5 }), 'MiniMaxH3ImageToVideo')!.inputs
    expect(c.prompt).toBe('a raccoon operating a film camera')
    expect(c.length).toBe(124)
  })

  it('pins the clip to 24 fps regardless of the requested rate', () => {
    // H3's flow schedule and frame grid are both defined against 24; honouring a
    // 30 fps request would change the clip's duration, not its smoothness.
    expect(nodeOf(build({ fps: 30 }), 'CreateVideo')!.inputs.fps).toBe(H3_FPS)
  })

  it('honours a fixed seed and randomises a negative one', () => {
    expect(nodeOf(build({ seed: 12345 }), 'RandomNoise')!.inputs.noise_seed).toBe(12345)
    const a = nodeOf(build({ seed: -1 }), 'RandomNoise')!.inputs.noise_seed as number
    const b = nodeOf(build({ seed: -1 }), 'RandomNoise')!.inputs.noise_seed as number
    expect(a).toBeGreaterThanOrEqual(0)
    expect(a).not.toBe(b)
  })

  it('scales the render with the VRAM tier', () => {
    const px = (t: 'low' | 'high') => {
      const c = minimaxH3Workflow.buildPrompt(base({ vramMode: t })) as unknown as Record<string, ComfyUIPromptNode>
      const i = nodeOf(c, 'MiniMaxH3ImageToVideo')!.inputs
      return (i.width as number) * (i.height as number)
    }
    expect(px('high')).toBeGreaterThan(px('low'))
  })

  it('does not mutate the base workflow between builds', () => {
    build({ mode: 't2v' })
    const second = build({ mode: 'i2v', inputImage: 'src.png' })
    expect(nodeOf(second, 'LoadImage')).toBeDefined()
  })

  it('keeps both VAEs so the clip is not silent', () => {
    const wf = build()
    const vaes = Object.values(wf).filter((n) => n.class_type === 'VAELoader')
    expect(vaes).toHaveLength(2)
    expect(nodeOf(wf, 'VAEDecodeAudio')).toBeDefined()
    expect(nodeOf(wf, 'CreateVideo')!.inputs.audio).toBeDefined()
  })

  it('saves into the dated folder the gallery scanner walks', () => {
    // The scanner only walks output/video/<preset>/<date>/ (lib/gallery/scanner.ts).
    // The template's flat `video/MinimaxH3` prefix put every clip one level too
    // shallow, so H3 renders never appeared in the Gallery at all.
    expect(nodeOf(build({}), 'SaveVideo')!.inputs.filename_prefix).toBe(
      'video/MinimaxH3/%year%-%month%-%day%/%hour%%minute%%second%-MinimaxH3_',
    )
  })

  it('uses only core ComfyUI nodes, so no custom pack can break it', () => {
    // The official template reaches for ComfyMathExpression (ComfyMath) and
    // ResolutionSelector (controlaltai-nodes); this builder does that maths in
    // TypeScript instead. If either name reappears here, that property is gone.
    // Turbo and the LoRA slots deliberately use core nodes too, so switching
    // them on must not introduce a pack either.
    for (const n of Object.values(
      build({ mode: 'i2v', inputImage: 's.png', turbo: true, lora1: 'x.safetensors', filmGrain: false }),
    )) {
      expect(CORE_NODES).toContain(n.class_type)
    }
  })

  it('has exactly two non-core nodes, each only when its feature is asked for', () => {
    // Both packs are already pinned dependencies of the LTX graph, so nothing
    // new is installed — but they must stay out of the default graph.
    const off = Object.values(build({ filmGrain: false })).map((n) => n.class_type)
    expect(off.filter((c) => !CORE_NODES.has(c))).toEqual([])
    expect(
      Object.values(build({ rife: true, filmGrain: false })).map((n) => n.class_type).filter((c) => !CORE_NODES.has(c)),
    ).toEqual(['RIFEInterpolation'])
    expect(
      Object.values(build({ seedHunt: true, filmGrain: false })).map((n) => n.class_type).filter((c) => !CORE_NODES.has(c)),
    ).toEqual(['VHS_VideoCombine'])
    expect(
      Object.values(build({})).map((n) => n.class_type).filter((c) => !CORE_NODES.has(c)),
    ).toEqual(['Film Grain'])
  })
})

const CORE_NODES = new Set([
  'UNETLoader', 'CLIPLoader', 'VAELoader', 'LoadImage', 'MiniMaxH3ImageToVideo',
  'MiniMaxH3ReferenceToVideo', 'LoadVideo', 'GetVideoComponents', 'LoadAudio',
  'KSamplerSelect', 'BasicScheduler', 'BasicGuider', 'RandomNoise',
  'SamplerCustomAdvanced', 'VAEDecode', 'VAEDecodeAudio', 'CreateVideo', 'SaveVideo',
  'LoraLoaderModelOnly', 'MiniMaxH3SigmaShift',
])

/** The model-patch chain, checkpoint first, as a list of [class, detail] pairs. */
function modelChain(wf: Record<string, ComfyUIPromptNode>): string[] {
  const out: string[] = []
  let ref = nodeOf(wf, 'BasicGuider')!.inputs.model as [string, number]
  for (;;) {
    const node = wf[ref[0]]
    out.unshift(
      node.class_type === 'LoraLoaderModelOnly'
        ? `lora:${node.inputs.lora_name}@${node.inputs.strength_model}`
        : node.class_type,
    )
    const next = node.inputs.model
    if (!Array.isArray(next)) return out
    ref = next as [string, number]
  }
}

describe('MiniMax H3 Turbo mode', () => {
  it('is off by default: 20 steps, no LoRA, no sigma shift', () => {
    const wf = build()
    expect(nodeOf(wf, 'BasicScheduler')!.inputs.steps).toBe(H3_STEPS.normal)
    expect(modelChain(wf)).toEqual(['UNETLoader'])
  })

  it('adds the Turbo LoRA and the author sigma shift, at 6 steps', () => {
    const wf = build({ turbo: true })
    expect(nodeOf(wf, 'BasicScheduler')!.inputs.steps).toBe(H3_STEPS.turbo)
    expect(H3_STEPS.turbo).toBe(6)
    expect(modelChain(wf)).toEqual([
      'UNETLoader',
      `lora:${H3_TURBO_LORA}@${H3_TURBO_STRENGTH}`,
      'MiniMaxH3SigmaShift',
    ])
    const shift = nodeOf(wf, 'MiniMaxH3SigmaShift')!
    // shift_audio 6 is double the node default; the distilled schedule moves the
    // audio stream with the video one, and leaving it at 3 desyncs the two.
    expect(shift.inputs.shift_video).toBe(12)
    expect(shift.inputs.shift_audio).toBe(6)
  })

  it('drives both the scheduler and the guider off the end of the chain', () => {
    // Missing either one silently samples the unpatched checkpoint.
    const wf = build({ turbo: true })
    expect(nodeOf(wf, 'BasicScheduler')!.inputs.model)
      .toEqual(nodeOf(wf, 'BasicGuider')!.inputs.model)
    expect(danglingLinks(wf)).toEqual([])
  })
})

describe('MiniMax H3 LoRA slots', () => {
  it('chains the filled slots in order and skips empty/None ones', () => {
    const wf = build({
      lora1: 'a.safetensors', lora1Strength: 0.8,
      lora2: 'None',
      lora3: '',
      lora4: 'b.safetensors', lora4Strength: 1.2,
    })
    expect(modelChain(wf)).toEqual(['UNETLoader', 'lora:a.safetensors@0.8', 'lora:b.safetensors@1.2'])
  })

  it('stacks user LoRAs on top of Turbo, never underneath it', () => {
    const wf = build({ turbo: true, lora1: 'a.safetensors' })
    expect(modelChain(wf)).toEqual([
      'UNETLoader',
      `lora:${H3_TURBO_LORA}@${H3_TURBO_STRENGTH}`,
      'lora:a.safetensors@1',
      'MiniMaxH3SigmaShift',
    ])
  })

  it('defaults an omitted strength to 1', () => {
    expect(modelChain(build({ lora1: 'a.safetensors' }))).toEqual(['UNETLoader', 'lora:a.safetensors@1'])
  })
})

describe('MiniMax H3 frame interpolation', () => {
  it('is off by default — the graph ships without the node', () => {
    const wf = build()
    expect(nodeOf(wf, 'RIFEInterpolation')).toBeUndefined()
    expect(nodeOf(wf, 'CreateVideo')!.inputs.fps).toBe(H3_FPS)
  })

  it('splices RIFE between the decode and the video, doubling the container fps', () => {
    const wf = build({ rife: true, filmGrain: false })
    const rife = nodeOf(wf, 'RIFEInterpolation')!
    expect(rife.inputs.source_fps).toBe(H3_FPS)
    expect(rife.inputs.target_fps).toBe(H3_RIFE_FPS)
    expect(H3_RIFE_FPS).toBe(H3_FPS * 2)
    // The container fps must move with it. H3 generates the audio jointly and
    // RIFE never touches it, so a mismatch plays the video at half speed against
    // its own soundtrack.
    expect(nodeOf(wf, 'CreateVideo')!.inputs.fps).toBe(H3_RIFE_FPS)
    expect(nodeOf(wf, 'CreateVideo')!.inputs.images).toEqual([
      Object.keys(wf).find((k) => wf[k] === rife),
      0,
    ])
    expect(danglingLinks(wf)).toEqual([])
  })

  it('leaves the audio branch alone', () => {
    const wf = build({ rife: true })
    expect(nodeOf(wf, 'CreateVideo')!.inputs.audio).toEqual([
      Object.keys(wf).find((k) => wf[k].class_type === 'VAEDecodeAudio'),
      0,
    ])
  })
})

describe('MiniMax H3 seed hunt', () => {
  it('forces Turbo on a candidate even when the toggle is off', () => {
    // The whole point is a cheap comparison; a candidate at 20 steps would cost
    // a full render each and the UI's "roughly 2.3x" promise would be a lie.
    const wf = build({ seedHunt: true, turbo: false })
    expect(nodeOf(wf, 'BasicScheduler')!.inputs.steps).toBe(H3_STEPS.turbo)
    expect(modelChain(wf)).toContain(`lora:${H3_TURBO_LORA}@${H3_TURBO_STRENGTH}`)
  })

  it('writes a temp clip instead of a gallery entry', () => {
    // Core SaveVideo has no save_output switch, so candidates would otherwise
    // pile into the gallery as real renders.
    const wf = build({ seedHunt: true, filmGrain: false })
    expect(nodeOf(wf, 'SaveVideo')).toBeUndefined()
    expect(nodeOf(wf, 'CreateVideo')).toBeUndefined()
    const combine = nodeOf(wf, 'VHS_VideoCombine')!
    expect(combine.inputs.save_output).toBe(false)
    // Audio has to ride along or the candidate is judged without its soundtrack.
    expect(combine.inputs.audio).toEqual([
      Object.keys(wf).find((k) => wf[k].class_type === 'VAEDecodeAudio'),
      0,
    ])
    expect(combine.inputs.frame_rate).toBe(H3_FPS)
    expect(danglingLinks(wf)).toEqual([])
  })

  it('carries the RIFE frame rate into the candidate', () => {
    const wf = build({ seedHunt: true, rife: true, filmGrain: false })
    const combine = nodeOf(wf, 'VHS_VideoCombine')!
    expect(combine.inputs.frame_rate).toBe(H3_RIFE_FPS)
    expect(combine.inputs.images).toEqual([
      Object.keys(wf).find((k) => wf[k].class_type === 'RIFEInterpolation'),
      0,
    ])
  })

  it('clearing seedHunt restores the real saver and the chosen Turbo setting', () => {
    // This is what SeedHuntGrid.commit does to promote the picked seed.
    const wf = build({ seedHunt: false, turbo: false, seed: 99 })
    expect(nodeOf(wf, 'SaveVideo')).toBeDefined()
    expect(nodeOf(wf, 'VHS_VideoCombine')).toBeUndefined()
    expect(nodeOf(wf, 'BasicScheduler')!.inputs.steps).toBe(H3_STEPS.normal)
    expect(modelChain(wf)).toEqual(['UNETLoader'])
    // The seed is the only thing that survives the promotion.
    expect(nodeOf(wf, 'RandomNoise')!.inputs.noise_seed).toBe(99)
  })
})

describe('MiniMax H3 film grain', () => {
  it('is ON by default and only an explicit false removes it', () => {
    // Opt-out, like the LTX motion LoRA. A truthiness check on `filmGrain`
    // would silently strip grain from every render that never touched it.
    expect(nodeOf(build(), 'Film Grain')).toBeDefined()
    expect(nodeOf(build({ filmGrain: undefined }), 'Film Grain')).toBeDefined()
    expect(nodeOf(build({ filmGrain: false }), 'Film Grain')).toBeUndefined()
  })

  it('sits between the decode and the video, at the stills intensity', () => {
    const wf = build({})
    const grain = nodeOf(wf, 'Film Grain')!
    expect(grain.inputs.intensity).toBe(H3_GRAIN_INTENSITY)
    // Same 0.04 the stills use — the earlier 0.06 read heavy in motion. Well
    // under the 0.1 where the blend starts visibly desaturating the frame.
    expect(H3_GRAIN_INTENSITY).toBeLessThanOrEqual(0.04)
    expect(H3_GRAIN_INTENSITY).toBeLessThan(0.1)
    expect(grain.inputs.image).toEqual([
      Object.keys(wf).find((k) => wf[k].class_type === 'VAEDecode'),
      0,
    ])
    expect(nodeOf(wf, 'CreateVideo')!.inputs.images).toEqual([
      Object.keys(wf).find((k) => wf[k] === grain),
      0,
    ])
    expect(danglingLinks(wf)).toEqual([])
  })

  it('grains AFTER interpolation, never before it', () => {
    // Graining first would hand RIFE noisy frames and it would interpolate the
    // noise, smearing grain into ghost trails instead of one roll per frame.
    const wf = build({ filmGrain: true, rife: true })
    const grain = nodeOf(wf, 'Film Grain')!
    const rifeId = Object.keys(wf).find((k) => wf[k].class_type === 'RIFEInterpolation')
    expect(grain.inputs.image).toEqual([rifeId, 0])
    expect(wf[rifeId!].inputs.images).toEqual([
      Object.keys(wf).find((k) => wf[k].class_type === 'VAEDecode'),
      0,
    ])
  })

  it('applies the Turbo LoRA at a fixed 0.9, below the trained 1.0', () => {
    // Not exposed as a control: Draft mode is a throwaway preview and these
    // weights skew over-sharp, so the author's own dial is set once, here.
    expect(H3_TURBO_STRENGTH).toBe(0.9)
    expect(modelChain(build({ turbo: true, filmGrain: false })))
      .toContain(`lora:${H3_TURBO_LORA}@0.9`)
  })

  it('reaches seed-hunt candidates too, so a draft previews the final look', () => {
    const wf = build({ seedHunt: true })
    const grain = nodeOf(wf, 'Film Grain')!
    expect(nodeOf(wf, 'VHS_VideoCombine')!.inputs.images).toEqual([
      Object.keys(wf).find((k) => wf[k] === grain),
      0,
    ])
    expect(danglingLinks(wf)).toEqual([])
  })
})

describe('graph determinism', () => {
  it('identical params produce an identical graph', () => {
    // Added-node ids come from a counter; if it were module-level it would drift
    // between builds and ComfyUI's execution cache would never hit.
    const p = { turbo: true, rife: true, lora1: 'a.safetensors' } as const
    expect(JSON.stringify(build(p))).toBe(JSON.stringify(build(p)))
  })
})

describe('MiniMax H3 reference mode', () => {
  const refs = (over: Partial<VideoGenerationParams> = {}) =>
    build({ mode: 'ref2v', refImages: ['a.png', 'b.png'], ...over })

  it('loads the ref2va checkpoint; t2v and i2v keep fl2va', () => {
    expect(nodeOf(refs(), 'UNETLoader')!.inputs.unet_name).toBe(H3_REF2VA_CKPT)
    expect(nodeOf(build(), 'UNETLoader')!.inputs.unet_name).toBe(
      'minimax_h3_fl2va_pruned_int8_convrot.safetensors',
    )
    expect(
      nodeOf(build({ mode: 'i2v', inputImage: 's.png' }), 'UNETLoader')!.inputs.unet_name,
    ).toBe('minimax_h3_fl2va_pruned_int8_convrot.safetensors')
  })

  it('retypes the conditioning node and drops first_frame', () => {
    const wf = refs()
    expect(nodeOf(wf, 'MiniMaxH3ImageToVideo')).toBeUndefined()
    const cond = nodeOf(wf, 'MiniMaxH3ReferenceToVideo')!
    expect(cond.inputs.first_frame).toBeUndefined()
    expect(cond.inputs.prompt).toBe('a raccoon operating a film camera')
  })

  it('wires audio_vae to the loader VAEDecodeAudio already reads', () => {
    const wf = refs()
    const cond = nodeOf(wf, 'MiniMaxH3ReferenceToVideo')!
    expect(cond.inputs.audio_vae).toEqual(nodeOf(wf, 'VAEDecodeAudio')!.inputs.vae)
    // ...and that is the AUDIO vae, not the video one the decode branch uses.
    expect(cond.inputs.audio_vae).not.toEqual(cond.inputs.vae)
  })

  // The whole feature rests on this key. A wrong name is accepted silently by
  // ComfyUI and renders an unconditioned clip that reads as a bad prompt.
  it('links references under the dotted, 0-indexed autogrow key', () => {
    const cond = nodeOf(refs(), 'MiniMaxH3ReferenceToVideo')!
    expect(Object.keys(cond.inputs).filter((k) => k.startsWith('ref_images.'))).toEqual([
      'ref_images.ref_image_0',
      'ref_images.ref_image_1',
    ])
  })

  it('points each reference at its own LoadImage with the right filename', () => {
    const wf = refs()
    const cond = nodeOf(wf, 'MiniMaxH3ReferenceToVideo')!
    const file = (slot: string) => wf[(cond.inputs[slot] as [string, number])[0]].inputs.image
    expect(file('ref_images.ref_image_0')).toBe('a.png')
    expect(file('ref_images.ref_image_1')).toBe('b.png')
  })

  // A gap in the UI slots must not renumber the survivor: the user's prompt
  // says <Picture 2> and the node must still see it in position 2.
  it('compacts a gap so slot indices never leak into the ordinals', () => {
    const wf = build({ mode: 'ref2v', refImages: ['a.png', undefined, 'c.png'] })
    const cond = nodeOf(wf, 'MiniMaxH3ReferenceToVideo')!
    expect(Object.keys(cond.inputs).filter((k) => k.startsWith('ref_images.'))).toEqual([
      'ref_images.ref_image_0',
      'ref_images.ref_image_1',
    ])
    expect(compactRefs(['a.png', undefined, 'c.png'])).toEqual(['a.png', 'c.png'])
  })

  it('defaults ref_image_size to match, and honours refHiFi', () => {
    expect(nodeOf(refs(), 'MiniMaxH3ReferenceToVideo')!.inputs.ref_image_size).toBe('match')
    expect(
      nodeOf(refs({ refHiFi: true }), 'MiniMaxH3ReferenceToVideo')!.inputs.ref_image_size,
    ).toBe('max')
  })

  it('splices out the i2v loader and leaves no dangling link', () => {
    const wf = refs()
    // Exactly the reference loaders remain — the base graph's `example.png` one is gone.
    expect(
      Object.values(wf).filter((n) => n.class_type === 'LoadImage').map((n) => n.inputs.image).sort(),
    ).toEqual(['a.png', 'b.png'])
    expect(danglingLinks(wf)).toEqual([])
  })

  it('frames from the orientation, like t2v — there is no source image', () => {
    const cond = nodeOf(refs({ orientation: 'portrait' }), 'MiniMaxH3ReferenceToVideo')!
    const t2v = nodeOf(build({ orientation: 'portrait' }), 'MiniMaxH3ImageToVideo')!
    expect([cond.inputs.width, cond.inputs.height]).toEqual([t2v.inputs.width, t2v.inputs.height])
  })

  it('builds with no references at all rather than throwing', () => {
    // The form blocks this, but a builder that throws turns a UI bug into a crash.
    const cond = nodeOf(build({ mode: 'ref2v' }), 'MiniMaxH3ReferenceToVideo')!
    expect(Object.keys(cond.inputs).some((k) => k.startsWith('ref_images.'))).toBe(false)
  })

  it('keeps every downstream feature working', () => {
    const wf = refs({ turbo: true, rife: true, lora1: 'x.safetensors' })
    expect(nodeOf(wf, 'MiniMaxH3SigmaShift')).toBeDefined()
    expect(nodeOf(wf, 'RIFEInterpolation')).toBeDefined()
    expect(nodeOf(wf, 'Film Grain')).toBeDefined()
    expect(modelChain(wf)).toEqual([
      'UNETLoader',
      `lora:${H3_TURBO_LORA}@${H3_TURBO_STRENGTH}`,
      'lora:x.safetensors@1',
      'MiniMaxH3SigmaShift',
    ])
    expect(danglingLinks(wf)).toEqual([])
  })

  it('produces an identical graph for identical params (exec-cache invariant)', () => {
    expect(refs()).toEqual(refs())
  })

  it('adds no custom pack', () => {
    for (const n of Object.values(refs({ filmGrain: false }))) {
      expect(CORE_NODES).toContain(n.class_type)
    }
  })
})

describe('MiniMax H3 video and audio references', () => {
  const av = (over: Partial<VideoGenerationParams> = {}) =>
    build({ mode: 'ref2v', refVideos: ['clip.mp4'], refAudios: ['voice.wav'], ...over })

  const condOf = (wf: Record<string, ComfyUIPromptNode>) =>
    nodeOf(wf, 'MiniMaxH3ReferenceToVideo')!

  it('feeds a reference video in as frames via LoadVideo + GetVideoComponents', () => {
    const wf = av()
    const cond = condOf(wf)
    const split = cond.inputs['ref_videos.ref_video_0'] as [string, number]
    expect(wf[split[0]].class_type).toBe('GetVideoComponents')
    // slot 0 of GetVideoComponents is `images`
    expect(split[1]).toBe(0)
    const load = wf[split[0]].inputs.video as [string, number]
    expect(wf[load[0]].class_type).toBe('LoadVideo')
    expect(wf[load[0]].inputs.file).toBe('clip.mp4')
  })

  // The pairing is by index and the node reads it off the slot name, so the
  // soundtrack must come from the SAME GetVideoComponents as its frames.
  it("pairs each clip's own soundtrack to the matching audio slot", () => {
    const wf = build({ mode: 'ref2v', refVideos: ['a.mp4', 'b.mp4'] })
    const cond = condOf(wf)
    for (const i of [0, 1]) {
      const frames = cond.inputs[`ref_videos.ref_video_${i}`] as [string, number]
      const sound = cond.inputs[`ref_video_audios.ref_video_audio_${i}`] as [string, number]
      expect(sound[0]).toBe(frames[0])
      // slot 1 of GetVideoComponents is `audio`
      expect(sound[1]).toBe(1)
    }
  })

  it('loads standalone reference audio through LoadAudio', () => {
    const cond = condOf(av())
    const wf = av()
    const a = condOf(wf).inputs['ref_audios.ref_audio_0'] as [string, number]
    expect(wf[a[0]].class_type).toBe('LoadAudio')
    expect(wf[a[0]].inputs.audio).toBe('voice.wav')
    expect(cond.inputs['ref_audios.ref_audio_0']).toBeDefined()
  })

  it('uses the dotted 0-indexed key for every reference type', () => {
    const cond = condOf(build({
      mode: 'ref2v',
      refImages: ['i.png'], refVideos: ['v.mp4'], refAudios: ['a.wav'],
    }))
    expect(Object.keys(cond.inputs).filter((k) => k.includes('ref_')).sort()).toEqual([
      'ref_audios.ref_audio_0',
      'ref_image_size',
      'ref_images.ref_image_0',
      'ref_video_audios.ref_video_audio_0',
      'ref_videos.ref_video_0',
    ])
  })

  it('compacts gaps per type, so each type numbers from 1 independently', () => {
    const cond = condOf(build({
      mode: 'ref2v',
      refImages: [undefined, 'i.png'],
      refVideos: ['v1.mp4', undefined, 'v3.mp4'],
      refAudios: [undefined, undefined, 'a.wav'],
    }))
    expect(cond.inputs['ref_images.ref_image_0']).toBeDefined()
    expect(cond.inputs['ref_images.ref_image_1']).toBeUndefined()
    expect(cond.inputs['ref_videos.ref_video_0']).toBeDefined()
    expect(cond.inputs['ref_videos.ref_video_1']).toBeDefined()
    expect(cond.inputs['ref_videos.ref_video_2']).toBeUndefined()
    expect(cond.inputs['ref_audios.ref_audio_0']).toBeDefined()
  })

  it('leaves no dangling link and stays core-only', () => {
    const wf = av({ refImages: ['i.png'], filmGrain: false })
    expect(danglingLinks(wf)).toEqual([])
    for (const n of Object.values(wf)) expect(CORE_NODES).toContain(n.class_type)
  })

  it('counts every reference type against the one shared budget', () => {
    expect(H3_REF_BUDGET).toBe(6)
    expect(h3RefCount({})).toBe(0)
    expect(h3RefCount({ refImages: ['a', undefined, 'b'], refVideos: ['c'], refAudios: ['d'] })).toBe(4)
    // Gaps are not spent budget — only filled slots are.
    expect(h3RefCount({ refImages: [undefined, undefined] })).toBe(0)
  })

  it('never emits video or audio nodes outside reference mode', () => {
    for (const mode of ['t2v', 'i2v'] as const) {
      const wf = build({ mode, inputImage: 's.png', refVideos: ['v.mp4'], refAudios: ['a.wav'] })
      expect(nodeOf(wf, 'LoadVideo')).toBeUndefined()
      expect(nodeOf(wf, 'GetVideoComponents')).toBeUndefined()
      expect(nodeOf(wf, 'LoadAudio')).toBeUndefined()
    }
  })
})

describe('minimaxH3Workflow definition', () => {
  it('defaults to a duration H3 actually supports', () => {
    const d = minimaxH3Workflow.defaultParams.durationSeconds!
    expect(d).toBeGreaterThanOrEqual(4)
    expect(d).toBeLessThanOrEqual(15)
  })

  it('exposes an id the video form can select by', () => {
    expect(minimaxH3Workflow.id).toBe('minimax-h3')
    expect(minimaxH3Workflow.orientations.length).toBeGreaterThan(0)
  })
})
