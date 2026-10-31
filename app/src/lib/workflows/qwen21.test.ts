import { describe, it, expect } from 'vitest'
import {
  qwen21TurboWorkflow, qwen21BaseWorkflow, viggleSigmas, PRUNA_8STEP_SIGMAS, formatSigmas,
  QWEN21_BASE_UNET, QWEN21_TURBO_UNET, QWEN21_PE_T2I,
  qwen21EditBaseCandidate, QWEN21_BFS_LORAS,
  toggleEditChip, qwen21EditProblem, editUploadName, QWEN21_BFS_PROMPT, QWEN21_SHEET_PROMPT,
  qwen21EditHref, qwen21EditLinkPatch, headSwapChipDisabled, bfsVariantFor, jobBatchSize,
  QWEN21_EXPERIMENTAL, editPictureLimit, pickEditTask, qwen21BfsUrl,
} from './qwen21'
import { workflows } from './index'
import { simpleImageValues } from './simple-values'
import type { GenerationParams } from '@/types/workflow'

const base: GenerationParams = {
  prompt: 'photograph of a muscular female bodybuilder flexing in a gym',
  width: 832,
  height: 1216,
  seed: 42,
  upscale: false,
  detailer: false,
}

describe('qwen21 presets', () => {
  it('base loads the int8 model and samples with KSampler at 40 steps (the Qwen pipeline count), euler/simple, cfg 1', () => {
    const wf = qwen21BaseWorkflow.buildPrompt(base)
    expect(wf['q:unet'].inputs.unet_name).toBe(QWEN21_BASE_UNET)
    expect(wf['q:sampler'].class_type).toBe('KSampler')
    expect(wf['q:sampler'].inputs).toMatchObject({
      steps: 40, cfg: 1, sampler_name: 'euler', scheduler: 'simple', seed: 42, denoise: 1,
    })
  })

  it('turbo loads its model and samples its distilled schedule through SamplerCustom', () => {
    const wf = qwen21TurboWorkflow.buildPrompt(base)
    expect(wf['q:unet'].inputs.unet_name).toBe(QWEN21_TURBO_UNET)
    expect(wf['q:sampler'].class_type).toBe('SamplerCustom')
    expect(wf['q:sampler'].inputs).toMatchObject({
      cfg: 1, noise_seed: 42, add_noise: true,
      sampler: ['q:select', 0], sigmas: ['q:sigmas', 0],
      latent_image: ['q:latent', 0], positive: ['q:enc', 0], negative: ['q:enc', 1],
      model: ['q:loras', 0],
    })
    expect(wf['q:select'].inputs.sampler_name).toBe('euler')
    expect(wf['q:sigmas'].class_type).toBe('ManualSigmas')
    expect(wf['q:sigmas'].inputs.sigmas).toBe(formatSigmas(viggleSigmas(832, 1216)))
    // Same node id, so the decode and every helper keep reading it.
    expect(wf['q:decode'].inputs.samples).toEqual(['q:sampler', 0])
  })

  // A stock KSampler schedule is the measured ghosting leg of the Turbo pick, so
  // Expert Mode may move the sampler and CFG but never the distilled schedule.
  it('turbo under Expert Mode keeps its distilled schedule; only sampler and CFG land', () => {
    const wf = workflows.find((w) => w.id === 'qwen21-turbo')!.buildPrompt({
      ...base, expertMode: true, steps: 12, cfg: 1.5, sampler: 'res_multistep', scheduler: 'beta',
    })
    expect(wf['q:sampler'].class_type).toBe('SamplerCustom')
    expect(wf['q:sampler'].inputs.cfg).toBe(1.5)
    expect(wf['q:select'].inputs.sampler_name).toBe('res_multistep')
    expect(wf['q:sigmas'].inputs.sigmas).toBe(formatSigmas(viggleSigmas(832, 1216)))
  })

  it('the Turbo declares its fixed schedule so the Expert panel can say so; the base does not', () => {
    expect(qwen21TurboWorkflow.distilledSchedule).toBe(true)
    expect(qwen21BaseWorkflow.distilledSchedule).toBeUndefined()
  })

  it('shares one text encoder (type qwen_image) and VAE, and never adds a shift node', () => {
    for (const p of [qwen21TurboWorkflow, qwen21BaseWorkflow]) {
      const wf = p.buildPrompt(base)
      expect(wf['q:clip'].inputs).toMatchObject({ clip_name: 'qwen3vl_8b_int8_convrot.safetensors', type: 'qwen_image' })
      expect(wf['q:vae'].inputs.vae_name).toBe('qwen_image_2.1_vae_bf16.safetensors')
      expect(Object.values(wf).some((n) => n.class_type.startsWith('ModelSampling'))).toBe(false)
    }
  })

  it('encodes prompt and negative in one node, wired positive 0 / negative 1', () => {
    const wf = qwen21BaseWorkflow.buildPrompt({ ...base, negativePrompt: 'blurry' })
    expect(wf['q:enc'].class_type).toBe('TextEncodeQwenImage21')
    expect(wf['q:enc'].inputs).toMatchObject({ prompt: base.prompt, negative_prompt: 'blurry', clip: ['q:loras', 1] })
    expect(wf['q:sampler'].inputs.positive).toEqual(['q:enc', 0])
    expect(wf['q:sampler'].inputs.negative).toEqual(['q:enc', 1])
  })

  it('shows no negative-prompt box on either preset (cfg 1 runs no uncond pass)', () => {
    expect(qwen21TurboWorkflow.supportsNegativePrompt).toBe(false)
    expect(qwen21BaseWorkflow.supportsNegativePrompt).toBe(false)
  })
})

