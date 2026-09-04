import { describe, it, expect } from 'vitest'
import {
  minimaxH3Workflow,
  h3FrameCount,
  h3ClampDuration,
  H3_MIN_DURATION_S,
  H3_MAX_DURATION_S,
  h3Dims,
  BUDGET_MP,
  tierOf,
  H3_FPS,
  ORIENTATIONS,
  H3_STEPS,
  H3_TURBO,
  H3_TURBO_LORA,
  H3_REF2V_TURBO_LORA,
  h3TurboTier,
  H3_RIFE_FPS,
  H3_TURBO_STRENGTH,
  H3_GRAIN_INTENSITY,
  H3_SHARPEN_STRENGTH,
  H3_REF2VA_CKPT,
  H3_EROS,
  h3UsesEros,
  H3_REF_BUDGET,
  h3RefCount,
  compactRefs,
  h3Task,
  H3_REALISM_LORA,
  H3_REALISM_STRENGTH,
  H3_REALISM_TRIGGER,
  withRealismTrigger,
  H3_CONTEXT_FRAMES,
  H3_CONTEXT_AUDIO_S,
  h3DeliveredSeconds,
} from './minimax-h3'
import { MINIMAX_H3_ASSETS } from '@/lib/models/minimax-h3-assets'
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

const idFor = (wf: Record<string, ComfyUIPromptNode>, cls: string) =>
  Object.keys(wf).find((k) => wf[k].class_type === cls)

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

