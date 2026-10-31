import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  minimaxH3Workflow,
  H3_SAVE_CRF,
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
  H3_UPSCALE_SCALE,
  H3_TURBO_STRENGTH,
  H3_GRAIN_INTENSITY,
  H3_SHARPEN_STRENGTH,
  H3_REF2VA_CKPT,
  H3_EROS,
  h3UsesEros,
  H3_REF_BUDGET,
  H3_REF_ROLES,
  compactRefRoles,
  orderedRefImages,
  refPictureNumber,
  h3RefCount,
  compactRefs,
  h3Task,
  H3_REALISM_LORA,
  H3_REALISM_STRENGTH,
  H3_REALISM_TRIGGER,
  withRealismTrigger,
  H3_CONTEXT_FRAMES,
  h3DeliveredSeconds,
  H3_EDIT,
  H3_EDIT_MAX_FRAMES,
  h3EditFrames,
  H3_HYBRID,
  H3_SPARSEREF,
  h3Profile,
  h3KeyframeFrames,
  h3Keyframes,
  h3RefCheckpointReady,
  h3KeyframeClipSeconds,
  h3EditPlan,
  H3_EDIT_PICTURE_MAX,
  h3EditPictures,
  h3EditPrompt,
  h3EditFaceSwap,
  h3HeadSwapPrompt,
  H3_EDIT_FFP_LORA,
  h3EditKind,
  h3LooseEditPrompt,
} from './minimax-h3'
import { planEditChunks } from './h3-edit-chunks'
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

  it('saves at high quality, so a Continue starts from clean frames', () => {
    // Core SaveVideo's auto mode encodes at crf 23 (~1.4 Mbit/s at 736x1344), and a Continue loads that mp4 as its
    // frozen head: every link inherited the last one's compression blotches (Hotel Confession review, 2026-10-15).
    const save = nodeOf(build({}), 'SaveVideo')!.inputs
    expect(save.format).toBe('mp4')
    expect(save['format.codec']).toBe('h264')
    expect(save['format.codec.encoding']).toBe('re-encode')
    expect(save['format.codec.encoding.crf']).toBe(H3_SAVE_CRF)
    expect(save.codec).toBeUndefined()
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

    const wf = build({ sharpen: true, rife: true, filmGrain: true })
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

  it('holds the whole chain back when the swap runs first', () => {
    // `swapFaces` defers all four passes to the swap job, which then runs them
    // over the swapped frames. Anything still emitted here would be applied
    // twice — and grain, being opt-OUT, is the one that would slip through a
    // check that only looked at the explicitly-ticked passes.
    const wf = build({ swapFaces: true, rife: true, upscale: true, sharpen: true })
    for (const cls of ['RIFEInterpolation', 'RTXVideoSuperResolution', 'ImageSharpenKJ', 'Film Grain']) {
      expect(nodeOf(wf, cls)).toBeUndefined()
    }
    // The clip is still saved — it is just not finished yet.
    expect(nodeOf(wf, 'SaveVideo')).toBeDefined()
  })

  it('upscales after RIFE and before the sharpener, and only when asked', () => {
    expect(nodeOf(build({}), 'RTXVideoSuperResolution')).toBeUndefined()

    const wf = build({ upscale: true, sharpen: true, rife: true, filmGrain: true })
    const up = nodeOf(wf, 'RTXVideoSuperResolution')!
    // The dynamic-combo spelling again. A nested object is accepted by the
    // server and dropped, and the node then dies on a missing argument — so
    // assert the dotted key, which is the part that is easy to get wrong.
    expect(up.inputs.resize_type).toBe('scale by multiplier')
    expect(up.inputs['resize_type.scale']).toBe(H3_UPSCALE_SCALE)
    expect(up.inputs.quality).toBe('ULTRA')

    // Reads the interpolated frames: upscaling first would make RIFE
    // interpolate four times the pixels for nothing.
    expect(up.inputs.images).toEqual([idFor(wf, 'RIFEInterpolation'), 0])

    // And both later passes run at the delivered size — sharpen on the
    // upscaler, grain on the sharpener. Grain magnified 2x is blotches.
    const upId = idFor(wf, 'RTXVideoSuperResolution')
    expect(nodeOf(wf, 'ImageSharpenKJ')!.inputs.image).toEqual([upId, 0])
    expect(nodeOf(wf, 'Film Grain')!.inputs.image).toEqual([idFor(wf, 'ImageSharpenKJ'), 0])
  })

  it('upscales the trimmed clip in a continuation, not the pinned head', () => {
    const wf = build({ upscale: true, continueFrom: 'prev.mp4' })
    // Two ImageFromBatch nodes exist here; only the one fed by the decoder is
    // the trim that drops this render's pinned head. Upscaling the other would
    // re-attach frames the clip is supposed to throw away.
    const decodeId = idFor(wf, 'VAEDecode')
    const trim = Object.entries(wf).find(
      ([, n]) => n.class_type === 'ImageFromBatch' && (n.inputs.image as string[])?.[0] === decodeId,
    )!
    expect(nodeOf(wf, 'RTXVideoSuperResolution')!.inputs.images).toEqual([trim[0], 0])
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
      Object.values(build({ upscale: true, filmGrain: false })).map((n) => n.class_type).filter((c) => !CORE_NODES.has(c)),
    ).toEqual(['RTXVideoSuperResolution'])
    expect(
      Object.values(build({ filmGrain: true })).map((n) => n.class_type).filter((c) => !CORE_NODES.has(c)),
    ).toEqual(['Film Grain'])
    // And the default graph has none of them at all (grain went opt-in 2026-10-14).
    expect(Object.values(build({})).map((n) => n.class_type).filter((c) => !CORE_NODES.has(c))).toEqual([])
  })
})

