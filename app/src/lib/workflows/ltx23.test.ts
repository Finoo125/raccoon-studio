import { describe, it, expect } from 'vitest'
import { ltx23Workflow, ltxDimsForImage } from './ltx23'
import type { VideoGenerationParams } from '@/types/video-workflow'
import type { ComfyUIPrompt, ComfyUIPromptNode } from '@/types/comfyui'

type Wf = Record<string, ComfyUIPromptNode>

/** The single node of `cls` in the built prompt — fails the test if not exactly one. */
function byClass(wf: ComfyUIPrompt, cls: string): ComfyUIPromptNode {
  const hits = Object.values(wf as Wf).filter((n) => n.class_type === cls)
  expect(hits, cls).toHaveLength(1)
  return hits[0]
}

const base: VideoGenerationParams = {
  prompt: 'a raccoon dancing in the rain',
  mode: 't2v',
  orientation: 'landscape',
  durationSeconds: 15,
  fps: 30,
  seed: 42,
}

describe('ltx23Workflow.buildPrompt', () => {
  it('feeds prompt/mode into the RaccoonVideoPrompt node', () => {
    const n = byClass(ltx23Workflow.buildPrompt(base), 'RaccoonVideoPrompt')
    expect(n.inputs.confirmed_prompt).toBe(base.prompt)
    expect(n.inputs.video_mode).toBe('t2v')
    expect(n.inputs.image_filename).toBe('')
  })

  it('maps t2v orientations to exact /32 dimensions', () => {
    const dims = (o: string) => {
      const n = byClass(ltx23Workflow.buildPrompt({ ...base, orientation: o }), 'RaccoonVideoPrompt')
      return [n.inputs.rm_w, n.inputs.rm_h]
    }
    expect(dims('portrait')).toEqual([1088, 1920])
    expect(dims('landscape')).toEqual([1920, 1088])
    expect(dims('square')).toEqual([1024, 1024])
  })

  it('sets i2v image + aspect-preserving snapped dims from the source image', () => {
    const n = byClass(
      ltx23Workflow.buildPrompt({
        ...base,
        mode: 'i2v',
        inputImage: 'sub/seed.png',
        inputImageWidth: 3000,
        inputImageHeight: 2000,
      }),
      'RaccoonVideoPrompt',
    )
    expect(n.inputs.image_filename).toBe('sub/seed.png')
    expect(n.inputs.rm_w).toBe(ltxDimsForImage(3000, 2000).w)
    expect(n.inputs.rm_h).toBe(ltxDimsForImage(3000, 2000).h)
  })

  it('keeps the exported default dims for i2v without recorded image dims', () => {
    const n = byClass(
      ltx23Workflow.buildPrompt({ ...base, mode: 'i2v', inputImage: 'seed.png' }),
      'RaccoonVideoPrompt',
    )
    expect(n.inputs.rm_w).toBe(1088)
    expect(n.inputs.rm_h).toBe(1920)
  })

  it('drops to the middle 900p budget on the medium tier', () => {
    const dims = (o: string) => {
      const n = byClass(
        ltx23Workflow.buildPrompt({ ...base, orientation: o, vramMode: 'medium' }),
        'RaccoonVideoPrompt',
      )
      return [n.inputs.rm_w, n.inputs.rm_h]
    }
    expect(dims('portrait')).toEqual([896, 1600])
    expect(dims('landscape')).toEqual([1600, 896])
    expect(dims('square')).toEqual([1024, 1024]) // already ~1MP
  })

  // Anything not in the union (a rerun of a job stored before this setting, or a
  // hand-edited param) must keep rendering full-size rather than crash.
  it('falls back to full size for a missing or unknown tier', () => {
    for (const vramMode of [undefined, 'ultra' as unknown as undefined]) {
      const n = byClass(ltx23Workflow.buildPrompt({ ...base, vramMode }), 'RaccoonVideoPrompt')
      expect([n.inputs.rm_w, n.inputs.rm_h]).toEqual([1920, 1088])
    }
  })

  it('halves the pixel budget in low VRAM mode', () => {
    const dims = (o: string) => {
      const n = byClass(
        ltx23Workflow.buildPrompt({ ...base, orientation: o, vramMode: 'low' }),
        'RaccoonVideoPrompt',
      )
      return [n.inputs.rm_w, n.inputs.rm_h]
    }
    expect(dims('portrait')).toEqual([704, 1280])
    expect(dims('landscape')).toEqual([1280, 704])
    expect(dims('square')).toEqual([1024, 1024]) // already ~1MP

    const n = byClass(
      ltx23Workflow.buildPrompt({
        ...base,
        mode: 'i2v',
        inputImage: 'seed.png',
        inputImageWidth: 3000,
        inputImageHeight: 2000,
        vramMode: 'low',
      }),
      'RaccoonVideoPrompt',
    )
    expect(n.inputs.rm_w).toBe(ltxDimsForImage(3000, 2000, 1).w)
    expect(n.inputs.rm_h).toBe(ltxDimsForImage(3000, 2000, 1).h)
  })

  // The graph halves before building the latent and EmptyLTXVLatentVideo floors
  // `// 32`, so anything not divisible by 64 silently renders smaller than asked.
  it('emits /64 dimensions for every orientation, mode and VRAM profile', () => {
    const budget = { high: 2, medium: 1.4, low: 1 }
    for (const vramMode of ['high', 'medium', 'low'] as const) {
      for (const orientation of ['portrait', 'landscape', 'square']) {
        const n = byClass(
          ltx23Workflow.buildPrompt({ ...base, orientation, vramMode }),
          'RaccoonVideoPrompt',
        )
        expect((n.inputs.rm_w as number) % 64).toBe(0)
        expect((n.inputs.rm_h as number) % 64).toBe(0)
      }
      for (const [iw, ih] of [
        [3000, 2000],
        [1024, 1024],
        [900, 1600],
        [1911, 733],
      ]) {
        const d = ltxDimsForImage(iw, ih, budget[vramMode])
        expect(d.w % 64).toBe(0)
        expect(d.h % 64).toBe(0)
      }
    }
  })

  it('evicts models after text encode: a clean-VRAM node feeds the first-pass sampler', () => {
    const wf = ltx23Workflow.buildPrompt(base) as unknown as Wf
    const samplers = Object.values(wf).filter((n) => n.class_type === 'SamplerCustom')
    expect(samplers.length).toBeGreaterThan(0)
    const cleaned = samplers.filter((s) => {
      const pos = s.inputs.positive as [string, number]
      return wf[pos[0]]?.class_type === 'easy cleanGpuUsed'
    })
    expect(cleaned).toHaveLength(1)
  })

  it('hard-wires the DMD LoRA as row 0 and defaults user slots to none', () => {
    const stack = JSON.parse(
      byClass(ltx23Workflow.buildPrompt(base), 'RaccoonLoraStack').inputs.stack_data as string,
    )
    expect(stack[0]).toEqual({ on: true, lora: 'LTX2.3_DMD_reshaped_r256.safetensors', str: 1, vs: 1, as: 0.8 })
    expect(stack).toHaveLength(1)
  })

  // Opt-in at the builder level even though the form defaults it on: any caller
  // that does not know to check the file is installed must not inject it.
  it('omits the VBVR motion LoRA unless asked for', () => {
    const stack = JSON.parse(
      byClass(ltx23Workflow.buildPrompt(base), 'RaccoonLoraStack').inputs.stack_data as string,
    )
    expect(stack.some((r: { lora: string }) => r.lora.includes('VBVR'))).toBe(false)
  })

  it('puts the VBVR motion LoRA directly after DMD, before the user slots', () => {
    const stack = JSON.parse(
      byClass(
        ltx23Workflow.buildPrompt({
          ...base,
          mode: 'i2v',
          inputImage: 'seed.png',
          motionLora: true,
          lora1: 'style.safetensors',
          faceId: true,
        }),
        'RaccoonLoraStack',
      ).inputs.stack_data as string,
    )
    // The measured configuration: DMD, VBVR at full strength on both branches,
    // then user style, with FaceID still last.
    expect(stack[1]).toEqual({ on: true, lora: 'VBVR-I2V-390K-R32.safetensors', str: 1, vs: 1, as: 1 })
    expect(stack.map((r: { lora: string }) => r.lora)).toEqual([
      'LTX2.3_DMD_reshaped_r256.safetensors',
      'VBVR-I2V-390K-R32.safetensors',
      'style.safetensors',
      'Best_FaceID_v1.0_LoRA.safetensors',
    ])
  })

  it('appends user LoRA rows with their strength', () => {
    const stack = JSON.parse(
      byClass(
        ltx23Workflow.buildPrompt({
          ...base,
          lora1: 'styleA.safetensors',
          lora1Strength: 0.7,
          lora3: 'styleC.safetensors',
        }),
        'RaccoonLoraStack',
      ).inputs.stack_data as string,
    )
    expect(stack).toHaveLength(3)
    expect(stack[1]).toEqual({ on: true, lora: 'styleA.safetensors', str: 0.7, vs: 1, as: 1 })
    expect(stack[2]).toEqual({ on: true, lora: 'styleC.safetensors', str: 1, vs: 1, as: 1 })
  })

  it('writes pov/gender/music and preset passthroughs to the node', () => {
    const n = byClass(
      ltx23Workflow.buildPrompt({
        ...base,
        pov: true,
        povGender: 'male',
        music: 'None',
        dialogueTier: 'talkative',
        energy: 8,
      }),
      'RaccoonVideoPrompt',
    )
    expect(n.inputs.pov).toBe(true)
    expect(n.inputs.pov_gender).toBe('male')
    expect(n.inputs.music).toBe('None')
    expect(n.inputs.dialogue_tier).toBe('talkative')
    expect(n.inputs.intensity).toBe(8)
  })

  it('writes duration and fps to their source nodes', () => {
    const wf = ltx23Workflow.buildPrompt({ ...base, durationSeconds: 8, fps: 25 }) as unknown as Wf
    const prompt = byClass(wf as unknown as ComfyUIPrompt, 'RaccoonVideoPrompt')
    const durRef = prompt.inputs.duration_s as [string, number]
    const fpsRef = prompt.inputs.fps as [string, number]
    expect(wf[durRef[0]].inputs.value).toBe(8)
    expect(wf[fpsRef[0]].inputs.value).toBe(25)
  })

  it('applies a concrete seed and resolves negative seeds', () => {
    const seedNode = byClass(ltx23Workflow.buildPrompt({ ...base, seed: 12345 }), 'Seed (rgthree)')
    expect(seedNode.inputs.seed).toBe(12345)
    const rnd = byClass(ltx23Workflow.buildPrompt({ ...base, seed: -1 }), 'Seed (rgthree)').inputs
      .seed as number
    expect(Number.isInteger(rnd)).toBe(true)
    expect(rnd).toBeGreaterThanOrEqual(0)
  })

  it('sets the dated output prefix on the saving VideoCombine', () => {
    const wf = ltx23Workflow.buildPrompt(base) as unknown as Wf
    const savers = Object.values(wf).filter(
      (n) => n.class_type === 'VHS_VideoCombine' && n.inputs.save_output === true,
    )
    expect(savers).toHaveLength(1)
    expect(savers[0].inputs.filename_prefix).toBe(
      'video/LTX23/%year%-%month%-%day%/%hour%%minute%%second%-LTX23_',
    )
  })

  it('keeps RIFE interpolation in the graph by default', () => {
    const wf = ltx23Workflow.buildPrompt(base) as unknown as Wf
    expect(Object.values(wf).some((n) => n.class_type === 'RIFEInterpolation')).toBe(true)
  })

  it('splices RIFE out (images + frame_rate rewired) when rife is false', () => {
    const withRife = ltx23Workflow.buildPrompt(base) as unknown as Wf
    const rifeNode = byClass(withRife as unknown as ComfyUIPrompt, 'RIFEInterpolation')

    const wf = ltx23Workflow.buildPrompt({ ...base, rife: false }) as unknown as Wf
    expect(Object.values(wf).some((n) => n.class_type === 'RIFEInterpolation')).toBe(false)
    const saver = Object.values(wf).find(
      (n) => n.class_type === 'VHS_VideoCombine' && n.inputs.save_output === true,
    )!
    expect(saver.inputs.images).toEqual(rifeNode.inputs.images)
    expect(saver.inputs.frame_rate).toEqual(rifeNode.inputs.source_fps)
  })

  // t2v has no source image — RaccoonVideoPrompt hands the graph a black frame.
  // Conditioning on it opens every clip on black and references black throughout.
  it('drops the i2v conditioning path in t2v', () => {
    const wf = ltx23Workflow.buildPrompt(base) as unknown as Wf
    const present = (cls: string) => Object.values(wf).filter((n) => n.class_type === cls)
    expect(present('LTXVImgToVideoInplaceKJ')).toHaveLength(0)
    expect(present('RaccoonLTXReferenceConditioning')).toHaveLength(0)
    // The resize chain stays: it is how rm_w/rm_h reach EmptyLTXVLatentVideo.
    expect(present('GetImageSize')).toHaveLength(1)
  })

  it('keeps both conditioning pairs for i2v', () => {
    const wf = ltx23Workflow.buildPrompt({
      ...base,
      mode: 'i2v',
      inputImage: 'seed.png',
    }) as unknown as Wf
    expect(Object.values(wf).filter((n) => n.class_type === 'LTXVImgToVideoInplaceKJ')).toHaveLength(2)
    expect(
      Object.values(wf).filter((n) => n.class_type === 'RaccoonLTXReferenceConditioning'),
    ).toHaveLength(2)
  })

  // The splices (t2v conditioning, RIFE) rewire consumers onto the removed node's
  // own input. Miss one and ComfyUI rejects the whole prompt at validation.
  it('leaves no dangling links in any mode', () => {
    const dangling = (wf: Wf) =>
      Object.entries(wf).flatMap(([id, node]) =>
        Object.entries(node.inputs)
          .filter(([, v]) => Array.isArray(v) && typeof v[0] === 'string' && !(v[0] in wf))
          .map(([name, v]) => `${id}.${name} -> ${(v as [string, number])[0]}`),
      )
    expect(dangling(ltx23Workflow.buildPrompt(base) as unknown as Wf)).toEqual([])
    expect(
      dangling(
        ltx23Workflow.buildPrompt({ ...base, mode: 'i2v', inputImage: 'seed.png' }) as unknown as Wf,
      ),
    ).toEqual([])
    expect(dangling(ltx23Workflow.buildPrompt({ ...base, rife: false }) as unknown as Wf)).toEqual([])
  })

  // img_compression is the CRF of a one-frame H.264 re-encode. At 0 the reference
  // frame is lossless, does not look like video, and the model clings to it —
  // that is the stiff-i2v failure.
  //
  // 25 (not the 33-35 both reference builders ship) is measured: across 3 seeds,
  // 25 beat 35 on every axis — more motion, less jerk, sharper, and sharper than
  // the old lossless baseline by clip end. We degrade the reference in more
  // places than they do (i2v node + reference conditioning, then again at 30 on
  // the upscale pass), so it compounds. Don't "fix" this back to 35.
  it('degrades the conditioning frame and pins frame 0 at full strength', () => {
    const wf = ltx23Workflow.buildPrompt({
      ...base,
      mode: 'i2v',
      inputImage: 'seed.png',
    }) as unknown as Wf
    const pre = Object.values(wf).filter((n) => n.class_type === 'LTXVPreprocess')
    expect(pre.map((n) => n.inputs.img_compression).sort()).toEqual([25, 30])

    // The first pass must compress AFTER the 0.5 downscale, at conditioning
    // resolution — compressing first and shrinking after resamples it away.
    const first = pre.find((n) => n.inputs.img_compression === 25)!
    const src = wf[(first.inputs.image as [string, number])[0]]
    expect(src.class_type).toBe('ResizeImageMaskNode')
    expect(src.inputs['resize_type.multiplier']).toBe(0.5)

    const strengthRef = Object.values(wf)
      .filter((n) => n.class_type === 'LTXVImgToVideoInplaceKJ')
      .map((n) => n.inputs['num_images.strength_1'])
      .find(Array.isArray) as [string, number]
    expect(wf[strengthRef[0]].inputs.Xf).toBe(1)
  })

  // chunks=1 short-circuits to a passthrough inside the node, so it is free off
  // the low tier — which is what keeps an experimental node out of the way.
  it('chunks the feedforward only on the low-VRAM tier', () => {
    const chunks = (vramMode?: 'high' | 'medium' | 'low') =>
      byClass(ltx23Workflow.buildPrompt({ ...base, vramMode }), 'LTXVChunkFeedForward').inputs.chunks
    expect(chunks('low')).toBe(3)
    expect(chunks('medium')).toBe(1)
    expect(chunks('high')).toBe(1)
    expect(chunks(undefined)).toBe(1)
  })

  // FaceID swaps in for reference conditioning rather than stacking with it —
  // both inject reference tokens, and both upstream workflows drop the
  // conditioning node wherever the reinforcer appears.
  it('swaps reference conditioning for the face reinforcer, keeping the wiring', () => {
    const off = ltx23Workflow.buildPrompt({
      ...base,
      mode: 'i2v',
      inputImage: 'seed.png',
    }) as unknown as Wf
    const on = ltx23Workflow.buildPrompt({
      ...base,
      mode: 'i2v',
      inputImage: 'seed.png',
      faceId: true,
    }) as unknown as Wf

    const refs = Object.values(on).filter((n) => n.class_type === 'RaccoonLTXReferenceConditioning')
    const faces = Object.values(on).filter((n) => n.class_type === 'RaccoonLTXFaceIdentity')
    expect(refs).toHaveLength(0)
    expect(faces).toHaveLength(2) // one per sampling pass

    // Same slot, same upstream links — only the class and inputs change.
    for (const [id, node] of Object.entries(on)) {
      if (node.class_type !== 'RaccoonLTXFaceIdentity') continue
      const was = off[id]
      expect(was.class_type).toBe('RaccoonLTXReferenceConditioning')
      expect(node.inputs.model).toEqual(was.inputs.model)
      expect(node.inputs.vae).toEqual(was.inputs.vae)
      expect(node.inputs.reference_image).toEqual(was.inputs.image)
      expect(node.inputs.target_latent).toEqual(was.inputs.target_latent)
      // What the Best-FaceID LoRA was trained against — not free knobs.
      expect(node.inputs.source_id).toBe(2)
      expect(node.inputs.phase_scale).toBe(1)
      expect(node.inputs.placement_mode).toBe('i2v_safe')
    }
  })

  it('adds the FaceID LoRA last, with audio strength 0', () => {
    const stack = JSON.parse(
      byClass(
        ltx23Workflow.buildPrompt({
          ...base,
          mode: 'i2v',
          inputImage: 'seed.png',
          faceId: true,
          lora1: 'style.safetensors',
        }),
        'RaccoonLoraStack',
      ).inputs.stack_data as string,
    )
    expect(stack.at(-1)).toEqual({
      on: true,
      lora: 'Best_FaceID_v1.0_LoRA.safetensors',
      str: 1,
      vs: 1,
      as: 0, // video-identity LoRA — must not touch the audio branch
    })
    expect(stack).toHaveLength(3) // DMD, the user slot, then FaceID
  })

  it('honours identity strength and the whole-subject (no face crop) mode', () => {
    const wf = ltx23Workflow.buildPrompt({
      ...base,
      mode: 'i2v',
      inputImage: 'seed.png',
      faceId: true,
      faceIdStrength: 0.6,
      faceIdWholeSubject: true,
    }) as unknown as Wf
    const face = Object.values(wf).find((n) => n.class_type === 'RaccoonLTXFaceIdentity')!
    expect(face.inputs.identity_strength).toBe(0.6)
    expect(face.inputs.auto_face_crop).toBe(false)
  })

  // t2v has no source face, and its conditioning path is spliced out entirely —
  // asking for FaceID there must not resurrect it or add the LoRA.
  it('ignores faceId in t2v', () => {
    const wf = ltx23Workflow.buildPrompt({ ...base, faceId: true }) as unknown as Wf
    expect(Object.values(wf).some((n) => n.class_type === 'RaccoonLTXFaceIdentity')).toBe(false)
    const stack = JSON.parse(
      byClass(wf as unknown as ComfyUIPrompt, 'RaccoonLoraStack').inputs.stack_data as string,
    )
    expect(stack).toHaveLength(1) // DMD only
  })

  it('leaves no dangling links with FaceID on', () => {
    const wf = ltx23Workflow.buildPrompt({
      ...base,
      mode: 'i2v',
      inputImage: 'seed.png',
      faceId: true,
    }) as unknown as Wf
    const dangling = Object.entries(wf).flatMap(([id, node]) =>
      Object.entries(node.inputs)
        .filter(([, v]) => Array.isArray(v) && typeof v[0] === 'string' && !(v[0] in wf))
        .map(([name]) => `${id}.${name}`),
    )
    expect(dangling).toEqual([])
  })

  it('tolerates legacy stored params (rerun of pre-v2 jobs)', () => {
    const legacy = { ...base, shotType: 'TRACKING' } as VideoGenerationParams & { shotType: string }
    expect(() => ltx23Workflow.buildPrompt(legacy)).not.toThrow()
  })
})

describe('ltxDimsForImage', () => {
  it('preserves aspect at ~2MP snapped to /32', () => {
    const { w, h } = ltxDimsForImage(3000, 2000)
    expect(w % 32).toBe(0)
    expect(h % 32).toBe(0)
    expect(Math.abs(w / h - 1.5)).toBeLessThan(0.1)
    expect(Math.abs((w * h) / (1024 * 1024) - 2)).toBeLessThan(0.25)
  })

  it('honours a reduced pixel budget', () => {
    const { w, h } = ltxDimsForImage(3000, 2000, 1)
    expect(w % 32).toBe(0)
    expect(h % 32).toBe(0)
    expect(Math.abs((w * h) / (1024 * 1024) - 1)).toBeLessThan(0.2)
  })

  it('never returns dimensions below the 32px grid floor', () => {
    const { w, h } = ltxDimsForImage(10000, 10)
    expect(w).toBeGreaterThanOrEqual(32)
    expect(h).toBeGreaterThanOrEqual(32)
  })
})