describe('h3ClampDuration', () => {
  it('maps the trained frame range exactly onto its bounds', () => {
    // 124–362 frames is what H3 was trained on, and both ends are points on the
    // 17k+5 grid — which is why the clamp can be expressed in whole seconds at
    // all, and why neither bound loses a frame to rounding.
    expect(h3FrameCount(H3_MIN_DURATION_S)).toBe(124)
    expect(h3FrameCount(H3_MAX_DURATION_S)).toBe(362)
  })

  it('clamps both ways and leaves the trained range alone', () => {
    expect(h3ClampDuration(30)).toBe(H3_MAX_DURATION_S)
    expect(h3ClampDuration(2)).toBe(H3_MIN_DURATION_S)
    for (let s = H3_MIN_DURATION_S; s <= H3_MAX_DURATION_S; s++) {
      expect(h3ClampDuration(s)).toBe(s)
    }
  })

  it('caps the frame count the graph actually asks for', () => {
    // The bug: the slider reached 30 s, so the node was asked for 736 frames —
    // twice the trained ceiling, at twice the render time, for a worse clip.
    expect(h3FrameCount(30)).toBe(736)
    const wf = minimaxH3Workflow.buildPrompt({
      ...minimaxH3Workflow.defaultParams,
      prompt: 'a clip',
      durationSeconds: 30,
    } as Parameters<typeof minimaxH3Workflow.buildPrompt>[0]) as Record<string, ComfyUIPromptNode>
    expect(nodeOf(wf, 'MiniMaxH3ImageToVideo')?.inputs.length).toBe(362)
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

  it('sharpens between RIFE and the grain, and only when asked', () => {
    expect(nodeOf(build({}), 'ImageSharpenKJ')).toBeUndefined()

    const wf = build({ sharpen: true, rife: true })
    const sharp = nodeOf(wf, 'ImageSharpenKJ')!
    // The dynamic-combo spelling. A wrong prefix here leaves `method` a bare
    // string that the node subscripts and dies on — so this is the assertion
    // that keeps the failure loud instead of silently unsharpened.
    expect(sharp.inputs.method).toBe('rcas')
    expect(sharp.inputs['method.strength']).toBe(H3_SHARPEN_STRENGTH)

    // Reads the interpolated frames, not the decoder: sharpening before RIFE
    // would leave every interpolated frame softer than its neighbours.
    const rifeId = idFor(wf, 'RIFEInterpolation')
    expect(sharp.inputs.image).toEqual([rifeId, 0])

    // And the grain reads the sharpener, so grain lands on top of the sharpen
    // rather than being sharpened into crunch.
    const sharpId = idFor(wf, 'ImageSharpenKJ')
    expect(nodeOf(wf, 'Film Grain')!.inputs.image).toEqual([sharpId, 0])
  })

  it('sharpens the trimmed clip in a continuation, not the pinned head', () => {
    const wf = build({ sharpen: true, continueFrom: 'prev.mp4' })
    // A continuation has *two* ImageFromBatch nodes — one pulling the tail off
    // the source clip for the guide, one dropping the pinned head off this
    // render. Only the second is downstream of the decoder, and picking the
    // wrong one is precisely the mistake this test exists to catch.
    const decodeId = idFor(wf, 'VAEDecode')
    const trim = Object.entries(wf).find(
      ([, n]) => n.class_type === 'ImageFromBatch' && (n.inputs.image as string[])?.[0] === decodeId,
    )!
    expect(nodeOf(wf, 'ImageSharpenKJ')!.inputs.image).toEqual([trim[0], 0])
  })

  it('keeps every non-core node out of the graph until its feature is asked for', () => {
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
      Object.values(build({ sharpen: true, filmGrain: false })).map((n) => n.class_type).filter((c) => !CORE_NODES.has(c)),
    ).toEqual(['ImageSharpenKJ'])
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
  // Continuation. All core too, which is the whole reason this path was built
  // out of them rather than out of one of the H3 chaining node packs.
  'MiniMaxH3AddGuide', 'ImageFromBatch', 'TrimAudioDuration', 'GetImageSize',
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

describe('MiniMax H3 Eros checkpoint', () => {
  const eros = (over: Partial<VideoGenerationParams> = {}) =>
    build({ h3Checkpoint: 'eros', ...over })

  it('swaps the checkpoint and the whole sampling recipe together', () => {
    // The card's entire documented recipe for beta4: "use euler/simple 6-8
    // steps on all modes". Swapping only `unet_name` would leave it sampling on
    // res_multistep at 20 steps, which is the schedule its merged Turbo was
    // distilled AWAY from.
    const wf = eros()
    expect(nodeOf(wf, 'UNETLoader')!.inputs.unet_name).toBe(H3_EROS.ckpt)
    expect(nodeOf(wf, 'KSamplerSelect')!.inputs.sampler_name).toBe('euler')
    expect(nodeOf(wf, 'BasicScheduler')!.inputs.scheduler).toBe('simple')
    expect(nodeOf(wf, 'BasicScheduler')!.inputs.steps).toBe(H3_EROS.steps)
    expect(H3_EROS.steps).toBeLessThanOrEqual(8)
    expect(H3_EROS.huntSteps).toBeGreaterThanOrEqual(6)
  })

  it('never stacks a Turbo LoRA or the sigma shift on a merged-turbo model', () => {
    // The form retires the Speed row under Eros, but `turbo` is persisted, so a
    // session that had Fast selected reopens with it still set. Stacking a LoRA
    // distilled for one schedule onto weights already merged onto another is
    // exactly the artefact the author's beta3 notes complain about.
    const chain = modelChain(eros({ turbo: 'fast' }))
    expect(chain).toEqual(['UNETLoader'])
    expect(nodeOf(eros({ turbo: 'fast' }), 'MiniMaxH3SigmaShift')).toBeUndefined()
    expect(nodeOf(eros({ turbo: 'fast' }), 'BasicScheduler')!.inputs.steps).toBe(H3_EROS.steps)
  })

  it('still takes user LoRAs and the realism adapter', () => {
    // Only the *distillation* is baked in; the finetune keeps H3's key layout,
    // so the ordinary stack must go on exactly as it does on the stock model.
    expect(modelChain(eros({ lora1: 'style.safetensors', lora1Strength: 0.8 }))).toContain(
      'lora:style.safetensors@0.8',
    )
    expect(modelChain(eros({ realismLora: true }))).toContain(
      `lora:${H3_REALISM_LORA}@${H3_REALISM_STRENGTH}`,
    )
  })

  it('is ignored in reference mode, which loads different weights entirely', () => {
    // TenStrip's reference build exists only as a 40 GB bf16 file with no int8
    // sibling, and `h3Checkpoint` is persisted across a mode switch — so the
    // flag reaching ref2v must change nothing at all, right down to the Turbo
    // dial coming back.
    const wf = eros({ mode: 'ref2v', refImages: ['a.png'], turbo: 'fast' })
    expect(nodeOf(wf, 'UNETLoader')!.inputs.unet_name).toBe(H3_REF2VA_CKPT)
    expect(nodeOf(wf, 'KSamplerSelect')!.inputs.sampler_name).toBe('res_multistep')
    expect(nodeOf(wf, 'BasicScheduler')!.inputs.steps).toBe(H3_TURBO.fast.steps)
    expect(modelChain(wf)).toContain(`lora:${H3_TURBO.fast.lora}@${H3_TURBO.fast.strength}`)
    expect(h3UsesEros({ h3Checkpoint: 'eros', mode: 'ref2v' })).toBe(false)
    expect(h3UsesEros({ h3Checkpoint: 'eros', mode: 'i2v' })).toBe(true)
    expect(h3UsesEros({ mode: 'i2v' })).toBe(false)
    expect(h3UsesEros()).toBe(false)
  })

  it('takes the low end of the step range for seed-hunt candidates', () => {
    // With no Draft tier to drop to, the step cut IS the whole hunt discount —
    // without it the form would promise cheap candidates that each cost a full
    // render. Both ends stay inside the card's documented 6-8.
    expect(nodeOf(eros({ seedHunt: true }), 'BasicScheduler')!.inputs.steps).toBe(H3_EROS.huntSteps)
    expect(H3_EROS.huntSteps).toBeLessThan(H3_EROS.steps)
  })

  it('is downloadable from the Models page', () => {
    // A checkpoint the builder names but the catalog does not offer is a dead
    // button: the install check could never pass, so the option never enables.
    expect(MINIMAX_H3_ASSETS.map((a) => a.name)).toContain(H3_EROS.ckpt)
    const asset = MINIMAX_H3_ASSETS.find((a) => a.name === H3_EROS.ckpt)!
    expect(asset.folder).toBe('diffusion_models')
    expect(asset.optional).toBe(true)
    // int8 convrot, never the fp8_scaled sibling — that is the format
    // DynamicVRAM renders as tiled garbage, and it is on by default here.
    expect(asset.name).toContain('int8_convrot')
  })
})

describe('MiniMax H3 Turbo tiers', () => {
  it('reads the legacy `true` as Draft, so saved sessions and Director runs survive', () => {
    expect(h3TurboTier(true)).toBe('draft')
    expect(h3TurboTier('draft')).toBe('draft')
    expect(h3TurboTier('fast')).toBe('fast')
    expect(h3TurboTier(false)).toBeNull()
    expect(h3TurboTier(undefined)).toBeNull()
    // The alias the pre-two-tier callers import still resolves to Draft's file.
    expect(H3_TURBO_LORA).toBe(H3_TURBO.draft.lora)
    expect(H3_STEPS.turbo).toBe(H3_TURBO.draft.steps)
    expect(H3_TURBO_STRENGTH).toBe(H3_TURBO.draft.strength)
  })

  it('renders each tier at its own LoRA, steps and shift — never a mix', () => {
    for (const tier of ['draft', 'fast'] as const) {
      const wf = build({ turbo: tier })
      const p = H3_TURBO[tier]
      expect(nodeOf(wf, 'BasicScheduler')!.inputs.steps).toBe(p.steps)
      expect(modelChain(wf)).toContain(`lora:${p.lora}@${p.strength}`)
      const shift = nodeOf(wf, 'MiniMaxH3SigmaShift')!
      expect(shift.inputs.shift_video).toBe(p.shift.video)
      expect(shift.inputs.shift_audio).toBe(p.shift.audio)
    }
  })

  it('holds the Fast profile to lightx2v 8-step v1.0 at their published figures', () => {
    // A distilled LoRA is only correct at the schedule it was distilled for, so
    // these four move together or not at all. audio 3 is lightx2v's figure and
    // is deliberately NOT Draft's 6, which belongs to the drbaph workflow.
    expect(H3_TURBO.fast).toEqual({
      // drbaph's rank-21 resize of the same 8-step v1.0 weights: 327 MB rather
      // than 1.96 GB, measured equivalent over 3 seeds. Matched loosely on the
      // parts that identify the distillation, because which *build* of it we
      // ship is a download-size decision and has changed once already — the
      // schedule figures below are what must not drift.
      lora: expect.stringMatching(/^minimax_h3_fl2v_turbo_8step_v1\.0_comfyui.*\.safetensors$/),
      steps: 8,
      strength: 0.75,
      shift: { video: 12, audio: 3 },
    })
  })

  it('ships the Fast LoRA the catalog actually downloads', () => {
    // The builder naming a file the catalog does not offer is the failure this
    // guards: ComfyUI rejects the whole prompt at validation, and the only clue
    // is a 400 naming a LoRA the user was never given a way to install.
    expect(MINIMAX_H3_ASSETS.map((a) => a.name)).toContain(H3_TURBO.fast.lora)
    expect(MINIMAX_H3_ASSETS.map((a) => a.name)).toContain(H3_TURBO.draft.lora)
  })

  it('swaps to the ref2v LoRA only in reference mode, and only once confirmed installed', () => {
    const chain = (over: Partial<VideoGenerationParams>) =>
      modelChain(build({ turbo: 'fast', refImages: ['a.png'], ...over })).join(' ')

    // Confirmed present: ref2va's own distillation, at the tier's strength.
    expect(chain({ mode: 'ref2v', ref2vTurbo: true })).toContain(
      `lora:${H3_REF2V_TURBO_LORA}@${H3_TURBO.fast.strength}`,
    )
    // Absent: degrade to the fl2v LoRA rather than name a file ComfyUI would
    // reject at validation.
    expect(chain({ mode: 'ref2v' })).toContain(`lora:${H3_TURBO.fast.lora}`)
    // Installed but not in reference mode: the ref2v weights are the wrong
    // shape for the fl2va checkpoint, so the flag must not leak across modes.
    expect(chain({ mode: 't2v', ref2vTurbo: true })).toContain(`lora:${H3_TURBO.fast.lora}`)
  })

  it('seed hunt upgrades "no Turbo" to Draft but honours an explicit Fast pick', () => {
    expect(nodeOf(build({ seedHunt: true, turbo: false }), 'BasicScheduler')!.inputs.steps).toBe(
      H3_TURBO.draft.steps,
    )
    expect(nodeOf(build({ seedHunt: true, turbo: 'fast' }), 'BasicScheduler')!.inputs.steps).toBe(
      H3_TURBO.fast.steps,
    )
  })

  it('every tier LoRA is downloadable from the Models page', () => {
    // A profile naming a file with no download entry is a dead button: the tier
    // could never turn itself on, because the install check would never pass.
    const downloadable = new Set(MINIMAX_H3_ASSETS.map((a) => a.name))
    for (const p of Object.values(H3_TURBO)) expect(downloadable).toContain(p.lora)
    expect(downloadable).toContain(H3_REF2V_TURBO_LORA)
  })
})

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

describe('h3Task — which MiniMax task the filled slots describe', () => {
  it('reads the frame slots, not a mode the user picks', () => {
    const t = (over: Partial<VideoGenerationParams>) => h3Task(base({ mode: 'i2v', ...over }))
    expect(t({ inputImage: 's.png' })).toBe('i2v')
    expect(t({ inputImage: 's.png', endImage: 'e.png' })).toBe('fl2v')
    expect(t({ endImage: 'e.png' })).toBe('l2v')
    // A half-filled i2v form is still t2v, which is what the builder already did.
    expect(t({})).toBe('t2v')
  })

  it('never lets an end frame change t2v or reference mode', () => {
    // ref2v runs a different checkpoint whose node has no last_frame at all, and
    // t2v deliberately owns no image — a stale endImage surviving a mode switch
    // must not silently promote either of them to a keyframe task.
    expect(h3Task(base({ mode: 'ref2v', endImage: 'e.png' }))).toBe('ref2v')
    expect(h3Task(base({ mode: 't2v', endImage: 'e.png' }))).toBe('t2v')
  })
})

describe('minimaxH3Workflow.buildPrompt — end frame', () => {
  const loadImages = (wf: Record<string, ComfyUIPromptNode>) =>
    Object.values(wf).filter((n) => n.class_type === 'LoadImage')

  it('wires both frames for fl2v, in their own loaders', () => {
    const wf = build({ mode: 'i2v', inputImage: 's.png', endImage: 'e.png' })
    const c = nodeOf(wf, 'MiniMaxH3ImageToVideo')!.inputs
    expect(c.first_frame).toBeDefined()
    expect(c.last_frame).toBeDefined()
    expect(c.first_frame).not.toEqual(c.last_frame)
    expect(loadImages(wf).map((n) => n.inputs.image).sort()).toEqual(['e.png', 's.png'])
    expect(danglingLinks(wf)).toEqual([])
  })

  it('drops the first frame entirely for l2v', () => {
    // The node's `first_frame` is optional, and feeding it a placeholder would
    // tell the model to open on that image — the exact opposite of l2v.
    const wf = build({ mode: 'i2v', endImage: 'e.png' })
    const c = nodeOf(wf, 'MiniMaxH3ImageToVideo')!.inputs
    expect(c.first_frame).toBeUndefined()
    expect(c.last_frame).toBeDefined()
    expect(loadImages(wf)).toHaveLength(1)
    expect(loadImages(wf)[0].inputs.image).toBe('e.png')
    expect(danglingLinks(wf)).toEqual([])
  })

  it('leaves a plain i2v graph exactly as it was', () => {
    // The end-frame loader is allocated inside the branch that needs it, so a
    // render that predates this feature keeps its node ids and stays in
    // ComfyUI's execution cache.
    const wf = build({ mode: 'i2v', inputImage: 's.png' })
    expect(nodeOf(wf, 'MiniMaxH3ImageToVideo')!.inputs.last_frame).toBeUndefined()
    expect(loadImages(wf)).toHaveLength(1)
  })

  it('ignores an end frame in t2v and reference mode', () => {
    for (const mode of ['t2v', 'ref2v'] as const) {
      const wf = build({ mode, endImage: 'e.png', refImages: mode === 'ref2v' ? ['r.png'] : undefined })
      const c = nodeOf(wf, 'MiniMaxH3ReferenceToVideo')?.inputs
        ?? nodeOf(wf, 'MiniMaxH3ImageToVideo')!.inputs
      expect(c.last_frame).toBeUndefined()
      expect(danglingLinks(wf)).toEqual([])
    }
  })

  it('frames from the end image when it is the only anchor', () => {
    const c = nodeOf(build({ mode: 'i2v', endImage: 'e.png', endImageWidth: 1080, endImageHeight: 1920 }),
      'MiniMaxH3ImageToVideo')!.inputs
    expect((c.width as number) / (c.height as number)).toBeCloseTo(9 / 16, 1)
  })

  it('lets the start frame win the aspect when the pair disagrees', () => {
    // A mismatched pair has to resolve to one shape; the opening is what the
    // viewer sees first, so it decides.
    const c = nodeOf(build({
      mode: 'i2v',
      inputImage: 's.png', inputImageWidth: 1920, inputImageHeight: 1080,
      endImage: 'e.png', endImageWidth: 1080, endImageHeight: 1920,
    }), 'MiniMaxH3ImageToVideo')!.inputs
    expect((c.width as number) / (c.height as number)).toBeCloseTo(16 / 9, 1)
  })
})

describe('realism adapter', () => {
  const loraNames = (wf: Record<string, ComfyUIPromptNode>) =>
    Object.values(wf)
      .filter((n) => n.class_type === 'LoraLoaderModelOnly')
      .map((n) => n.inputs.lora_name)

  it('is absent unless explicitly asked for', () => {
    // Off by default and opt-in only: naming a LoRA that is not on disk fails
    // ComfyUI's validation for the whole prompt rather than degrading.
    expect(loraNames(build({}))).not.toContain(H3_REALISM_LORA)
    expect(loraNames(build({ realismLora: false }))).not.toContain(H3_REALISM_LORA)
    expect(nodeOf(build({}), 'MiniMaxH3ImageToVideo')!.inputs.prompt)
      .not.toContain(H3_REALISM_TRIGGER)
  })

  it('loads at the measured strength, not the author’s headline 1.0', () => {
    const node = Object.values(build({ realismLora: true })).find(
      (n) => n.class_type === 'LoraLoaderModelOnly' && n.inputs.lora_name === H3_REALISM_LORA,
    )!
    expect(node.inputs.strength_model).toBe(H3_REALISM_STRENGTH)
    expect(H3_REALISM_STRENGTH).toBe(0.7)
  })

  it('stacks with a Turbo tier rather than replacing it', () => {
    // The product requirement: Realistic skin has to work while Draft or Fast
    // is on, so both LoRAs must appear in one chain.
    for (const turbo of ['draft', 'fast'] as const) {
      const names = loraNames(build({ realismLora: true, turbo }))
      expect(names).toContain(H3_TURBO[turbo].lora)
      expect(names).toContain(H3_REALISM_LORA)
      // Turbo first — a distillation is the base the style rides on.
      expect(names.indexOf(H3_TURBO[turbo].lora)).toBeLessThan(names.indexOf(H3_REALISM_LORA))
    }
  })

  it('leaves the graph valid and still core-only', () => {
    const wf = build({ realismLora: true, turbo: 'fast' })
    expect(danglingLinks(wf)).toEqual([])
    // Everything the sampler reads must come off the end of the patched chain,
    // or the realism weights silently do nothing.
    const guiderModel = nodeOf(wf, 'BasicGuider')!.inputs.model as [string, number]
    const schedModel = nodeOf(wf, 'BasicScheduler')!.inputs.model as [string, number]
    expect(guiderModel[0]).toBe(schedModel[0])
  })
})

describe('withRealismTrigger', () => {
  it('puts the trigger above the fields, not above the alignment line', () => {
    // The first line of an i2v/fl2v prompt is a mandatory alignment instruction
    // in MiniMax's guide; displacing it would break the frame anchoring.
    const anchor = 'For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.'
    const out = withRealismTrigger(`${anchor}\n\nintegrated_multimodal_description: [Shot 1] x`)
    expect(out.split('\n')[0]).toBe(anchor)
    expect(out.indexOf(H3_REALISM_TRIGGER)).toBeLessThan(out.indexOf('integrated_multimodal_description:'))
  })

  it('prepends when there is no field block to sit above', () => {
    expect(withRealismTrigger('a woman walks').startsWith(`${H3_REALISM_TRIGGER}\n\n`)).toBe(true)
  })

  it('never doubles a trigger the prompt already carries', () => {
    // Re-rendering a saved prompt, or a user who typed it themselves.
    const once = withRealismTrigger('integrated_multimodal_description: x')
    expect(withRealismTrigger(once)).toBe(once)
    expect(once.match(new RegExp(H3_REALISM_TRIGGER, 'g'))).toHaveLength(1)
  })

  it('reaches the conditioning node when the adapter is on', () => {
    const p = nodeOf(build({ realismLora: true }), 'MiniMaxH3ImageToVideo')!.inputs.prompt as string
    expect(p).toContain(H3_REALISM_TRIGGER)
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

describe('MiniMax H3 continuation', () => {
  const PREV = 'video/MinimaxH3/2026-08-29/193337-MinimaxH3__00001_.mp4'
  /** All nodes of a class — there are two of several classes in a continuation. */
  const allOf = (wf: Record<string, ComfyUIPromptNode>, cls: string) =>
    Object.entries(wf).filter(([, n]) => n.class_type === cls)
  const titled = (wf: Record<string, ComfyUIPromptNode>, title: string) =>
    Object.entries(wf).find(([, n]) => n._meta?.title === title)

  it('adds nothing at all when continueFrom is unset', () => {
    // Byte-identical, not merely "no AddGuide": a graph that gained even a
    // dangling node would miss ComfyUI's execution cache on every old render.
    expect(build({})).toEqual(build({ continueFrom: undefined }))
    expect(nodeOf(build({}), 'MiniMaxH3AddGuide')).toBeUndefined()
  })

  it('reads the previous clip out of the output dir, not input', () => {
    // Without the annotation LoadVideo resolves against input/ and the render
    // dies on a missing file — the clip we want is one SaveVideo wrote.
    const load = nodeOf(build({ continueFrom: PREV }), 'LoadVideo')!
    expect(load.inputs.file).toBe(`${PREV} [output]`)
  })

  it('pins the TAIL of the previous clip, not its opening', () => {
    const wf = build({ continueFrom: PREV })
    const tail = titled(wf, `Last ${H3_CONTEXT_FRAMES} frames`)![1]
    // Negative index is the whole difference between continuing a clip and
    // re-rendering its first second.
    expect(tail.inputs.batch_index).toBe(-H3_CONTEXT_FRAMES)
    expect(tail.inputs.length).toBe(H3_CONTEXT_FRAMES)
    const sound = titled(wf, 'Tail sound')![1]
    expect(sound.inputs.start_index).toBe(-H3_CONTEXT_AUDIO_S)
    expect(sound.inputs.duration).toBe(H3_CONTEXT_AUDIO_S)
  })

  it('pins the SAME span of sound as of picture, ending at the cut', () => {
    // AddGuide anchors audio forward from frame_idx, so a window of a different
    // length than the picture pin desynchronises them. At 1.0 s against a
    // 22-frame pin, new-frame 0 showed the previous clip's frame N-22 while
    // playing its audio from N-24 (83 ms of drift inside the pinned head), and
    // the surplus 2 frames of sound outlived the 22-frame trim — so every
    // delivered clip opened on a fragment of the previous clip's audio.
    expect(H3_CONTEXT_AUDIO_S).toBeCloseTo(H3_CONTEXT_FRAMES / H3_FPS, 9)

    const wf = build({ continueFrom: PREV })
    const pinnedSound = titled(wf, 'Tail sound')![1]
    const cutSound = titled(wf, 'Drop pinned head (sound)')![1]
    // What was pinned and what is cut away must be the same amount of sound.
    expect(pinnedSound.inputs.duration).toBeCloseTo(Number(cutSound.inputs.start_index), 9)
  })

  it('pins a frame count AddGuide will not silently shrink', () => {
    // The node walks a non-grid batch DOWN to the next legal length instead of
    // refusing, so an off-grid constant here would pin fewer frames than the
    // trim arithmetic removes and every join would repeat a few frames.
    expect(H3_CONTEXT_FRAMES % 17).toBe(5)
  })

  it('splices AddGuide between the conditioning and the guider', () => {
    const wf = build({ continueFrom: PREV })
    const [guideId, guide] = Object.entries(wf).find(
      ([, n]) => n.class_type === 'MiniMaxH3AddGuide',
    )!
    const [condId] = Object.entries(wf).find(
      ([, n]) => n.class_type === 'MiniMaxH3ImageToVideo',
    )!
    expect(guide.inputs.positive).toEqual([condId, 0])
    expect(guide.inputs.frame_idx).toBe(0)
    const guider = nodeOf(wf, 'BasicGuider')!
    expect(guider.inputs.conditioning).toEqual([guideId, 0])
    // AddGuide returns conditioning only — the sampler's latent must still come
    // straight off the conditioning node, or the render has no latent to fill.
    expect(nodeOf(wf, 'SamplerCustomAdvanced')!.inputs.latent_image).toEqual([condId, 1])
  })

  it('gives AddGuide the video VAE and the audio VAE the right way round', () => {
    // Two VAELoaders in this graph; swapping them fails deep inside the node.
    const wf = build({ continueFrom: PREV })
    const guide = nodeOf(wf, 'MiniMaxH3AddGuide')!
    expect(guide.inputs.vae).toEqual(nodeOf(wf, 'VAEDecode')!.inputs.vae)
    expect(guide.inputs.audio_vae).toEqual(nodeOf(wf, 'VAEDecodeAudio')!.inputs.vae)
    expect(guide.inputs.vae).not.toEqual(guide.inputs.audio_vae)
  })

  it('takes its size from the source clip, not from the form', () => {
    // Reported from a real render: a portrait 672x960 source continued while
    // the form said landscape came back 1088x608. AddGuide resizes the guide to
    // the target rather than refusing, so it centre-cropped a band out of the
    // portrait frames and upscaled it — wrong aspect and a big quality loss,
    // with no error anywhere. The form's orientation describes what the user
    // last picked, which has nothing to do with the clip being continued.
    const wf = build({ continueFrom: PREV, orientation: 'landscape' })
    const size = titled(wf, 'Match the previous clip’s size')!
    const cond = nodeOf(wf, 'MiniMaxH3ImageToVideo')!
    expect(cond.inputs.width).toEqual([size[0], 0])
    expect(cond.inputs.height).toEqual([size[0], 1])
    // Read off the previous clip's own frames, so the two cannot disagree.
    const split = Object.entries(wf).find(([, n]) => n.class_type === 'GetVideoComponents')!
    expect(size[1].inputs.image).toEqual([split[0], 0])
  })

  it('leaves a normal render sized by the form', () => {
    // The link must appear only for continuations — a plain render still picks
    // its dimensions from orientation and the VRAM budget.
    const cond = nodeOf(build({ orientation: 'portrait' }), 'MiniMaxH3ImageToVideo')!
    expect(typeof cond.inputs.width).toBe('number')
    expect(typeof cond.inputs.height).toBe('number')
  })

  it('trims the pinned head off both streams by the same amount', () => {
    const wf = build({ continueFrom: PREV, durationSeconds: 5 })
    const cut = titled(wf, 'Drop pinned head')![1]
    expect(cut.inputs.batch_index).toBe(H3_CONTEXT_FRAMES)
    const cutSound = titled(wf, 'Drop pinned head (sound)')![1]
    // Same instant expressed in seconds — a mismatch here desyncs picture from
    // the audio H3 generated jointly with it, and stacks at every join.
    expect(cutSound.inputs.start_index).toBeCloseTo(H3_CONTEXT_FRAMES / H3_FPS, 6)
    expect(cutSound.inputs.duration).toBeCloseTo((124 - H3_CONTEXT_FRAMES) / H3_FPS, 6)
  })

  it('feeds the container the trimmed streams', () => {
    // Film grain off, because it is on by default and legitimately sits between
    // the trim and the container — this asserts the trim is in the path, not
    // that it is the last thing in it.
    const wf = build({ continueFrom: PREV, filmGrain: false })
    const video = nodeOf(wf, 'CreateVideo')!
    expect(video.inputs.images).toEqual([titled(wf, 'Drop pinned head')![0], 0])
    expect(video.inputs.audio).toEqual([titled(wf, 'Drop pinned head (sound)')![0], 0])
  })

  it('grains the trimmed clip rather than replacing the trim', () => {
    // Default-on film grain rewrites the container's images input, so the trim
    // has to survive as its source — otherwise the pinned head comes back.
    const wf = build({ continueFrom: PREV })
    const grain = nodeOf(wf, 'Film Grain')!
    expect(grain.inputs.image).toEqual([titled(wf, 'Drop pinned head')![0], 0])
    expect(nodeOf(wf, 'CreateVideo')!.inputs.audio).toEqual([
      titled(wf, 'Drop pinned head (sound)')![0],
      0,
    ])
  })

  it('drops a start or end frame, which would fight the pinned head', () => {
    const wf = build({ continueFrom: PREV, inputImage: 'a.png', endImage: 'b.png' })
    // Nothing can honour two different things at frame 0. The only LoadImage
    // that may survive is a ref2v reference, and this is t2v.
    expect(nodeOf(wf, 'LoadImage')).toBeUndefined()
    expect(nodeOf(wf, 'MiniMaxH3ImageToVideo')!.inputs.first_frame).toBeUndefined()
    expect(nodeOf(wf, 'MiniMaxH3ImageToVideo')!.inputs.last_frame).toBeUndefined()
  })

  it('makes RIFE interpolate the trimmed clip, not the pinned head', () => {
    // The ordering trap: RIFE used to read the decoder directly, which would
    // put the pinned second straight back into the delivered clip.
    const wf = build({ continueFrom: PREV, rife: true })
    const rife = nodeOf(wf, 'RIFEInterpolation')!
    expect(rife.inputs.images).toEqual([titled(wf, 'Drop pinned head')![0], 0])
    expect(rife.inputs.images).not.toEqual([
      Object.entries(wf).find(([, n]) => n.class_type === 'VAEDecode')![0],
      0,
    ])
  })

  it('still composes with film grain and the Fast tier', () => {
    const wf = build({ continueFrom: PREV, rife: true, filmGrain: true, turbo: 'fast' })
    expect(danglingLinks(wf)).toEqual([])
    expect(nodeOf(wf, 'MiniMaxH3AddGuide')).toBeDefined()
    expect(nodeOf(wf, 'MiniMaxH3SigmaShift')).toBeDefined()
  })

  it('has exactly one tail-extract and one head-trim of each kind', () => {
    const wf = build({ continueFrom: PREV })
    expect(allOf(wf, 'ImageFromBatch')).toHaveLength(2)
    expect(allOf(wf, 'TrimAudioDuration')).toHaveLength(2)
    expect(danglingLinks(wf)).toEqual([])
  })

  it('reports the delivered duration, which is shorter than what was sampled', () => {
    // 124 sampled - 22 pinned = 102 delivered = 4.25 s. A UI totalling the
    // slider value instead would over-report by ~0.92 s per link.
    expect(h3DeliveredSeconds(5)).toBeCloseTo((124 - H3_CONTEXT_FRAMES) / H3_FPS, 6)
    expect(h3DeliveredSeconds(5)).toBeLessThan(5)
  })
})