const CORE_NODES = new Set([
  'UNETLoader', 'CLIPLoader', 'VAELoader', 'LoadImage', 'MiniMaxH3ImageToVideo',
  'MiniMaxH3ReferenceToVideo', 'LoadVideo', 'GetVideoComponents', 'LoadAudio',
  'KSamplerSelect', 'BasicScheduler', 'BasicGuider', 'RandomNoise',
  'SamplerCustomAdvanced', 'VAEDecode', 'VAEDecodeAudio', 'CreateVideo', 'SaveVideo',
  'LoraLoaderModelOnly', 'MiniMaxH3SigmaShift',
  // Continuation's head trim and size match. Its one non-core node is our own
  // RaccoonH3MaskedPrefix (vendored), asserted in the continuation tests.
  'ImageFromBatch', 'TrimAudioDuration', 'GetImageSize', 'ImageScaleToTotalPixels',
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
    // The card's recipe for beta4 was "use euler/simple 6-8 steps on all
    // modes", and euler/simple 8 stays for beta5 and beta6 (see `H3_EROS`). Swapping only
    // `unet_name` would leave it sampling on
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

  it('never stacks a Turbo LoRA on a merged-turbo model, and shifts only by its card', () => {
    // The form retires the Speed row under Eros, but `turbo` is persisted, so a
    // session that had Fast selected reopens with it still set. Stacking a LoRA
    // distilled for one schedule onto weights already merged onto another is
    // exactly the artefact the author's beta3 notes complain about. The one
    // shift is beta6's card value (10/3), never Fast's.
    const wf = eros({ turbo: 'fast' })
    expect(modelChain(wf)).toEqual(['UNETLoader', 'MiniMaxH3SigmaShift'])
    expect(nodeOf(wf, 'MiniMaxH3SigmaShift')!.inputs).toMatchObject({ shift_video: 10, shift_audio: 3 })
    expect(H3_EROS.shift).toEqual({ video: 10, audio: 3 })
    expect(nodeOf(wf, 'BasicScheduler')!.inputs.steps).toBe(H3_EROS.steps)
  })

  it('puts the shift after the LoRAs, so no LoRA patches an already-shifted model', () => {
    expect(modelChain(eros({ lora1: 'style.safetensors', lora1Strength: 0.8 }))).toEqual([
      'UNETLoader',
      'lora:style.safetensors@0.8',
      'MiniMaxH3SigmaShift',
    ])
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

  it('renders reference mode too, on its own recipe and with no Turbo LoRA', () => {
    // beta4's unquantized tensors are bit-identical to the stock ref2va build,
    // so reference mode is a checkpoint pick like any other mode — it must load
    // Eros over `H3_REF2VA_CKPT`, keep euler/simple, and still refuse to stack
    // ref2va's distillation on weights that already carry one.
    const wf = eros({ mode: 'ref2v', refImages: ['a.png'], turbo: 'fast', ref2vTurbo: true })
    expect(nodeOf(wf, 'UNETLoader')!.inputs.unet_name).toBe(H3_EROS.ckpt)
    expect(nodeOf(wf, 'MiniMaxH3ReferenceToVideo')).toBeDefined()
    expect(nodeOf(wf, 'KSamplerSelect')!.inputs.sampler_name).toBe('euler')
    expect(nodeOf(wf, 'BasicScheduler')!.inputs.steps).toBe(H3_EROS.steps)
    expect(modelChain(wf)).toEqual(['UNETLoader', 'MiniMaxH3SigmaShift'])
    // The stock checkpoint is still what a `base` pick loads there.
    expect(
      nodeOf(build({ mode: 'ref2v', refImages: ['a.png'] }), 'UNETLoader')!.inputs.unet_name,
    ).toBe(H3_REF2VA_CKPT)
    expect(h3UsesEros({ h3Checkpoint: 'eros' })).toBe(true)
    expect(h3UsesEros({})).toBe(false)
    expect(h3UsesEros()).toBe(false)
  })

  it('takes the low end of the step range for seed-hunt candidates', () => {
    // With no Draft tier to drop to, the step cut IS the whole hunt discount —
    // without it the form would promise cheap candidates that each cost a full
    // render. beta6's card starts at 8, so the 6-step candidate sits below it (see `H3_EROS`).
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
    // int8, never the fp8_scaled sibling — that is the format DynamicVRAM
    // renders as tiled garbage, and it is on by default here. beta6's filename
    // says only `_int8`; its layers carry per-layer int8 `comfy_quant` blobs.
    expect(asset.name).toContain('_int8')
    expect(asset.name).not.toContain('fp8')
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

  it('splices RIFE between the decode and the video, lifting the container fps', () => {
    const wf = build({ rife: true, filmGrain: false })
    const rife = nodeOf(wf, 'RIFEInterpolation')!
    expect(rife.inputs.source_fps).toBe(H3_FPS)
    expect(rife.inputs.target_fps).toBe(H3_RIFE_FPS)
    expect(H3_RIFE_FPS).toBe(H3_FPS * 1.5)
    // The container fps must move with it. H3 generates the audio jointly and
    // RIFE never touches it, so a mismatch plays the video slow against its own
    // soundtrack.
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
  it('is OFF by default and only an explicit true adds it', () => {
    // Opt-in since 2026-10-14: the realism adapter took over the "airbrushed
    // skin" job and the clips the owner called very good had no grain.
    expect(nodeOf(build(), 'Film Grain')).toBeUndefined()
    expect(nodeOf(build({ filmGrain: undefined }), 'Film Grain')).toBeUndefined()
    expect(nodeOf(build({ filmGrain: false }), 'Film Grain')).toBeUndefined()
    expect(nodeOf(build({ filmGrain: true }), 'Film Grain')).toBeDefined()
  })

  it('sits between the decode and the video, at the stills intensity', () => {
    const wf = build({ filmGrain: true })
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
    const wf = build({ seedHunt: true, filmGrain: true })
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
    const wf = refs({ turbo: true, rife: true, lora1: 'x.safetensors', filmGrain: true })
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

  // A continuation renders as t2v plus the previous clip's tail pinned at
  // frame 0, so the writer is not writing an opening: it is writing what
  // happens next to a person, an outfit and a room that are already on
  // screen. Reported as t2v it invented all three (seen live 2026-09-14).
  it('is its own task when a clip is being continued, whatever the frame slots hold', () => {
    expect(h3Task(base({ mode: 't2v', continueFrom: 'video/a.mp4' }))).toBe('continue')
    // The builder clears both frame slots for a continuation; the task must
    // agree with it rather than promote a stale start frame to i2v.
    expect(h3Task(base({ mode: 'i2v', inputImage: 's.png', continueFrom: 'video/a.mp4' }))).toBe('continue')
    // Reference mode still loads its pictures alongside the pinned tail, so
    // the reference doctrine keeps precedence.
    expect(h3Task(base({ mode: 'ref2v', continueFrom: 'video/a.mp4' }))).toBe('ref2v')
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
    // Byte-identical, not merely "no prefix node": a graph that gained even a
    // dangling node would miss ComfyUI's execution cache on every old render.
    expect(build({})).toEqual(build({ continueFrom: undefined }))
    expect(nodeOf(build({}), 'RaccoonH3MaskedPrefix')).toBeUndefined()
  })

  it('reads the previous clip out of the output dir, not input', () => {
    // Without the annotation LoadVideo resolves against input/ and the render
    // dies on a missing file — the clip we want is one SaveVideo wrote.
    const load = nodeOf(build({ continueFrom: PREV }), 'LoadVideo')!
    expect(load.inputs.file).toBe(`${PREV} [output]`)
  })

  it('freezes the previous clip into the latent the sampler starts from', () => {
    const wf = build({ continueFrom: PREV })
    const [prefixId, prefix] = allOf(wf, 'RaccoonH3MaskedPrefix')[0]
    const [condId] = allOf(wf, 'MiniMaxH3ImageToVideo')[0]
    const [splitId] = allOf(wf, 'GetVideoComponents')[0]
    const [fitId] = allOf(wf, 'ImageScaleToTotalPixels')[0]
    expect(prefix.inputs.latent).toEqual([condId, 1])
    // The whole clip, picture and sound: the node slices the tail itself, the
    // sound by time, so the two can never drift apart the way two trim nodes did.
    // The picture at this render's size (see the sizing test), the sound as is.
    expect(prefix.inputs.video).toEqual([fitId, 0])
    expect(prefix.inputs.audio).toEqual([splitId, 1])
    expect(prefix.inputs.context_frames).toBe(H3_CONTEXT_FRAMES)
    expect(nodeOf(wf, 'SamplerCustomAdvanced')!.inputs.latent_image).toEqual([prefixId, 0])
    // The conditioning is untouched — no keyframe pin any more.
    expect(nodeOf(wf, 'BasicGuider')!.inputs.conditioning).toEqual([condId, 0])
    expect(nodeOf(wf, 'MiniMaxH3AddGuide')).toBeUndefined()
  })

  it('pins a length on both the frame grid and the 40 Hz audio grid', () => {
    // The node refuses anything else; 22, the old AddGuide pin, is 36.67 ticks.
    expect(H3_CONTEXT_FRAMES % 17).toBe(5)
    expect((H3_CONTEXT_FRAMES * 40) % H3_FPS).toBe(0)
  })

  it('gives the prefix node the video VAE and the audio VAE the right way round', () => {
    // Two VAELoaders in this graph; swapping them fails deep inside the node.
    const wf = build({ continueFrom: PREV })
    const prefix = nodeOf(wf, 'RaccoonH3MaskedPrefix')!
    expect(prefix.inputs.vae).toEqual(nodeOf(wf, 'VAEDecode')!.inputs.vae)
    expect(prefix.inputs.audio_vae).toEqual(nodeOf(wf, 'VAEDecodeAudio')!.inputs.vae)
    expect(prefix.inputs.vae).not.toEqual(prefix.inputs.audio_vae)
  })

  it('takes its size from the source clip, not from the form', () => {
    // Reported from a real render: a portrait 672x960 source continued while
    // the form said landscape came back 1088x608. The pin resized the guide to
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
    const fit = allOf(wf, 'ImageScaleToTotalPixels')[0]
    expect(fit[1].inputs.image).toEqual([split[0], 0])
    expect(size[1].inputs.image).toEqual([fit[0], 0])
  })

  it("takes the source's shape but this render's budget, so an upscaled clip does not grow the next link", () => {
    // Measured on a helper chain with Upscale on: 480x864 → 720x1296 → 1072x1936,
    // each link sized off the previous link's already-upscaled file.
    for (const vramMode of ['low', 'medium', 'high'] as const) {
      const fit = nodeOf(build({ continueFrom: PREV, vramMode, upscale: true, orientation: 'portrait' }), 'ImageScaleToTotalPixels')!
      const d = h3Dims(9 / 16, BUDGET_MP[vramMode])
      expect(fit.inputs.megapixels).toBeCloseTo((d.w * d.h) / (1024 * 1024), 9)
      // H3 renders only on the /32 grid.
      expect(fit.inputs.resolution_steps).toBe(32)
    }
  })

  it('keeps a continuation inside the canvas at a full-canvas budget', () => {
    // Live, 2026-10-14: at 1.0 MP a 736x1344 link was scaled UP to 768x1376.
    const high = BUDGET_MP.high
    BUDGET_MP.high = 1.0
    try {
      const fit = nodeOf(build({ continueFrom: PREV, vramMode: 'high', orientation: 'portrait' }), 'ImageScaleToTotalPixels')!
      expect(Number(fit.inputs.megapixels) * 1024 * 1024).toBe(736 * 1344)
    } finally {
      BUDGET_MP.high = high
    }
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
    // Film grain rewrites the container's images input, so the trim has to
    // survive as its source — otherwise the pinned head comes back.
    const wf = build({ continueFrom: PREV, filmGrain: true })
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
    expect(nodeOf(wf, 'RaccoonH3MaskedPrefix')).toBeDefined()
    expect(nodeOf(wf, 'MiniMaxH3SigmaShift')).toBeDefined()
  })

  it('has exactly one head-trim of each kind', () => {
    const wf = build({ continueFrom: PREV })
    expect(allOf(wf, 'ImageFromBatch')).toHaveLength(1)
    expect(allOf(wf, 'TrimAudioDuration')).toHaveLength(1)
    expect(danglingLinks(wf)).toEqual([])
  })

  it('reports the delivered duration, which is shorter than what was sampled', () => {
    // 124 sampled - 39 frozen = 85 delivered = 3.54 s. A UI totalling the
    // slider value instead would over-report by ~1.6 s per link.
    expect(h3DeliveredSeconds(5)).toBeCloseTo((124 - H3_CONTEXT_FRAMES) / H3_FPS, 6)
    expect(h3DeliveredSeconds(5)).toBeLessThan(5)
  })
})

describe('reference roles', () => {
  // The one silent failure in this feature: a role id the node does not know is
  // not an error anywhere. `_role_of` returns None, the picture goes into the
  // doctrine unannotated, and the dropdown the user set keeps showing their
  // choice — so the prompt writer guesses exactly as it did before, with the UI
  // insisting otherwise. Nothing else in the app or the pack would catch it.
  it('offers only roles h3_brain.py knows', () => {
    const brain = readFileSync(
      join(process.cwd(), '..', 'comfyui', 'vendor-custom-nodes', 'RaccoonVideoNodes', 'h3_brain.py'),
      'utf-8',
    )
    const table = brain.slice(brain.indexOf('REF_IMAGE_ROLES = {'))
    const known = [...table.slice(0, table.indexOf('}')).matchAll(/^\s{4}"([a-z_]+)":/gm)].map((m) => m[1])
    expect(known.length).toBeGreaterThan(0)
    expect(H3_REF_ROLES.map((r) => r.id).sort()).toEqual(known.sort())
  })

  it('keeps a role with the picture it describes when a slot is cleared', () => {
    // Compacted together, never separately: clearing slot 1 promotes slot 2 to
    // <Picture 1>, and its role has to travel with it.
    expect(compactRefRoles(['a.png', undefined, 'b.png'], ['x', 'y', 'z'])).toEqual(['x', 'z'])
    expect(compactRefRoles(['a.png'], undefined)).toEqual([null])
    expect(compactRefRoles(undefined, ['x'])).toEqual([])
  })

  // Measured 2026-09-13, one seed per leg, same pictures and prompt: with the
  // character in slot 3 H3 kept her own clothes; moved to slot 1, the outfit
  // picture's clothing transferred. H3 treats <Picture 1> as the subject, so
  // the character goes first whatever slot the user filled.
  it('presents the character first, then the outfit, whatever the slot order', () => {
    const files = ['prop.png', 'outfit.png', 'char.png']
    const roles = ['prop', 'outfit', 'character']
    expect(orderedRefImages(files, roles).map((r) => r.file)).toEqual(['char.png', 'outfit.png', 'prop.png'])
    // The roles the writer numbers must follow the same order, or its
    // <Picture N> points at the wrong slot.
    expect(compactRefRoles(files, roles)).toEqual(['character', 'outfit', 'prop'])
    // Ties keep the user's order, and unset slots sort last.
    expect(orderedRefImages(['a.png', 'b.png', 'c.png'], [undefined, 'character', 'character']).map((r) => r.file))
      .toEqual(['b.png', 'c.png', 'a.png'])
    // The slot label says the number the node will actually use.
    expect(refPictureNumber(files, roles, 2)).toBe(1)
    expect(refPictureNumber(files, roles, 0)).toBe(3)
    expect(refPictureNumber(['a.png', undefined, 'c.png'], undefined, 2)).toBe(2)
    // ...and the builder wires the node in that order.
    const wf = build({ mode: 'ref2v', refImages: files, refImageRoles: roles })
    const cond = nodeOf(wf, 'MiniMaxH3ReferenceToVideo')!
    const src = (slot: string) => wf[(cond.inputs[slot] as [string, number])[0]]
    expect(src('ref_images.ref_image_0').inputs.image).toBe('char.png')
  })

  // Same session, same seed: an outfit picture that carries a face outvotes the
  // character picture on identity (two pictures of one person against one of
  // another), and no wording moves it. Cropped below the chin, the character
  // came through wearing the outfit. So outfit and prop pictures are stripped
  // of their faces on the way in; character, location and style are not.
  it('strips the face out of outfit and prop pictures before the node sees them', () => {
    const wf = build({
      mode: 'ref2v',
      refImages: ['char.png', 'outfit.png', 'prop.png', 'room.png'],
      refImageRoles: ['character', 'outfit', 'prop', 'location'],
    })
    const cond = nodeOf(wf, 'MiniMaxH3ReferenceToVideo')!
    const src = (i: number) => wf[(cond.inputs[`ref_images.ref_image_${i}`] as [string, number])[0]]
    expect(src(0).class_type).toBe('LoadImage')
    expect(src(1).class_type).toBe('RaccoonHeadlessReference')
    expect(wf[(src(1).inputs.image as [string, number])[0]].inputs.image).toBe('outfit.png')
    // Position 2 is the location (it sorts before props) and stays whole.
    expect(src(2).class_type).toBe('LoadImage')
    expect(src(3).class_type).toBe('RaccoonHeadlessReference')
    // Unroled pictures are untouched: the pre-roles graph is unchanged.
    const plain = build({ mode: 'ref2v', refImages: ['a.png', 'b.png'] })
    expect(Object.values(plain).some((n) => n.class_type === 'RaccoonHeadlessReference')).toBe(false)
  })

  // Measured 2026-10-11 (owner folder `261011 - H3 Gesichts-Referenz`, 3 seeds):
  // a face close-up beside a character sheet lifted ArcFace against the
  // character's photo 0.315 -> 0.51. It is the same person as the character, so
  // it sorts right behind it and keeps its face — the whole point of it.
  it('offers a face close-up role, shown right after the character and never face-cropped', () => {
    expect(H3_REF_ROLES.map((r) => r.id)).toContain('face')
    const files = ['outfit.png', 'face.png', 'sheet.png']
    const roles = ['outfit', 'face', 'character']
    expect(orderedRefImages(files, roles).map((r) => r.file)).toEqual(['sheet.png', 'face.png', 'outfit.png'])
    const wf = build({ mode: 'ref2v', refImages: files, refImageRoles: roles })
    const cond = nodeOf(wf, 'MiniMaxH3ReferenceToVideo')!
    const src = wf[(cond.inputs['ref_images.ref_image_1'] as [string, number])[0]]
    expect(src.class_type).toBe('LoadImage')
    expect(src.inputs.image).toBe('face.png')
  })
})

describe('typed briefs in reference mode', () => {
  // Roles used to reach the render only through the prompt writer. A brief the
  // user typed went to H3 with no <Picture N> in it, so nothing said which
  // picture was the outfit: measured 2026-10-11, the outfit picture lost to the
  // character sheet's own clothes on 1 of 3 seeds, and on 2 of 3 once a face
  // close-up was added; the same brief written through the tags held it 6/6.
  const roled = (over: Partial<VideoGenerationParams> = {}) =>
    String(nodeOf(build({
      mode: 'ref2v',
      prompt: 'She waves at the camera.',
      refImages: ['room.png', 'outfit.png', 'face.png', 'sheet.png', 'vial.png'],
      refImageRoles: ['location', 'outfit', 'face', 'character', 'prop'],
      ...over,
    }), 'MiniMaxH3ReferenceToVideo')!.inputs.prompt)

  it('declares every picture and binds each roled one ahead of the brief', () => {
    expect(roled()).toBe([
      'For the target video, the attached references are used as follows: <Picture 1> is partially_preserved. ' +
        '<Picture 2> is attribute_transfer. <Picture 3> is attribute_transfer. <Picture 4> is fully_preserved. ' +
        '<Picture 5> is fully_preserved.',
      '',
      'The character in every shot is the person from <Picture 1>. ' +
        'The character has the face from <Picture 2>: the same person, seen close up. ' +
        'The character wears the outfit from <Picture 3> in every shot, in place of the clothes in <Picture 1>. ' +
        'The object in the scene is the object from <Picture 5>. ' +
        'The setting is the place from <Picture 4>.',
      '',
      'She waves at the camera.',
    ].join('\n'))
  })

  it('keeps the declaration first when the realism trigger is added', () => {
    const lines = roled({ realismLora: true }).split('\n')
    expect(lines[0]).toMatch(/^For the target video/)
    expect(lines[2]).toBe(H3_REALISM_TRIGGER)
    expect(lines.at(-1)).toBe('She waves at the camera.')
  })

  it('leaves a prompt that already cites its pictures alone', () => {
    const written = 'For the target video, the attached references are used as follows: <Picture 1> is fully_preserved.\n\nx'
    expect(roled({ prompt: written })).toBe(written)
  })

  it('leaves an unroled reference render exactly as typed', () => {
    expect(roled({ refImageRoles: undefined })).toBe('She waves at the camera.')
  })

  it('declares an unroled picture the way the writer does, and binds nothing for it', () => {
    const p = roled({ refImages: ['sheet.png', 'extra.png'], refImageRoles: ['character', undefined] })
    expect(p.split('\n')[0]).toBe(
      'For the target video, the attached references are used as follows: <Picture 1> is fully_preserved. <Picture 2> is fully_preserved.',
    )
    expect(p).not.toContain('from <Picture 2>')
  })

  // The writer's repair in h3_brain.py (`_bind_roled_pictures`) says the same
  // sentences; two wordings for one role would be two things to measure.
  it('binds with the same sentences as the prompt writer', () => {
    const brain = readFileSync(
      join(process.cwd(), '..', 'comfyui', 'vendor-custom-nodes', 'RaccoonVideoNodes', 'h3_brain.py'),
      'utf-8',
    )
    const table = brain.slice(brain.indexOf('_BIND_CLAUSE = {'))
    const py = Object.fromEntries(
      // The clauses hold `{tag}`, so the table ends at the first `}` on a line of its own.
      [...table.slice(0, table.indexOf('\n}')).matchAll(/^\s{4}"([a-z_]+)": "([^"]+)"/gm)].map((m) => [m[1], m[2]]),
    )
    expect(Object.keys(py).sort()).toEqual(H3_REF_ROLES.map((r) => r.id).sort())
    const p = roled({
      refImages: ['sheet.png', 'face.png', 'outfit.png', 'room.png', 'vial.png', 'board.png'],
      refImageRoles: ['character', 'face', 'outfit', 'location', 'prop', 'style'],
    })
    const roles = brain.slice(brain.indexOf('REF_IMAGE_ROLES = {'))
    const markers = Object.fromEntries(
      [...roles.slice(0, roles.indexOf('\n}')).matchAll(/^\s{4}"([a-z_]+)": \("[^"]*", "([a-z_]+)"\)/gm)].map((m) => [m[1], m[2]]),
    )
    for (const [role, clause] of Object.entries(py)) {
      const n = ['character', 'face', 'outfit', 'location', 'prop', 'style'].indexOf(role) + 1
      expect(p, role).toContain(clause.replace('{tag}', `<Picture ${n}>`).replace('{char}', '<Picture 1>'))
      // The character beside an outfit is partially_preserved in both (`ref_marker`).
      expect(p.split('\n')[0], role).toContain(`<Picture ${n}> is ${role === 'character' ? 'partially_preserved' : markers[role]}.`)
    }
  })
})

describe('edit mode', () => {
  const SRC = 'video/MinimaxH3/2026-09-06/cafe.mp4 [output]'
  const edit = (over: Partial<VideoGenerationParams> = {}) =>
    build({
      mode: 'edit', prompt: 'Change her blazer into a red leather jacket', editSource: SRC,
      editKind: 'vfx', editSourceWidth: 864, editSourceHeight: 480, editSourceFrames: 124,
      editSourceHasAudio: true, filmGrain: false, ...over,
    })

  it('snaps the source length down to the 17k+5 grid and caps it at 15 s', () => {
    expect(h3EditFrames(124)).toBe(124)
    expect(h3EditFrames(140)).toBe(124)
    expect(h3EditFrames(175)).toBe(175)
    expect(h3EditFrames(370)).toBe(H3_EDIT_MAX_FRAMES)
    expect(h3EditFrames(373)).toBeNull() // over 15.5 s: refused, not silently cut
    expect(h3EditFrames(4)).toBeNull()
  })

  it('conditions in reference mode with no references at all', () => {
    const wf = edit({ refImages: ['stale.png'], refVideos: ['stale.mp4'] })
    expect(nodeOf(wf, 'MiniMaxH3ReferenceToVideo')).toBeDefined()
    // Reference slots are the dotted Autogrow keys; `ref_image_size` is a setting.
    expect(Object.keys(nodeOf(wf, 'MiniMaxH3ReferenceToVideo')!.inputs).some((k) => k.startsWith('ref_') && k.includes('.'))).toBe(false)
    expect(nodeOf(wf, 'LoadImage')).toBeUndefined()
  })

  it('loads the source at 24 fps, at the budget size, for the grid length', () => {
    const wf = edit({ editSourceWidth: 1920, editSourceHeight: 1080, editSourceFrames: 150, vramMode: 'medium' })
    const vhs = nodeOf(wf, 'VHS_LoadVideo')!
    const cond = nodeOf(wf, 'MiniMaxH3ReferenceToVideo')!
    expect(vhs.inputs.video).toBe(SRC)
    expect(vhs.inputs.force_rate).toBe(H3_FPS)
    expect([vhs.inputs.custom_width, vhs.inputs.custom_height]).toEqual([cond.inputs.width, cond.inputs.height])
    expect(cond.inputs.width).toBe(h3Dims(1920 / 1080, BUDGET_MP.medium).w)
    expect(vhs.inputs.frame_load_cap).toBe(141)
    expect(cond.inputs.length).toBe(141)
  })

  it('anchors the whole clip at frame 0 between the conditioning and the guider', () => {
    const wf = edit()
    const [guideId, guide] = Object.entries(wf).find(([, n]) => n.class_type === 'MiniMaxH3AddGuide')!
    const [condId] = Object.entries(wf).find(([, n]) => n.class_type === 'MiniMaxH3ReferenceToVideo')!
    const [vhsId] = Object.entries(wf).find(([, n]) => n.class_type === 'VHS_LoadVideo')!
    expect(guide.inputs.positive).toEqual([condId, 0])
    expect(guide.inputs.latent).toEqual([condId, 1])
    expect(guide.inputs.image).toEqual([vhsId, 0])
    expect(guide.inputs.frame_idx).toBe(0)
    expect(guide.inputs.audio).toBeUndefined()
    expect(nodeOf(wf, 'BasicGuider')!.inputs.conditioning).toEqual([guideId, 0])
    expect(danglingLinks(wf)).toEqual([])
  })

  it('puts the edit LoRA first and its trigger in front of the instruction', () => {
    const wf = edit({ lora1: 'char.safetensors' })
    expect(modelChain(wf)[1]).toBe(`lora:${H3_EDIT.vfx.lora}@1`)
    expect(modelChain(wf)).toContain('lora:char.safetensors@1')
    expect(nodeOf(wf, 'MiniMaxH3ReferenceToVideo')!.inputs.prompt)
      .toBe('vfx_edit: Change her blazer into a red leather jacket')
    const style = edit({ editKind: 'style', prompt: 'Transform this video into anime' })
    expect(modelChain(style)[1]).toBe(`lora:${H3_EDIT.style.lora}@1`)
    expect(nodeOf(style, 'MiniMaxH3ReferenceToVideo')!.inputs.prompt).toBe('style_transfer: Transform this video into anime')
  })

  it("delivers the source's sound, or H3's own when the source has none", () => {
    const wf = edit()
    const [vhsId] = Object.entries(wf).find(([, n]) => n.class_type === 'VHS_LoadVideo')!
    expect(nodeOf(wf, 'CreateVideo')!.inputs.audio).toEqual([vhsId, 2])
    const silent = edit({ editSourceHasAudio: false })
    const [decodeId] = Object.entries(silent).find(([, n]) => n.class_type === 'VAEDecodeAudio')!
    expect(nodeOf(silent, 'CreateVideo')!.inputs.audio).toEqual([decodeId, 0])
  })

  it("ignores every other mode's leftovers", () => {
    const wf = edit({ continueFrom: 'old.mp4', inputImage: 'a.png', endImage: 'b.png', seedHunt: true, realismLora: true })
    expect(nodeOf(wf, 'RaccoonH3MaskedPrefix')).toBeUndefined()
    expect(nodeOf(wf, 'LoadVideo')).toBeUndefined()
    expect(nodeOf(wf, 'VHS_VideoCombine')).toBeUndefined() // no seed-hunt temp clip
    expect(modelChain(wf).some((s) => s.includes('realism'))).toBe(false)
  })

  it('refuses a source it cannot render instead of building a broken graph', () => {
    expect(() => edit({ editSourceFrames: 400 })).toThrow(/15 s/)
    expect(() => edit({ editSourceFrames: undefined })).toThrow(/clip/)
    expect(() => edit({ editSource: undefined })).toThrow(/clip/)
  })

  it('renders Eros when picked, stock reference weights otherwise', () => {
    expect(nodeOf(edit({ h3Checkpoint: 'eros' }), 'UNETLoader')!.inputs.unet_name).toBe(H3_EROS.ckpt)
    expect(nodeOf(edit(), 'UNETLoader')!.inputs.unet_name).toBe(H3_REF2VA_CKPT)
  })

  it('changes nothing for the other modes', () => {
    expect(build({})).toEqual(build({ editSource: SRC, editKind: 'vfx' }))
  })

  it('offers both edit LoRAs as optional downloads, credited', () => {
    for (const kind of ['vfx', 'style', 'head'] as const) {
      const a = MINIMAX_H3_ASSETS.find((x) => x.name === H3_EDIT[kind].lora)!
      expect(a, kind).toBeDefined()
      expect(a.optional).toBe(true)
      expect(a.folder).toBe('loras')
      expect(a.url).toBe(`https://huggingface.co/Alissonerdx/Minimax-H3-ComfyUI/resolve/main/loras/${H3_EDIT[kind].lora}`)
      expect(a.source).toMatch(/Alissonerdx/)
    }
  })

    describe('parts', () => {
      const long = (over: Partial<VideoGenerationParams> = {}) =>
        edit({ editSourceWidth: 608, editSourceHeight: 1056, editSourceFrames: 362, vramMode: 'medium', ...over })
      const all = (wf: Record<string, ComfyUIPromptNode>, cls: string) =>
        Object.entries(wf).filter(([, n]) => n.class_type === cls)

      it('plans from the render size the builder uses', () => {
        const wf = long()
        const cond = nodeOf(wf, 'MiniMaxH3ReferenceToVideo')!
        const cells = (Number(cond.inputs.width) / 32) * (Number(cond.inputs.height) / 32)
        expect(cells).toBe(627)
        expect(h3EditPlan(base({ mode: 'edit', editSourceWidth: 608, editSourceHeight: 1056, editSourceFrames: 362, vramMode: 'medium' })))
          .toEqual(planEditChunks(362, 627, 'seamless'))
      })

      it('plan follows tier', () => {
        const p = { mode: 'edit' as const, editSourceWidth: 608, editSourceHeight: 1056, editSourceFrames: 362 }
        expect(h3EditPlan({ ...p, vramMode: 'medium' })!.length).toBe(3)
        expect(h3EditPlan({ ...p, vramMode: 'low' })!.length).toBeLessThan(3)
        expect(h3EditPlan({ ...p, mode: 't2v', vramMode: 'medium' })).toBeNull()
        expect(h3EditPlan({ ...p, editSourceFrames: 400, vramMode: 'medium' })).toBeNull()
      })

      it('renders one branch per part, each loading its own span', () => {
        const wf = long()
        const plan = planEditChunks(362, 627, 'seamless')
        const loads = all(wf, 'VHS_LoadVideo').map(([, n]) => [n.inputs.skip_first_frames, n.inputs.frame_load_cap])
        expect(loads).toEqual(plan.map((c) => [c.start, c.frames]))
        expect(all(wf, 'MiniMaxH3ReferenceToVideo').map(([, n]) => n.inputs.length)).toEqual(plan.map((c) => c.frames))
        expect(new Set(all(wf, 'MiniMaxH3ReferenceToVideo').map(([, n]) => n.inputs.prompt)).size).toBe(1)
        const samplers = all(wf, 'SamplerCustomAdvanced').map(([, n]) => n.inputs)
        expect(samplers.length).toBe(3)
        for (const s of samplers) {
          expect([s.noise, s.sampler, s.sigmas]).toEqual([samplers[0].noise, samplers[0].sampler, samplers[0].sigmas])
        }
        const guiders = all(wf, 'BasicGuider').map(([, n]) => n.inputs.model)
        expect(new Set(guiders.map((g) => JSON.stringify(g))).size).toBe(1)
        expect(danglingLinks(wf)).toEqual([])
      })

      it('freezes the previous part tail when Seamless', () => {
        const wf = long()
        const decodes = all(wf, 'VAEDecode').map(([id]) => id)
        const prefixes = all(wf, 'RaccoonH3MaskedPrefix').map(([, n]) => n.inputs)
        expect(prefixes.length).toBe(2)
        expect(prefixes.map((p) => p.video)).toEqual([[decodes[0], 0], [decodes[1], 0]])
        expect(prefixes.every((p) => p.context_frames === 39)).toBe(true)
        const cuts = all(wf, 'ImageFromBatch').map(([, n]) => n.inputs.batch_index)
        expect(cuts).toEqual([39, 39])
      })

      it('wires every extra part through its own load, guide, guider and latent', () => {
      for (const join of ['seamless', 'fast'] as const) {
        const wf = long({ editJoin: join })
        const loads = all(wf, 'VHS_LoadVideo').map(([id]) => id)
        const guides = all(wf, 'MiniMaxH3AddGuide').map(([id, n]) => ({ id, n }))
        expect(guides.map((g) => g.n.inputs.image), join).toEqual(loads.map((id) => [id, 0]))
        const conds = all(wf, 'MiniMaxH3ReferenceToVideo').map(([id]) => id)
        expect(guides.map((g) => g.n.inputs.latent), join).toEqual(conds.map((id) => [id, 1]))
        const guiders = all(wf, 'BasicGuider').map(([id, n]) => ({ id, n }))
        expect(guiders.map((g) => g.n.inputs.conditioning), join).toEqual(guides.map((g) => [g.id, 0]))
        const samplers = all(wf, 'SamplerCustomAdvanced').map(([, n]) => n.inputs)
        expect(samplers.map((s) => s.guider), join).toEqual(guiders.map((g) => [g.id, 0]))
        const prefixes = all(wf, 'RaccoonH3MaskedPrefix').map(([id, n]) => ({ id, n }))
        // Part 1 samples its conditioning's latent; every later part samples its
        // frozen-tail latent when Seamless, its own conditioning's when Fast.
        expect(samplers.map((s) => s.latent_image), join).toEqual([
          [conds[0], 1],
          ...conds.slice(1).map((c, i) => (join === 'seamless' ? [prefixes[i].id, 0] : [c, 1])),
        ])
        if (join === 'seamless') expect(prefixes.map((p) => p.n.inputs.latent)).toEqual(conds.slice(1).map((c) => [c, 1]))
      }
    })

    it('renders the parts independently when Fast, dropping the 5-frame pad', () => {
        const wf = long({ editJoin: 'fast' })
        expect(nodeOf(wf, 'RaccoonH3MaskedPrefix')).toBeUndefined()
        expect(all(wf, 'ImageFromBatch').map(([, n]) => n.inputs.batch_index)).toEqual([5])
        expect(all(wf, 'SamplerCustomAdvanced').length).toBe(2)
      })

      it('unknown join renders Seamless', () => {
        const wf = long({ editJoin: 'smooth' as unknown as 'fast' })
        expect(all(wf, 'RaccoonH3MaskedPrefix').length).toBe(2)
      })

      it("stitches the frames and the source's sound in order", () => {
        const wf = long()
        const video = nodeOf(wf, 'CreateVideo')!
        const [lastBatchId] = all(wf, 'ImageBatch').at(-1)!
        expect(video.inputs.images).toEqual([lastBatchId, 0])
        const [lastCatId] = all(wf, 'AudioConcat').at(-1)!
        expect(video.inputs.audio).toEqual([lastCatId, 0])
        expect(all(wf, 'AudioConcat').every(([, n]) => n.inputs.direction === 'after')).toBe(true)
        const vhsIds = all(wf, 'VHS_LoadVideo').map(([id]) => id)
        const trims = all(wf, 'TrimAudioDuration').map(([, n]) => n.inputs)
        expect(trims.map((t) => t.audio)).toEqual(vhsIds.map((id) => [id, 2]))
        const plan = planEditChunks(362, 627, 'seamless')
        expect(trims.map((t) => [t.start_index, t.duration])).toEqual(plan.map((c) => [c.overlap / 24, (c.frames - c.overlap) / 24]))
      })

      it('silent source', () => {
        const wf = long({ editSourceHasAudio: false })
        const decA = all(wf, 'VAEDecodeAudio').map(([id]) => id)
        expect(all(wf, 'TrimAudioDuration').map(([, n]) => n.inputs.audio)).toEqual(decA.map((id) => [id, 0]))
      })

      it('post chain reads the stitch', () => {
        const wf = long({ rife: true })
        const [lastBatchId] = all(wf, 'ImageBatch').at(-1)!
        expect(nodeOf(wf, 'RIFEInterpolation')!.inputs.images).toEqual([lastBatchId, 0])
        const deferred = long({ swapFaces: true })
        const [deferredBatch] = all(deferred, 'ImageBatch').at(-1)!
        expect(nodeOf(deferred, 'CreateVideo')!.inputs.images).toEqual([deferredBatch, 0])
      })

      it('is deterministic and leaves one-part edits exactly as before', () => {
        expect(long()).toEqual(long())
        expect(edit({ editJoin: 'fast' })).toEqual(edit())
        expect(nodeOf(edit(), 'ImageBatch')).toBeUndefined()
      })
    })

  describe('pictures', () => {
    const conds = (wf: Record<string, ComfyUIPromptNode>) =>
      Object.values(wf).filter((n) => n.class_type === 'MiniMaxH3ReferenceToVideo')
    const loadOf = (wf: Record<string, ComfyUIPromptNode>, ref: unknown) => {
      let [id] = ref as [string, number]
      if (wf[id].class_type === 'RaccoonHeadlessReference') [id] = wf[id].inputs.image as [string, number]
      return wf[id].inputs.image
    }

    it('orders the pictures character first and gives each a sentence', () => {
      const wf = edit({ editPictures: ['outfit.png', 'me.png'], editPictureRoles: ['outfit', 'character'] })
      const c = conds(wf)[0]
      expect(loadOf(wf, c.inputs['ref_images.ref_image_0'])).toBe('me.png')
      expect(loadOf(wf, c.inputs['ref_images.ref_image_1'])).toBe('outfit.png')
      expect(wf[(c.inputs['ref_images.ref_image_1'] as [string, number])[0]].class_type).toBe('RaccoonHeadlessReference')
      expect(c.inputs.prompt).toBe(
        'vfx_edit: Change her blazer into a red leather jacket The new person is the one shown in <Picture 1>, wearing the outfit from <Picture 2> instead of their own clothes. The new outfit is the one shown in <Picture 2>.',
      )
    })

    it('holes keep their roles', () => {
      const p = base({ mode: 'edit', editPictures: ['a.png', undefined, 'c.png'], editPictureRoles: ['location', 'character', 'prop'] })
      expect(h3EditPictures(p)).toEqual([{ file: 'a.png', role: 'location' }, { file: 'c.png', role: 'prop' }])
    })

    it('takes at most H3_EDIT_PICTURE_MAX pictures', () => {
      const p = base({ mode: 'edit', editPictures: ['1.png', '2.png', '3.png', '4.png', '5.png'] })
      expect(h3EditPictures(p).length).toBe(H3_EDIT_PICTURE_MAX)
    })

    it('ignores pictures outside Edit and reference pictures inside it', () => {
      expect(h3EditPictures(base({ mode: 't2v', editPictures: ['a.png'] }))).toEqual([])
      expect(nodeOf(build({ editPictures: ['a.png'] }), 'LoadImage')).toBeUndefined()
      expect(h3EditPictures(base({ mode: 'edit', refImages: ['stale.png'] }))).toEqual([])
    })

    it('sends the same pictures to every part, and counts them in the plan', () => {
      const p = { editSourceWidth: 608, editSourceHeight: 1056, editSourceFrames: 192, vramMode: 'medium' as const }
      expect(h3EditPlan({ ...base({ mode: 'edit', ...p }) })!.length).toBe(1)
      expect(h3EditPlan({ ...base({ mode: 'edit', ...p, editPictures: ['a.png', 'b.png'] }) })!.length).toBe(2)
      const wf = edit({ ...p, editPictures: ['a.png', 'b.png'], editPictureRoles: ['character', 'location'] })
      const all = conds(wf)
      expect(all.length).toBe(2)
      for (const c of all) {
        expect(loadOf(wf, c.inputs['ref_images.ref_image_0'])).toBe('a.png')
        expect(loadOf(wf, c.inputs['ref_images.ref_image_1'])).toBe('b.png')
        expect(c.inputs.prompt).toBe(all[0].inputs.prompt)
      }
      expect(danglingLinks(wf)).toEqual([])
    })

    it('leaves a picture-less edit exactly as before', () => {
      expect(edit({ editPictures: [], editPictureRoles: [] })).toEqual(edit())
      expect(h3EditPrompt(base({ mode: 'edit', prompt: '  make it night  ', editKind: 'style' }))).toBe('style_transfer: make it night')
    })
  })

  describe('face swap', () => {
    const person = { editPictures: ['me.png'], editPictureRoles: ['character'], editFaceChecked: 'me.png' }

    it('swaps the face to the checked Person picture after the edit, before the finishing chain', () => {
      const wf = edit({ ...person, rife: true })
      const [swapId, swap] = Object.entries(wf).find(([, n]) => n.class_type === 'RaccoonVideoFaceSwap')!
      expect(swap.inputs.match_threshold).toBe(0)
      // An unmatched clip is delivered unswapped, not thrown away at the last node.
      expect(swap.inputs.strict).toBe(false)
      const ref = wf[(swap.inputs.reference_1 as [string, number])[0]]
      const src = wf[(swap.inputs.source_image_1 as [string, number])[0]]
      expect([ref.inputs.image, src.inputs.image]).toEqual(['me.png', 'me.png'])
      expect(nodeOf(wf, 'RIFEInterpolation')!.inputs.images).toEqual([swapId, 0])
      expect(danglingLinks(wf)).toEqual([])
    })

    it('swaps the stitched clip of a split edit, not part 1', () => {
      const wf = edit({ ...person, editSourceWidth: 608, editSourceHeight: 1056, editSourceFrames: 362, vramMode: 'medium' })
      const swap = nodeOf(wf, 'RaccoonVideoFaceSwap')!
      const [lastBatch] = Object.entries(wf).filter(([, n]) => n.class_type === 'ImageBatch').at(-1)!
      expect(swap.inputs.image).toEqual([lastBatch, 0])
    })

    it('swap needs THIS picture checked', () => {
      expect(h3EditFaceSwap(base({ mode: 'edit', ...person, editFaceChecked: 'old.png' }))).toBeNull()
      expect(h3EditFaceSwap(base({ mode: 'edit', ...person, editFaceChecked: undefined }))).toBeNull()
      expect(h3EditFaceSwap(base({ mode: 'edit', ...person }))).toBe('me.png')
    })

    it('can be switched off, and never runs without a Person picture', () => {
      expect(h3EditFaceSwap(base({ mode: 'edit', ...person, editSwapFace: false }))).toBeNull()
      expect(h3EditFaceSwap(base({ mode: 'edit', ...person, editPictureRoles: ['location'] }))).toBeNull()
      expect(nodeOf(edit({ ...person, editSwapFace: false }), 'RaccoonVideoFaceSwap')).toBeUndefined()
    })

    it("ignores reference mode's high-fidelity setting", () => {
      // 'max' sizes each picture to a 2048 px short edge — far more tokens than
      // the planner counts, past the measured noise point with 3 pictures.
      const wf = edit({ ...person, refHiFi: true })
      expect(nodeOf(wf, 'MiniMaxH3ReferenceToVideo')!.inputs.ref_image_size).toBe('match')
    })

    it('no swap on restyle', () => {
      expect(h3EditFaceSwap(base({ mode: 'edit', ...person, editKind: 'style' }))).toBeNull()
    })
  })

  describe('swap head', () => {
    const head = { editKind: 'head' as const, prompt: 'Female, fifties, short silver pixie cut', editPictures: ['outfit.png', 'face.png'], editPictureRoles: ['outfit', 'character'] }

    it('uses the head swap LoRA and only the face picture', () => {
      const wf = edit(head)
      expect(modelChain(wf)[1]).toBe(`lora:${H3_EDIT.head.lora}@1`)
      const cond = nodeOf(wf, 'MiniMaxH3ReferenceToVideo')!
      expect(Object.keys(cond.inputs).filter((k) => k.startsWith('ref_images.'))).toEqual(['ref_images.ref_image_0'])
      expect(h3EditPictures(base({ mode: 'edit', ...head }))).toEqual([{ file: 'face.png', role: 'character' }])
    })

    it("writes the author's template with the user's face description", () => {
      const prompt = nodeOf(edit(head), 'MiniMaxH3ReferenceToVideo')!.inputs.prompt as string
      expect(prompt).toBe(h3HeadSwapPrompt('Female, fifties, short silver pixie cut'))
      expect(prompt.startsWith('head_swap:\n')).toBe(true)
      expect(prompt).toContain('Facial details of <Subject 1>:\nFemale, fifties, short silver pixie cut\n')
      expect(prompt).toContain('<Subject 1> is the reference head identity from <Picture 1>')
      for (const s of ['subject_definitions:', 'summary:', 'retention_analysis:', 'detailed_description:', 'overall_soundscape:', 'non_diegetic_music:']) {
        expect(prompt).toContain(s)
      }
    })

    it('takes the first picture as the face when none has the person role', () => {
      expect(h3EditPictures(base({ mode: 'edit', editKind: 'head', editPictures: ['x.png'] }))).toEqual([{ file: 'x.png', role: 'character' }])
    })
  })

  describe('first frame', () => {
    const ff = { editFirstFrame: 'first.png', editPictures: ['me.png'], editPictureRoles: ['character'] }

    it('swaps in the FFP LoRA and makes the first frame <Picture 1>', () => {
      const wf = edit(ff)
      expect(modelChain(wf)[1]).toBe(`lora:${H3_EDIT_FFP_LORA}@1`)
      expect(h3EditPictures(base({ mode: 'edit', ...ff }))).toEqual([
        { file: 'first.png', role: null, firstFrame: true },
        { file: 'me.png', role: 'character' },
      ])
      expect(nodeOf(wf, 'MiniMaxH3ReferenceToVideo')!.inputs.prompt).toBe(
        'vfx_edit: Change her blazer into a red leather jacket <Picture 1> is the edited first frame. The new person is the one shown in <Picture 2>.',
      )
    })

    it('first frame forces seamless', () => {
      const p = base({ mode: 'edit', ...ff, editJoin: 'fast', editSourceWidth: 608, editSourceHeight: 1056, editSourceFrames: 362, vramMode: 'medium' })
      expect(h3EditPlan(p)!.every((c, i) => c.overlap === (i === 0 ? 0 : 39))).toBe(true)
    })

    it("gives each later part the previous part's frame at its start as <Picture 1>", () => {
      const wf = edit({ ...ff, editSourceWidth: 608, editSourceHeight: 1056, editSourceFrames: 362, vramMode: 'medium' })
      const plan = h3EditPlan(base({ mode: 'edit', ...ff, editSourceWidth: 608, editSourceHeight: 1056, editSourceFrames: 362, vramMode: 'medium' }))!
      const conds = Object.values(wf).filter((n) => n.class_type === 'MiniMaxH3ReferenceToVideo')
      const decodes = Object.entries(wf).filter(([, n]) => n.class_type === 'VAEDecode').map(([id]) => id)
      expect(wf[(conds[0].inputs['ref_images.ref_image_0'] as [string, number])[0]].inputs.image).toBe('first.png')
      conds.slice(1).forEach((c, i) => {
        const pick = wf[(c.inputs['ref_images.ref_image_0'] as [string, number])[0]]
        expect(pick.class_type).toBe('ImageFromBatch')
        expect(pick.inputs).toEqual({ image: [decodes[i], 0], batch_index: plan[i].frames - 39, length: 1 })
        expect(c.inputs.prompt).toBe(conds[0].inputs.prompt)
      })
      expect(danglingLinks(wf)).toEqual([])
    })

    it('is ignored on Restyle and Swap head', () => {
      expect(h3EditPictures(base({ mode: 'edit', ...ff, editKind: 'style' })).some((x) => x.firstFrame)).toBe(false)
      expect(h3EditPictures(base({ mode: 'edit', ...ff, editKind: 'head' })).some((x) => x.firstFrame)).toBe(false)
    })
  })

  it('offers the FFP LoRA as an optional download', () => {
    expect(MINIMAX_H3_ASSETS.find((x) => x.name === H3_EDIT_FFP_LORA)?.optional).toBe(true)
  })

  describe('picture notes', () => {
    const notes = { editPictures: ['me.png', 'beach.png'], editPictureRoles: ['character', 'location'], editPictureNotes: ['a woman with short silver hair', '  a palm beach at sunset '] }

    it('puts each description into its sentence', () => {
      const prompt = nodeOf(edit(notes), 'MiniMaxH3ReferenceToVideo')!.inputs.prompt
      expect(prompt).toBe('vfx_edit: Change her blazer into a red leather jacket The new person is the one shown in <Picture 1>: a woman with short silver hair. The new surroundings are the ones shown in <Picture 2>: a palm beach at sunset.')
    })

    it('follows the picture through the role order', () => {
      const p = base({ mode: 'edit', editPictures: ['beach.png', 'me.png'], editPictureRoles: ['location', 'character'], editPictureNotes: ['beach', 'woman'] })
      expect(h3EditPictures(p).map((x) => x.note)).toEqual(['woman', 'beach'])
    })

    it('treats an emptied description as none', () => {
      const p = base({ mode: 'edit', prompt: 'x', editPictures: ['me.png'], editPictureRoles: ['character'], editPictureNotes: ['  '] })
      expect(h3EditPrompt(p)).toBe('vfx_edit: x The new person is the one shown in <Picture 1>.')
    })

    it('fills Swap head from the face description when the instruction is empty', () => {
      const p = base({ mode: 'edit', editKind: 'head', prompt: '  ', editPictures: ['face.png'], editPictureNotes: ['man, forties, short dark beard'] })
      expect(h3EditPrompt(p)).toBe(h3HeadSwapPrompt('man, forties, short dark beard'))
    })

    it('typed face wins', () => {
      const p = base({ mode: 'edit', editKind: 'head', prompt: 'woman, fifties', editPictures: ['face.png'], editPictureNotes: ['man'] })
      expect(h3EditPrompt(p)).toBe(h3HeadSwapPrompt('woman, fifties'))
    })

    it('leaves a note-less edit exactly as before', () => {
      expect(edit({ editDescribeWith: 'builtin' })).toEqual(edit())
    })
  
    it('with an outfit picture, the person keeps face, hair and build — not their clothes', () => {
      const prompt = h3EditPrompt(base({ mode: 'edit', prompt: 'x', editPictures: ['me.png', 'fit.png'], editPictureRoles: ['character', 'outfit'], editPictureNotes: ['a woman in a red top', 'a green bikini'] }))
      expect(prompt).toContain('The new person is the one shown in <Picture 1>: a woman in a red top, wearing the outfit from <Picture 2> instead of their own clothes.')
      // Without an outfit picture, nothing changes.
      expect(h3EditPrompt(base({ mode: 'edit', prompt: 'x', editPictures: ['me.png'], editPictureRoles: ['character'], editPictureNotes: ['a woman'] }))).toBe('vfx_edit: x The new person is the one shown in <Picture 1>: a woman.')
    })
})

  describe('loose', () => {
    const loose = (over: Partial<VideoGenerationParams> = {}) => edit({ editFollow: 'loose', ...over })

    it('hands the clip over as a half-size reference video, no anchor, no edit LoRA', () => {
      const wf = loose()
      const cond = nodeOf(wf, 'MiniMaxH3ReferenceToVideo')!
      const [vhsId, vhs] = Object.entries(wf).find(([, n]) => n.class_type === 'VHS_LoadVideo')!
      expect(cond.inputs['ref_videos.ref_video_0']).toEqual([vhsId, 0])
      expect([vhs.inputs.custom_width, vhs.inputs.custom_height]).toEqual([Number(cond.inputs.width) / 2, Number(cond.inputs.height) / 2])
      expect(nodeOf(wf, 'MiniMaxH3AddGuide')).toBeUndefined()
      expect(nodeOf(wf, 'BasicGuider')!.inputs.conditioning).toEqual([idFor(wf, 'MiniMaxH3ReferenceToVideo'), 0])
      expect(modelChain(wf).some((s) => s.includes('vfx_edit') || s.includes('style_transfer') || s.includes('head_swap'))).toBe(false)
      expect(nodeOf(wf, 'CreateVideo')!.inputs.audio).toEqual([vhsId, 2])
      expect(danglingLinks(wf)).toEqual([])
    })

    it('writes MiniMax full-reference prompt from the instruction and the picture roles', () => {
      const wf = loose({ editPictures: ['me.png'], editPictureRoles: ['character'] })
      const prompt = nodeOf(wf, 'MiniMaxH3ReferenceToVideo')!.inputs.prompt as string
      expect(prompt).toBe(h3LooseEditPrompt('Change her blazer into a red leather jacket', [{ file: 'me.png', role: 'character' }]))
      expect(prompt).toContain('<Subject 1> is the person in <Picture 1>.')
      const described = nodeOf(loose({ editPictures: ['me.png'], editPictureRoles: ['character'], editPictureNotes: ['a woman with short silver hair.'] }), 'MiniMaxH3ReferenceToVideo')!.inputs.prompt as string
      expect(described).toContain('<Subject 1> is the person in <Picture 1>: a woman with short silver hair.')
      expect(prompt).toContain('<Video 1> is the source video for the target video edit')
      expect(prompt).toContain('[video editing + reference generation] The target video is an edited version of <Video 1>. Change her blazer into a red leather jacket')
      expect(prompt).not.toContain('vfx_edit:')
    })

    it('tells H3 the person is replaced for the WHOLE clip, in every section', () => {
      // Measured 2026-10-03: "carried into the target video" held the new person
      // for ~2 s and then the reference video's original woman came back; the
      // spike's prompt that held all 8 s said "replaced … for the whole clip" in
      // the summary, the retention line and the description.
      const p = h3LooseEditPrompt('Replace the woman with the person from the picture.', [
        { file: 'me.png', role: 'character', note: 'a woman with short silver hair' },
        { file: 'beach.png', role: 'location', note: 'a palm beach at sunset' },
      ])
      const section = (name: string) => p.split(`${name}:`)[1]?.split(/\n[a-z_]+:/)[0] ?? ''
      expect(section('summary')).toContain('<Subject 1> replaces the original person of <Video 1> for the whole clip')
      expect(section('summary')).toContain('<Subject 2> replaces the background of <Video 1> for the whole clip')
      expect(section('retention_analysis')).toContain('<Subject 1> (appears throughout the target video): attribute_transfer - the complete appearance of the person in <Picture 1> (a woman with short silver hair) replaces the original person of <Video 1> for the whole clip.')
      expect(section('detailed_description')).toContain('In place of the original person, <Subject 1> from <Picture 1> (a woman with short silver hair) performs every movement and pose of the original person with the same timing')
      expect(section('detailed_description')).toContain('from the first frame to the last')
      expect(section('detailed_description')).toContain('The background is <Subject 2>, the place from <Picture 2> (a palm beach at sunset), in every frame.')
    })

    it('loose ignores exact-only kinds', () => {
      expect(h3EditKind(base({ mode: 'edit', editFollow: 'loose', editKind: 'head' }))).toBe('vfx')
      const wf = loose({ editKind: 'style', editPictures: ['me.png'], editPictureRoles: ['character'] })
      expect(nodeOf(wf, 'MiniMaxH3ReferenceToVideo')!.inputs.prompt).not.toContain('style_transfer:')
    })

    it('loose ignores the first frame', () => {
      const p = base({ mode: 'edit', editFollow: 'loose', editFirstFrame: 'first.png' })
      expect(h3EditPictures(p)).toEqual([])
      expect(modelChain(loose({ editFirstFrame: 'first.png' })).some((s) => s.includes('_ffp'))).toBe(false)
    })

    it('each part references its own span', () => {
      const wf = loose({ editSourceWidth: 608, editSourceHeight: 1056, editSourceFrames: 362, vramMode: 'medium' })
      const plan = h3EditPlan(base({ mode: 'edit', editFollow: 'loose', editSourceWidth: 608, editSourceHeight: 1056, editSourceFrames: 362, vramMode: 'medium' }))!
      expect(plan.length).toBeGreaterThan(1)
      const loads = Object.entries(wf).filter(([, n]) => n.class_type === 'VHS_LoadVideo')
      const conds = Object.values(wf).filter((n) => n.class_type === 'MiniMaxH3ReferenceToVideo')
      expect(loads.map(([, n]) => [n.inputs.skip_first_frames, n.inputs.frame_load_cap])).toEqual(plan.map((c) => [c.start, c.frames]))
      expect(conds.map((c) => c.inputs['ref_videos.ref_video_0'])).toEqual(loads.map(([id]) => [id, 0]))
      expect(nodeOf(wf, 'MiniMaxH3AddGuide')).toBeUndefined()
      expect(danglingLinks(wf)).toEqual([])
    })

    it('keeps the face swap', () => {
      const wf = loose({ editPictures: ['me.png'], editPictureRoles: ['character'], editFaceChecked: 'me.png' })
      expect(nodeOf(wf, 'RaccoonVideoFaceSwap')).toBeDefined()
    })

    it('leaves Exactly exactly as before', () => {
      expect(edit({ editFollow: 'exact' })).toEqual(edit())
    })
  
    it('with an outfit picture, the loose person keeps face, hair and build and wears the outfit', () => {
      const p = h3LooseEditPrompt('x', [
        { file: 'me.png', role: 'character', note: 'a woman in a red top' },
        { file: 'fit.png', role: 'outfit', note: 'a green bikini' },
      ])
      expect(p).toContain('attribute_transfer - the face, hair and build of the person in <Picture 1> (a woman in a red top) replaces the original person of <Video 1> for the whole clip.')
      expect(p).toContain('their face, hair and build stay the same from the first frame to the last, and they wear the outfit from <Picture 2>')
      expect(p).not.toContain('the complete appearance of the person')
    })
})
})

describe('Hybrid checkpoint (Plaguekind V11 recipe)', () => {
  const hy = (over: Partial<VideoGenerationParams> = {}) => build({ h3Checkpoint: 'hybrid', ...over })

  it('owns its schedule: res_multistep / simple / 13 steps, no Turbo, no shift', () => {
    const wf = hy({ turbo: 'fast' })
    expect(nodeOf(wf, 'UNETLoader')!.inputs.unet_name).toBe(H3_HYBRID.ckpt)
    expect(nodeOf(wf, 'KSamplerSelect')!.inputs.sampler_name).toBe('res_multistep')
    expect(nodeOf(wf, 'BasicScheduler')!.inputs.scheduler).toBe('simple')
    expect(nodeOf(wf, 'BasicScheduler')!.inputs.steps).toBe(13)
    expect(nodeOf(wf, 'MiniMaxH3SigmaShift')).toBeUndefined()
    expect(modelChain(wf).some((s) => s.includes('turbo'))).toBe(false)
  })
  it('renders reference mode on the same file — fl2va and ref2va merged', () => {
    expect(nodeOf(hy({ mode: 'ref2v', refImages: ['a.png'] }), 'UNETLoader')!.inputs.unet_name).toBe(H3_HYBRID.ckpt)
  })
  it('takes the cheaper step count for seed-hunt candidates', () => {
    expect(nodeOf(hy({ seedHunt: true }), 'BasicScheduler')!.inputs.steps).toBe(H3_HYBRID.huntSteps)
  })
  it('is one reader for all three picks', () => {
    expect(h3Profile({ h3Checkpoint: 'hybrid' })).toBe(H3_HYBRID)
    expect(h3Profile({ h3Checkpoint: 'eros' })).toBe(H3_EROS)
    expect(h3Profile({ h3Checkpoint: 'base' })).toBeNull()
    expect(h3Profile({})).toBeNull()
  })
  it('is offered as an optional download', () => {
    const a = MINIMAX_H3_ASSETS.find((x) => x.name === H3_HYBRID.ckpt)!
    expect(a).toBeDefined()
    expect(a.optional).toBe(true)
    expect(a.folder).toBe('diffusion_models')
  })
})

describe('SparseRef15 checkpoint (fl2va hybrid with a sparse ref2va effect)', () => {
  const sr = (over: Partial<VideoGenerationParams> = {}) => build({ h3Checkpoint: 'sparseref', ...over })

  it('loads its file with its own turbo LoRA at 1.0, euler/simple 8 steps, shift 12/3', () => {
    const wf = sr({ turbo: 'fast' })
    expect(nodeOf(wf, 'UNETLoader')!.inputs.unet_name).toBe(H3_SPARSEREF.ckpt)
    expect(nodeOf(wf, 'KSamplerSelect')!.inputs.sampler_name).toBe('euler')
    expect(nodeOf(wf, 'BasicScheduler')!.inputs.scheduler).toBe('simple')
    expect(nodeOf(wf, 'BasicScheduler')!.inputs.steps).toBe(8)
    expect(modelChain(wf)).toEqual(['UNETLoader', `lora:${H3_SPARSEREF.lora.name}@1`, 'MiniMaxH3SigmaShift'])
    expect(nodeOf(wf, 'MiniMaxH3SigmaShift')!.inputs).toMatchObject({ shift_video: 12, shift_audio: 3 })
  })

  it('stacks a user LoRA after its turbo LoRA and before the shift', () => {
    const wf = sr({ lora1: 'MysticXXX_MMH3-V4.safetensors', lora1Strength: 1 })
    expect(modelChain(wf)).toEqual([
      'UNETLoader', `lora:${H3_SPARSEREF.lora.name}@1`, 'lora:MysticXXX_MMH3-V4.safetensors@1', 'MiniMaxH3SigmaShift',
    ])
  })

  it('renders reference mode on the same file', () => {
    expect(nodeOf(sr({ mode: 'ref2v', refImages: ['a.png'] }), 'UNETLoader')!.inputs.unet_name).toBe(H3_SPARSEREF.ckpt)
  })

  it('takes the cheaper step count for seed-hunt candidates', () => {
    expect(nodeOf(sr({ seedHunt: true }), 'BasicScheduler')!.inputs.steps).toBe(H3_SPARSEREF.huntSteps)
  })

  it('is read through h3Profile and serves reference mode from its own file only', () => {
    expect(h3Profile({ h3Checkpoint: 'sparseref' })).toBe(H3_SPARSEREF)
    expect(h3RefCheckpointReady('sparseref', { ref2v: false, eros: false, hybrid: false, sparseref: true })).toBe(true)
    expect(h3RefCheckpointReady('sparseref', { ref2v: true, eros: true, hybrid: true })).toBe(false)
  })

  it('is catalogued: the checkpoint to import by hand (Civitai wants a login), its turbo LoRA to download', () => {
    const ckpt = MINIMAX_H3_ASSETS.find((a) => a.name === H3_SPARSEREF.ckpt)
    const lora = MINIMAX_H3_ASSETS.find((a) => a.name === H3_SPARSEREF.lora.name)
    expect(ckpt).toMatchObject({ folder: 'diffusion_models', optional: true })
    expect(ckpt!.url).toBeUndefined()
    expect(lora).toMatchObject({ folder: 'loras', optional: true })
    expect(lora!.url).toMatch(/^https:\/\/huggingface\.co\/lightx2v\//)
  })
})

describe('per-render pixel budget', () => {
  const kf = { start: { image: 'p0.png', width: 736, height: 1344 } }
  it('renders a 736x1344 keyframe at the full canvas when budgetMp is 1', () => {
    const cond = nodeOf(build({ mode: 'ref2v', refImages: ['p0.png'], keyframes: kf, budgetMp: 1 }), 'MiniMaxH3ReferenceToVideo')!
    expect([cond.inputs.width, cond.inputs.height]).toEqual([736, 1344])
  })
  it('keeps the tier budget without it', () => {
    const cond = nodeOf(build({ mode: 'ref2v', refImages: ['p0.png'], keyframes: kf, vramMode: 'high' }), 'MiniMaxH3ReferenceToVideo')!
    expect(Number(cond.inputs.width) * Number(cond.inputs.height)).toBeLessThan(736 * 1344)
  })
})

describe('H3 keyframes', () => {
  const kf = (image: string, width = 832, height = 1248) => ({ image, width, height })
  const ref = (over: Partial<VideoGenerationParams> = {}) =>
    build({ mode: 'ref2v', refImages: ['me.png'], refImageRoles: ['character'], durationSeconds: 15, ...over })
  const guides = (wf: Record<string, ComfyUIPromptNode>) =>
    Object.values(wf).filter((n) => n.class_type === 'MiniMaxH3AddGuide')
  const frames = (wf: Record<string, ComfyUIPromptNode>) =>
    guides(wf).map((n) => Number(n.inputs.frame_idx)).sort((a, b) => a - b)

  it('places start, middle and end on the first, middle and last frame', () => {
    expect(h3KeyframeFrames(362, false)).toEqual({ start: 0, middle: 181, end: 361 })
  })

  it('has no start in a continuation and centres the middle on the new part', () => {
    expect(h3KeyframeFrames(243, true)).toEqual({ middle: H3_CONTEXT_FRAMES + 102, end: 242 })
  })

  it('leaves the graph byte-identical with no keyframes', () => {
    expect(ref({ keyframes: {} })).toEqual(ref())
    expect(ref({ keyframes: { middle: { image: '' } } })).toEqual(ref())
  })

  it('adds one LoadImage + AddGuide per filled slot, chained in time order around the guider', () => {
    const wf = ref({ keyframes: { end: kf('c.png'), start: kf('a.png'), middle: kf('b.png') } })
    expect(frames(wf)).toEqual([0, 181, 361])
    let link = nodeOf(wf, 'BasicGuider')!.inputs.conditioning as [string, number]
    const walked: unknown[] = []
    while (wf[link[0]].class_type === 'MiniMaxH3AddGuide') {
      const g = wf[link[0]].inputs
      walked.push([g.frame_idx, wf[(g.image as [string, number])[0]].inputs.image])
      link = g.positive as [string, number]
    }
    expect(walked).toEqual([[361, 'c.png'], [181, 'b.png'], [0, 'a.png']])
    expect(link).toEqual([idFor(wf, 'MiniMaxH3ReferenceToVideo'), 0])
    const g = guides(wf)[0].inputs
    expect(g.latent).toEqual([idFor(wf, 'MiniMaxH3ReferenceToVideo'), 1])
    expect(g.vae).toEqual(nodeOf(wf, 'VAEDecode')!.inputs.vae)
    expect(danglingLinks(wf)).toEqual([])
  })

  it('honours only the filled slots', () => {
    expect(frames(ref({ keyframes: { middle: kf('b.png') } }))).toEqual([181])
  })

  it('ignores keyframes outside reference mode', () => {
    const keyframes = { start: kf('a.png'), end: kf('c.png') }
    expect(guides(build({ mode: 't2v', keyframes }))).toHaveLength(0)
    expect(guides(build({ mode: 'i2v', inputImage: 'x.png', keyframes }))).toHaveLength(0)
  })

  it('skips the start slot in a continuation and lands middle and end on the new part', () => {
    const wf = ref({
      durationSeconds: 10, continueFrom: 'video/MinimaxH3/2026-10-02/a.mp4',
      keyframes: { start: kf('a.png'), middle: kf('b.png'), end: kf('c.png') },
    })
    expect(frames(wf)).toEqual([141, 242])
    expect(danglingLinks(wf)).toEqual([])
  })

  it('takes the render aspect from the first keyframe with dimensions', () => {
    const c = nodeOf(ref({ orientation: 'landscape', keyframes: { middle: kf('b.png', 832, 1248) } }), 'MiniMaxH3ReferenceToVideo')!.inputs
    expect(Number(c.width)).toBeLessThan(Number(c.height))
  })

  it('keeps the guides on seed-hunt candidates, so the picked seed lands the same way', () => {
    expect(guides(ref({ seedHunt: true, keyframes: { end: kf('c.png') } }))).toHaveLength(1)
  })

  it('h3Keyframes lists filled slots in time order with their frames', () => {
    expect(h3Keyframes({ mode: 'ref2v', keyframes: { end: kf('c.png'), start: kf('a.png') } }, 362))
      .toEqual([{ slot: 'start', image: 'a.png', frame: 0 }, { slot: 'end', image: 'c.png', frame: 361 }])
    expect(h3Keyframes({ mode: 'i2v', keyframes: { end: kf('c.png') } }, 362)).toEqual([])
  })
})

describe('h3RefCheckpointReady', () => {
  const ready = { ref2v: false, eros: true, hybrid: true }
  it('lets reference mode run on Eros or the Hybrid without the stock ref2va file', () => {
    expect(h3RefCheckpointReady('eros', ready)).toBe(true)
    expect(h3RefCheckpointReady('hybrid', ready)).toBe(true)
  })
  it('needs the stock ref2va file on the Standard pick', () => {
    expect(h3RefCheckpointReady('base', ready)).toBe(false)
    expect(h3RefCheckpointReady(undefined, ready)).toBe(false)
    expect(h3RefCheckpointReady('base', { ...ready, ref2v: true })).toBe(true)
  })
  it('follows the picked file, not any installed one', () => {
    expect(h3RefCheckpointReady('eros', { ref2v: true, eros: false, hybrid: true })).toBe(false)
  })
})

describe('h3KeyframeClipSeconds', () => {
  it('is plain render time on a fresh clip', () => {
    expect(h3KeyframeClipSeconds(181, false)).toBeCloseTo(181 / 24)
  })
  it('is DELIVERED time in a continuation — the frozen head is trimmed off', () => {
    // 10 s continuation: middle frame 141, end 242 on the render timeline.
    expect(h3KeyframeClipSeconds(141, true)).toBeCloseTo(4.25)
    expect(h3KeyframeClipSeconds(242, true)).toBeCloseTo(203 / 24)
  })
})