describe('qwen21 turbo schedule', () => {
  it('follows Viggle: square 1 MP lands on mu 0.5 + 0.4·3840/7936', () => {
    const s = viggleSigmas(1024, 1024)
    expect(s).toHaveLength(7)
    expect(s[0]).toBeCloseTo(1, 6)
    expect(s[6]).toBe(0)
    const e = Math.exp(0.5 + (0.4 * 3840) / 7936)
    expect(s[4]).toBeCloseTo(e / (e + 1), 6) // t = 0.5
  })

  it('shifts harder on a bigger canvas — the resolution dependence core cannot express', () => {
    expect(viggleSigmas(1344, 1344)[5]).toBeGreaterThan(viggleSigmas(1024, 1024)[5])
    expect(viggleSigmas(832, 1216)[5]).not.toBeCloseTo(viggleSigmas(1216, 1216)[5], 4)
  })

  it("keeps Pruna's fixed nodes verbatim", () => {
    expect(PRUNA_8STEP_SIGMAS.map((s) => s.toFixed(4))).toEqual([
      '1.0000', '0.9333', '0.8571', '0.7692', '0.6667', '0.5455', '0.4000', '0.2222', '0.0000',
    ])
  })

  it('formats sigmas as plain decimals ManualSigmas can parse', () => {
    expect(formatSigmas([1, 1e-7, 0])).toBe('1.000000, 0.000000, 0.000000')
  })
})

describe('qwen21 prompt, size and batch', () => {
  it('applies size, seed and the batch cap of 4', () => {
    const wf = qwen21BaseWorkflow.buildPrompt({ ...base, batchSize: 9 })
    expect(wf['q:latent'].inputs).toMatchObject({ width: 832, height: 1216, batch_size: 4 })
  })

  it('resolves a negative seed to a random one, shared by sampler and schedule', () => {
    const wf = qwen21TurboWorkflow.buildPrompt({ ...base, seed: -1 })
    expect(wf['q:sampler'].inputs.noise_seed).toBeGreaterThanOrEqual(0)
  })

  it('does not leak state between builds', () => {
    qwen21BaseWorkflow.buildPrompt({ ...base, prompt: 'first', loras: [{ name: 'a.safetensors', strength: 1 }] })
    const wf = qwen21BaseWorkflow.buildPrompt(base)
    expect(wf['q:enc'].inputs.prompt).toBe(base.prompt)
    expect(wf['q:loras'].inputs.lora_01).toBe('None')
  })
})

describe('qwen21 registration', () => {
  it('registers both presets after Krea2, in the qwen21 LoRA family', () => {
    const ids = workflows.map((w) => w.id)
    expect(ids.indexOf('qwen21-turbo')).toBe(ids.indexOf('krea2-raw') + 1)
    expect(ids.indexOf('qwen21')).toBe(ids.indexOf('qwen21-turbo') + 1)
    for (const p of [qwen21TurboWorkflow, qwen21BaseWorkflow]) {
      expect(p.loraFamily).toBe('qwen21')
      expect(p.ariaModelKind).toBe('unet')
    }
  })

  it('swaps the diffusion model for a chosen Aria model', () => {
    const wf = qwen21BaseWorkflow.buildPrompt({ ...base, ariaModel: 'aria_qwen21_x.safetensors' })
    expect(wf['q:unet'].inputs.unet_name).toBe('aria_qwen21_x.safetensors')
  })

  it('saves into the QWEN21 gallery folder', () => {
    expect(String(qwen21BaseWorkflow.buildPrompt(base)['q:save'].inputs.filename_prefix)).toMatch(/^images\/QWEN21\//)
  })
})

describe('qwen21 user LoRA stack', () => {
  it('fills the four rgthree slots, compacting gaps', () => {
    const wf = qwen21BaseWorkflow.buildPrompt({
      ...base,
      loras: [{ name: 'a.safetensors', strength: 0.8 }, { name: '' }, { name: 'b.safetensors', strength: 1 }],
    })
    expect(wf['q:loras'].inputs).toMatchObject({
      lora_01: 'a.safetensors', strength_01: 0.8, lora_02: 'b.safetensors', strength_02: 1,
      lora_03: 'None', lora_04: 'None',
    })
  })

  it('chains a fifth LoRA upstream of the stack', () => {
    const loras = ['a', 'b', 'c', 'd', 'e'].map((n) => ({ name: `${n}.safetensors`, strength: 1 }))
    const wf = qwen21BaseWorkflow.buildPrompt({ ...base, loras })
    expect(wf['lora:x:0'].class_type).toBe('LoraLoader')
    expect(wf['lora:x:0'].inputs.lora_name).toBe('e.safetensors')
    expect(wf['q:loras'].inputs.model).toEqual(['lora:x:0', 0])
  })
})

describe('qwen21 post-processing', () => {
  const post: GenerationParams = { ...base, upscale: undefined, detailer: undefined }

  it.each([
    ['turbo', qwen21TurboWorkflow, 6],
    ['base', qwen21BaseWorkflow, 12],
  ] as const)('%s runs the HiRes fix by default at its own step count, euler/simple, denoise 0.15', (_n, p, steps) => {
    const wf = p.buildPrompt({ ...post, detailer: false })
    expect(wf['hires:upscale_model'].inputs.model_name).toBe('4x-UltraSharp.pth')
    expect(wf['hires:sample'].inputs).toMatchObject({
      steps, cfg: 1, sampler_name: 'euler', scheduler: 'simple', denoise: 0.15, seed: 42,
      positive: ['q:enc', 0], negative: ['q:enc', 1], model: ['q:loras', 0],
    })
  })

  it('keeps the distilled schedule on the main pass while the HiRes pass uses a KSampler', () => {
    const wf = qwen21TurboWorkflow.buildPrompt({ ...post, detailer: false })
    expect(wf['q:sampler'].class_type).toBe('SamplerCustom')
    expect(wf['hires:sample'].class_type).toBe('KSampler')
  })

  it('drops the HiRes fix and grains the decode when upscale is off', () => {
    const wf = qwen21BaseWorkflow.buildPrompt(base)
    expect(wf['hires:upscale']).toBeUndefined()
    expect(wf['grain:film'].inputs.image).toEqual(['q:decode:rgb', 0])
    expect(wf['q:save'].inputs.images).toEqual(['grain:film', 0])
  })

  it('adds the detailer after the HiRes fix, deterministic and on the encode conditioning', () => {
    const wf = qwen21BaseWorkflow.buildPrompt({ ...post, detailer: true })
    expect(wf['det:face'].inputs.image).toEqual(['hires:decode:rgb', 0])
    expect(wf['det:face'].inputs).toMatchObject({
      sampler_name: 'euler', scheduler: 'simple', denoise: 0.25, steps: 12,
      clip: ['q:loras', 1], positive: ['q:enc', 0], negative: ['q:enc', 1],
    })
  })

  it('omits the detailer when it is off', () => {
    expect(qwen21BaseWorkflow.buildPrompt(base)['det:face']).toBeUndefined()
  })

  it('forces the detailer on for a swap and swaps last', () => {
    const wf = qwen21TurboWorkflow.buildPrompt({ ...base, faceSwap: true, inputImage: 'face.png' })
    expect(wf['det:face']).toBeDefined()
    expect(wf['swap:reactor'].inputs.input_image).toEqual(['det:face', 0])
    expect(wf['grain:film'].inputs.image).toEqual(['swap:rgb', 0])
  })

  it('strips the swap when toggled on with no source', () => {
    expect(qwen21TurboWorkflow.buildPrompt({ ...base, faceSwap: true })['swap:reactor']).toBeUndefined()
  })

  it('always grains last at 0.04', () => {
    expect(qwen21TurboWorkflow.buildPrompt(base)['grain:film'].inputs.intensity).toBe(0.04)
  })

  it('img2img on the base rewires the KSampler latent and denoise', () => {
    const wf = qwen21BaseWorkflow.buildPrompt({ ...base, baseImage: 'src.png', editMode: 'img2img', denoise: 0.6 })
    expect(wf['i2i:load'].inputs.image).toBe('src.png')
    expect(wf['q:sampler'].inputs.latent_image).toEqual(['i2i:encode', 0])
    expect(wf['q:sampler'].inputs.denoise).toBe(0.6)
  })

  // A KSampler fallback over-cooked every Turbo base-image render (p99 detail
  // 178 vs 119 on img2img, crusted skin on inpaint — qwen21-basemodes.live.test.ts).
  it.each(['img2img', 'inpaint', 'outpaint'] as const)(
    'turbo %s keeps its distilled schedule, cut at the denoise by SplitSigmasDenoise', (editMode) => {
      const wf = qwen21TurboWorkflow.buildPrompt({
        ...base, baseImage: 'src.png', editMode, denoise: 0.6, maskImage: 'm.png',
        outpaint: { left: 64, top: 0, right: 64, bottom: 0, feather: 24 },
      })
      expect(wf['q:sampler'].class_type).toBe('SamplerCustom')
      expect(wf['q:sampler'].inputs.sigmas).toEqual(['q:split', 1])
      expect(wf['q:split']).toMatchObject({
        class_type: 'SplitSigmasDenoise',
        inputs: { sigmas: ['q:sigmas', 0], denoise: editMode === 'outpaint' ? 0.82 : 0.6 },
      })
      expect(wf['q:sampler'].inputs.latent_image).toEqual(editMode === 'img2img' ? ['i2i:encode', 0] : ['i2i:setmask', 0])
    })

  it('turbo text-to-image samples the whole schedule, with no split', () => {
    const wf = qwen21TurboWorkflow.buildPrompt(base)
    expect(wf['q:split']).toBeUndefined()
    expect(wf['q:sampler'].inputs.sigmas).toEqual(['q:sigmas', 0])
  })
})

describe('qwen21 prompt enhancer', () => {
  it('emits no enhancer when the toggle is off', () => {
    const wf = qwen21TurboWorkflow.buildPrompt({ ...base, qwen21Enhancer: QWEN21_PE_T2I })
    expect(wf['q:enhance']).toBeUndefined()
    expect(wf['q:pe']).toBeUndefined()
    expect(wf['q:enc'].inputs.prompt).toBe(base.prompt)
  })

  it('renders the literal prompt when the toggle is on but the model was never confirmed', () => {
    // A toggle restored from a saved session on an install without the 9.5 GB
    // enhancer: the form never sets qwen21Enhancer, so nothing may reference it.
    const wf = qwen21TurboWorkflow.buildPrompt({ ...base, promptEnhancer: true })
    expect(wf['q:enhance']).toBeUndefined()
    expect(wf['q:pe']).toBeUndefined()
    expect(wf['q:enc'].inputs.prompt).toBe(base.prompt)
  })

  it('routes the prompt through its own enhancer model when both are present', () => {
    const wf = qwen21TurboWorkflow.buildPrompt({ ...base, promptEnhancer: true, qwen21Enhancer: QWEN21_PE_T2I })
    expect(wf['q:pe'].inputs).toMatchObject({ clip_name: QWEN21_PE_T2I })
    expect(wf['q:enhance'].class_type).toBe('TextGenerate')
    expect(wf['q:enhance'].inputs).toMatchObject({
      clip: ['q:pe', 0], use_default_template: true, 'sampling_mode.seed': 42,
    })
    expect(String(wf['q:enhance'].inputs.prompt).startsWith(base.prompt)).toBe(true)
    expect(String(wf['q:enhance'].inputs.system_prompt)).toContain('Image Prompt Rewriting Expert')
    expect(wf['q:enc'].inputs.prompt).toEqual(['q:enhance', 0])
  })

  it('keeps the stock system prompt free of its leftover chat wrapper', () => {
    const wf = qwen21TurboWorkflow.buildPrompt({ ...base, promptEnhancer: true, qwen21Enhancer: QWEN21_PE_T2I })
    const sys = String(wf['q:enhance'].inputs.system_prompt)
    expect(sys).not.toContain('<|im_start|>')
    expect(sys).not.toContain('<|im_end|>')
  })

  it("states the canvas ratio, so the enhancer cannot describe a vertical frame on a wide canvas", () => {
    // The stock prompt's Step 2 picks a ratio from the subject unless the user
    // states one, and its opening sentence names the orientation.
    const at = (width: number, height: number) =>
      qwen21TurboWorkflow.buildPrompt({ ...base, width, height, promptEnhancer: true, qwen21Enhancer: QWEN21_PE_T2I })['q:enhance'].inputs.prompt
    expect(at(832, 1216)).toBe(`${base.prompt}\n\nAspect ratio: 2:3`)
    expect(at(1344, 768)).toBe(`${base.prompt}\n\nAspect ratio: 16:9`)
    expect(at(1024, 1024)).toBe(`${base.prompt}\n\nAspect ratio: 1:1`)
    expect(at(768, 1344)).toBe(`${base.prompt}\n\nAspect ratio: 9:16`)
  })

  it('defaults the toggle to off so a written prompt is used verbatim', () => {
    expect(qwen21TurboWorkflow.defaultParams.promptEnhancer).toBe(false)
    expect(qwen21TurboWorkflow.supportsPromptEnhancer).toBe(true)
  })
})

describe('qwen21 edit preset', () => {
  const edit = workflows.find((w) => w.id === 'qwen21-edit')!
  const pics = ['a.png', 'b.png', 'c.png', 'd.png']

  it('is registered right after the base, with four picture slots and no img2img / enhancer / ControlNet', () => {
    const ids = workflows.map((w) => w.id)
    expect(ids.indexOf('qwen21-edit')).toBe(ids.indexOf('qwen21') + 1)
    // M1 (qwen21-edit-pick.live.test.ts, 2026-10-02): the Turbo edits on par with
    // the base on 4 edits × 2 seeds, 7.6 s against 26 s.
    expect(edit).toMatchObject({
      referenceSlots: 4, supportsImg2Img: false, supportsPromptEnhancer: false,
      supportsControlNet: false, baseModel: QWEN21_TURBO_UNET, distilledSchedule: true,
    })
    expect(edit.controlNetKind).toBeUndefined()
  })

  it('loads every picture onto the encode node, in order, and samples on its latent', () => {
    const wf = edit.buildPrompt({ ...base, qwenReferences: pics })
    pics.forEach((p, i) => {
      expect(wf[`q:ref:${i}`].inputs.image).toBe(p)
      expect(wf['q:enc'].inputs[`images.image_${i + 1}`]).toEqual([`q:ref:${i}`, 0])
    })
    expect(wf['q:enc'].inputs.vae).toEqual(['q:vae', 0])
    expect(wf['q:sampler'].inputs.latent_image).toEqual(['q:enc', 2])
  })

  it("renders the same edit through Simple's overlay: pictures and the head swap kept, the user's LoRAs dropped", () => {
    const params = { ...base, qwenReferences: pics.slice(0, 2), editChip: 'bfs' as const, loras: [{ name: 'mine.safetensors', strength: 1 }] }
    const wf = edit.buildPrompt({ ...params, ...simpleImageValues(edit) })
    expect(wf['q:ref:0'].inputs.image).toBe('a.png')
    expect(wf['q:ref:1'].inputs.image).toBe('b.png')
    const json = JSON.stringify(wf)
    expect(json).toContain(QWEN21_BFS_LORAS.alternative)
    expect(json).not.toContain('mine.safetensors')
  })

  it.each(['qwen21-turbo', 'qwen21'])('%s ignores pictures and chips an edit left in the form', (id) => {
    const wf = workflows.find((w) => w.id === id)!.buildPrompt({ ...base, qwenReferences: pics, editChip: 'bfs' })
    expect(wf['q:ref:0']).toBeUndefined()
    expect(wf['q:enc'].inputs.vae).toBeUndefined()
    expect(wf['qwen21:bfs:0']).toBeUndefined()
  })

  it('ignores a base image and a ControlNet left in the form by another preset', () => {
    const wf = edit.buildPrompt({
      ...base, qwenReferences: pics, baseImage: 'old.png', editMode: 'inpaint', maskImage: 'm.png',
      controlNet: { mode: 'depth', image: 'cn.png', strength: 0.7 },
    })
    expect(wf['i2i:load']).toBeUndefined()
    expect(Object.values(wf).some((n) => n.class_type === 'ModelPatchLoader')).toBe(false)
    expect(wf['q:sampler'].inputs.latent_image).toEqual(['q:enc', 2])
  })

  it.each([
    ['alternative', 'bfs_head_v1.1_alternative_qwen_2.1.safetensors'],
    ['v1.1', 'bfs_head_v1.1_qwen_2.1.safetensors'],
    [undefined, 'bfs_head_v1.1_alternative_qwen_2.1.safetensors'],
  ] as const)('head swap (%s) loads its BFS LoRA ahead of the user stack, on pictures 1 and 2 only', (variant, file) => {
    const wf = edit.buildPrompt({
      ...base, qwenReferences: pics, editChip: 'bfs', bfsVariant: variant,
      loras: [{ name: 'mine.safetensors', strength: 0.7 }],
    })
    expect(QWEN21_BFS_LORAS[variant ?? 'alternative']).toBe(file)
    expect(wf['qwen21:bfs:0']).toMatchObject({
      class_type: 'LoraLoaderModelOnly',
      inputs: { lora_name: file, strength_model: 1, model: ['q:cache', 0] },
    })
    expect(wf['q:loras'].inputs.model).toEqual(['qwen21:bfs:0', 0])
    expect(wf['q:loras'].inputs.lora_01).toBe('mine.safetensors')
    expect(wf['q:ref:1'].inputs.image).toBe('b.png')
    expect(wf['q:ref:2']).toBeUndefined()
  })

  it('without a chip there is no BFS LoRA', () => {
    const wf = edit.buildPrompt({ ...base, qwenReferences: pics })
    expect(wf['qwen21:bfs:0']).toBeUndefined()
    expect(wf['q:loras'].inputs.model).toEqual(['q:cache', 0])
  })

  it('the sheet chip takes picture 1 only and never rewrites the instruction', () => {
    const wf = edit.buildPrompt({ ...base, prompt: 'my words', qwenReferences: pics, editChip: 'sheet' })
    expect(wf['q:ref:0'].inputs.image).toBe('a.png')
    expect(wf['q:ref:1']).toBeUndefined()
    expect(wf['q:enc'].inputs.prompt).toBe('my words')
  })

  it("the sheet renders on picture 1's canvas, the encode node's latent (M2)", () => {
    const wf = edit.buildPrompt({ ...base, qwenReferences: pics, editChip: 'sheet' })
    expect(wf['q:sampler'].inputs.latent_image).toEqual(['q:enc', 2])
  })

  it('renders one image per job whatever the batch size says', () => {
    // The encode node's latent is a single picture-1-sized latent.
    const wf = edit.buildPrompt({ ...base, qwenReferences: pics, batchSize: 4 })
    expect(wf['q:sampler'].inputs.latent_image).toEqual(['q:enc', 2])
  })

  it('leaves the enhancer out — the t2i enhancer never sees the pictures', () => {
    const wf = edit.buildPrompt({ ...base, qwenReferences: pics, promptEnhancer: true, qwen21Enhancer: QWEN21_PE_T2I })
    expect(wf['q:enhance']).toBeUndefined()
    expect(wf['q:enc'].inputs.prompt).toBe(base.prompt)
  })

  it("samples the Turbo's distilled schedule for the ~1 MP picture canvas", () => {
    const wf = edit.buildPrompt({ ...base, qwenReferences: pics, width: 768, height: 1344 })
    expect(wf['q:unet'].inputs.unet_name).toBe(QWEN21_TURBO_UNET)
    expect(wf['q:sampler'].class_type).toBe('SamplerCustom')
    expect(wf['q:sigmas'].inputs.sigmas).toBe(formatSigmas(viggleSigmas(1024, 1024)))
    expect(wf['q:sampler'].inputs.latent_image).toEqual(['q:enc', 2])
  })

  it("the base candidate (M1's other leg, the BFS comparison's model) runs a 40-step KSampler on the edit path", () => {
    const wf = qwen21EditBaseCandidate.buildPrompt({ ...base, qwenReferences: pics })
    expect(wf['q:unet'].inputs.unet_name).toBe(QWEN21_BASE_UNET)
    expect(wf['q:sampler']).toMatchObject({ class_type: 'KSampler', inputs: { steps: 40, latent_image: ['q:enc', 2] } })
  })
})

describe('qwen21 RGBA decode', () => {
  // Qwen-Image 2.1's VAE decodes RGBA (native transparency): the live suite's
  // Film Grain failed with "images do not match" and FaceDetailer's SAM with
  // "set_torch_image input must be BCHW". Every decode must hand the chain RGB.
  const decodeReaders = (wf: Record<string, { class_type: string; inputs: Record<string, unknown> }>) => {
    const decodes = new Set(Object.entries(wf).filter(([, n]) => n.class_type === 'VAEDecode').map(([id]) => id))
    return Object.entries(wf).flatMap(([id, n]) =>
      Object.values(n.inputs)
        .filter((v): v is [string, number] => Array.isArray(v) && decodes.has(v[0] as string))
        .map(() => [id, n.class_type] as const),
    )
  }

  it.each([
    ['turbo, plain', qwen21TurboWorkflow, { ...base }],
    ['base, HiRes + detailer + swap', qwen21BaseWorkflow, { ...base, upscale: true, detailer: true, faceSwap: true, inputImage: 'f.png' }],
    ['base, outpaint', qwen21BaseWorkflow, { ...base, baseImage: 'b.png', editMode: 'outpaint' as const, outpaint: { left: 64, top: 0, right: 64, bottom: 0, feather: 24 } }],
  ])('%s: only SplitImageWithAlpha reads a decode', (_n, p, params) => {
    const readers = decodeReaders(p.buildPrompt(params as GenerationParams))
    expect(readers.length).toBeGreaterThan(0)
    expect(readers.every(([, cls]) => cls === 'SplitImageWithAlpha')).toBe(true)
  })

  it('grains the RGB of the decode when nothing else runs', () => {
    const wf = qwen21BaseWorkflow.buildPrompt(base)
    expect(wf['q:decode:rgb']).toMatchObject({ class_type: 'SplitImageWithAlpha', inputs: { image: ['q:decode', 0] } })
    expect(wf['grain:film'].inputs.image).toEqual(['q:decode:rgb', 0])
  })
})

describe('qwen21 prefix cache', () => {
  // Off: 22/22 clean where `auto` and `gpu` went grey 4/4 — a reduction of the
  // grey-texture bug, not a fix (cause unknown). See the comment above
  // QWEN21_BASE_UNET.
  it.each([
    ['turbo', qwen21TurboWorkflow],
    ['base', qwen21BaseWorkflow],
  ] as const)('%s routes the diffusion model through QwenImage21Cache with the cache off', (_n, p) => {
    const wf = p.buildPrompt(base)
    expect(wf['q:cache']).toMatchObject({
      class_type: 'QwenImage21Cache',
      inputs: { model: ['q:unet', 0], device: 'off', dtype: 'default' },
    })
    // Nothing reads the bare model any more.
    const readers = Object.entries(wf).filter(([id, n]) =>
      id !== 'q:cache' && Object.values(n.inputs).some((v) => Array.isArray(v) && v[0] === 'q:unet'))
    expect(readers).toEqual([])
  })

  it('keeps the cache under a user LoRA chain too', () => {
    const loras = ['a', 'b', 'c', 'd', 'e'].map((n) => ({ name: `${n}.safetensors`, strength: 1 }))
    const wf = qwen21BaseWorkflow.buildPrompt({ ...base, loras })
    expect(wf['lora:x:0'].inputs.model).toEqual(['q:cache', 0])
  })
})

describe('qwen21 enhancer settings (measured)', () => {
  it('runs the enhancer with thinking on and a 2560-token cap', () => {
    const wf = qwen21TurboWorkflow.buildPrompt({ ...base, promptEnhancer: true, qwen21Enhancer: QWEN21_PE_T2I })
    // Measured 2026-10-01, 5 prompts x 6 seeds (qwen21-enhancer.live.test.ts):
    // thinking off leaked its reasoning ("Step 1 —", "The user's brief is…")
    // into 8/30 prompts; thinking on 0/30, none truncated, longest 4678 chars.
    expect(wf['q:enhance'].inputs.thinking).toBe(true)
    expect(wf['q:enhance'].inputs.max_length).toBe(2560)
  })
})

describe('qwen21 edit chips and guards', () => {
  it('turning a chip on fills its instruction; switching chips replaces it', () => {
    expect(toggleEditChip(undefined, 'anything', 'sheet')).toEqual({ editChip: 'sheet', prompt: QWEN21_SHEET_PROMPT })
    expect(toggleEditChip('sheet', QWEN21_SHEET_PROMPT, 'bfs')).toEqual({ editChip: 'bfs', prompt: QWEN21_BFS_PROMPT })
  })

  it('turning the active chip off empties its untouched text but keeps an edited one', () => {
    expect(toggleEditChip('bfs', QWEN21_BFS_PROMPT, 'bfs')).toEqual({ editChip: undefined, prompt: '' })
    expect(toggleEditChip('bfs', `${QWEN21_BFS_PROMPT}, smiling`, 'bfs'))
      .toEqual({ editChip: undefined, prompt: `${QWEN21_BFS_PROMPT}, smiling` })
  })

  it("Simple's task buttons: picking the lit one changes nothing, 'Change something' turns the chip off", () => {
    expect(pickEditTask('sheet', QWEN21_SHEET_PROMPT, 'sheet')).toEqual({ editChip: 'sheet', prompt: QWEN21_SHEET_PROMPT })
    expect(pickEditTask(undefined, 'make it night', undefined)).toEqual({ editChip: undefined, prompt: 'make it night' })
    expect(pickEditTask('sheet', QWEN21_SHEET_PROMPT, undefined)).toEqual({ editChip: undefined, prompt: '' })
    expect(pickEditTask(undefined, 'make it night', 'bfs')).toEqual({ editChip: 'bfs', prompt: QWEN21_BFS_PROMPT })
  })

  it('the BFS download URL names the build the builder loads', () => {
    expect(qwen21BfsUrl('alternative')).toBe(`https://huggingface.co/Alissonerdx/BFS-Best-Face-Swap/resolve/main/${QWEN21_BFS_LORAS.alternative}`)
  })

  it('names what is missing before an edit can be queued', () => {
    expect(qwen21EditProblem(undefined, undefined, true)).toBe('Pick a picture to edit first')
    expect(qwen21EditProblem([], 'sheet', true)).toBe('Pick a picture to edit first')
    expect(qwen21EditProblem(['a.png'], 'bfs', true)).toBe('Add the head to bring in (picture 2)')
    expect(qwen21EditProblem(['a.png'], undefined, false)).toBeNull()
    expect(qwen21EditProblem(['a.png', 'b.png'], 'bfs', true)).toBeNull()
  })

  // Review Focus: a restored session can carry the chip after the file is gone.
  it('refuses a head swap whose BFS file is not installed', () => {
    expect(qwen21EditProblem(['a.png', 'b.png'], 'bfs', false))
      .toBe('Get the BFS head-swap LoRA on the Models page first')
  })

  // Review Focus: uploadImageBlob overwrites, so two pictures must never share a name.
  it('gives every uploaded picture its own filename', () => {
    const names = new Set(Array.from({ length: 50 }, editUploadName))
    expect(names.size).toBe(50)
    for (const n of names) expect(n).toMatch(/^qwen-edit-[a-z0-9]+\.png$/)
  })
})

describe('qwen21 edit links', () => {
  // Review Focus: a gallery under a non-ASCII user folder.
  it.each([
    '/api/comfyui/view?filename=a.png&subfolder=images%2FQWEN21&type=output',
    '/api/gallery/file?path=C:/Users/Jörg/Bilder/my pic #2 & more.png',
  ])('round-trips %s unchanged', (url) => {
    const href = qwen21EditHref(url, 'sheet')
    expect(href.startsWith('/generate?')).toBe(true)
    const q = new URLSearchParams(href.slice('/generate?'.length))
    expect(q.get('workflow')).toBe('qwen21-edit')
    expect(q.get('ref')).toBe(url)
    expect(q.get('chip')).toBe('sheet')
  })

  it('carries no chip for a plain edit', () => {
    expect(new URLSearchParams(qwen21EditHref('/x.png').split('?')[1]).get('chip')).toBeNull()
  })

  // Review Focus: a link lands on a restored session that may hold old pictures and a chip.
  // A ?workflow= link skips the session restore, so the prompt then holds the
  // first preset's default (Anima's "masterpiece, best quality, safe, ") —
  // junk as an edit instruction.
  it('makes the linked picture picture 1 alone, clears a stale chip and starts an empty instruction', () => {
    expect(qwen21EditLinkPatch('new.png', false))
      .toEqual({ qwenReferences: ['new.png'], editChip: undefined, prompt: '' })
  })

  it('turns the sheet chip on with its instruction for a sheet link', () => {
    expect(qwen21EditLinkPatch('new.png', true))
      .toEqual({ qwenReferences: ['new.png'], editChip: 'sheet', prompt: QWEN21_SHEET_PROMPT })
  })
})

// Final review 2026-10-02.
describe('qwen21 edit — review fixes', () => {
  const none = { alternative: false, 'v1.1': false }

  // A restored or offline-at-load session left the chip pressed AND disabled.
  it('the head-swap chip can always be turned off, and only turned on once a build is listed', () => {
    expect(headSwapChipDisabled(none, 'bfs')).toBe(false)
    expect(headSwapChipDisabled(none, undefined)).toBe(true)
    expect(headSwapChipDisabled(none, 'sheet')).toBe(true)
    expect(headSwapChipDisabled({ alternative: false, 'v1.1': true }, undefined)).toBe(false)
  })

  // Only v1.1 downloaded: the default (Alternative) was refused as "not installed".
  it('an unpicked BFS build falls back to the one that is installed', () => {
    expect(bfsVariantFor(undefined, { alternative: false, 'v1.1': true })).toBe('v1.1')
    expect(bfsVariantFor(undefined, { alternative: true, 'v1.1': true })).toBe('alternative')
    expect(bfsVariantFor(undefined, none)).toBe('alternative')
    expect(bfsVariantFor('alternative', { alternative: false, 'v1.1': true })).toBe('alternative')
  })

  // The button read "Generate × 4" while each edit job renders one picture.
  it('an edit job renders one picture whatever the batch size says', () => {
    const edit = workflows.find((w) => w.id === 'qwen21-edit')!
    expect(jobBatchSize(edit, { ...base, batchSize: 4 })).toBe(1)
    expect(jobBatchSize(qwen21TurboWorkflow, { ...base, batchSize: 4 })).toBe(4)
    expect(jobBatchSize(qwen21TurboWorkflow, base)).toBe(1)
  })
})

// Released with the grey-texture bug open (owner, 2026-10-02): every Qwen preset
// says so where the user picks it.
describe('qwen21 experimental label', () => {
  it.each(['qwen21-turbo', 'qwen21', 'qwen21-edit'])('%s carries the experimental note', (id) => {
    expect(workflows.find((w) => w.id === id)!.description).toContain(QWEN21_EXPERIMENTAL)
    expect(QWEN21_EXPERIMENTAL).toMatch(/grey noise/)
  })
})

describe('qwen21 edit picture limit', () => {
  // One number for the builder (which pictures reach the graph) and the panel
  // (which slots it dims as unused).
  it('a chip takes only the pictures its instruction names', () => {
    expect(editPictureLimit('bfs')).toBe(2)
    expect(editPictureLimit('sheet')).toBe(1)
    expect(editPictureLimit(undefined)).toBe(4)
  })
})
