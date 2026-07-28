import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { classifyLoraHeader, readSafetensorsHeader, classifyLoraFile, type SafetensorsHeader } from './lora-arch'
import { visibleLoras } from './lora-family'

/** Build a header from tensor names alone (shapes only matter for the SDXL/SD1.5 split). */
const h = (names: string[]): SafetensorsHeader =>
  Object.fromEntries(names.map((n) => [n, { dtype: 'BF16', shape: [32, 256] }])) as SafetensorsHeader

describe('classifyLoraHeader — tensor-key fingerprints', () => {
  // Key sets below are taken verbatim from the reference install's files.
  it('identifies Z-Image (diffusion_model.layers.*)', () => {
    expect(classifyLoraHeader(h([
      'diffusion_model.layers.0.adaLN_modulation.0.lora_A.weight',
      'diffusion_model.layers.0.attention.to_k.lora_A.weight',
    ]))).toBe('zimage')
  })

  it('identifies Anima (lora_unet_blocks_*)', () => {
    expect(classifyLoraHeader(h([
      'lora_unet_blocks_0_adaln_modulation_cross_attn_1.lora_down.weight',
      'lora_unet_blocks_0_adaln_modulation_cross_attn_1.lora_up.weight',
    ]))).toBe('anima')
  })

  it('identifies LTX video (diffusion_model.transformer_blocks.*)', () => {
    expect(classifyLoraHeader(h([
      'diffusion_model.transformer_blocks.0.audio_attn1.to_gate_logits.alpha',
      'diffusion_model.audio_patchify_proj.alpha',
    ]))).toBe('ltx')
  })

  it('identifies Flux', () => {
    expect(classifyLoraHeader(h(['diffusion_model.double_blocks.0.img_attn.qkv.lora_A.weight']))).toBe('flux')
  })

  it('does not confuse Anima blocks with SDXL input_blocks', () => {
    // 'lora_unet_blocks_' vs 'lora_unet_input_blocks_' — neither prefixes the other.
    expect(classifyLoraHeader(h(['lora_unet_input_blocks_4_1_transformer_blocks_0_attn1_to_q.lora_down.weight'])))
      .toBe('sdxl')
  })

  it('identifies Krea2 in ComfyUI key format (diffusion_model.txtfusion.*)', () => {
    // verified: Krea2_TextFusion_Refusal_Reduction.safetensors — 64 rank-64
    // tensors, all under diffusion_model.txtfusion.
    expect(classifyLoraHeader(h([
      'diffusion_model.txtfusion.layerwise_blocks.0.attn.wq.lora_A.weight',
      'diffusion_model.txtfusion.refiner_blocks.1.mlp.down.lora_B.weight',
    ]))).toBe('krea2')
  })

  it('identifies Krea2 in diffusers key format (transformer.text_fusion.*)', () => {
    // verified: the Beinsezii projector-scale LoRA — a 268-byte, two-tensor file.
    expect(classifyLoraHeader(h([
      'transformer.text_fusion.projector.lora_A.weight',
      'transformer.text_fusion.projector.lora_B.weight',
    ]))).toBe('krea2')
  })

  it('identifies an official Krea2 style LoRA, which carries no metadata at all', () => {
    // verified: Comfy-Org/Krea-2 loras/krea2_darkbrush.safetensors — 528 tensors,
    // empty __metadata__, so the key rule is the only thing that can classify it.
    expect(classifyLoraHeader({
      ...h([
        'transformer.img_in.lora_A.weight',
        'transformer.final_layer.linear.lora_B.weight',
        'transformer.text_fusion.layerwise_blocks.0.attn.to_gate.lora_A.weight',
      ]),
      __metadata__: {},
    })).toBe('krea2')
  })

  it('does not mistake a QwenImage-style transformer LoRA for Krea2', () => {
    // Bare 'transformer.' is shared with QwenImage/SimpleTuner, which is why the
    // rule matches 'transformer.text_fusion.' and not the bare prefix.
    expect(classifyLoraHeader(h(['transformer.transformer_blocks.0.attn.to_q.lora_A.weight'])))
      .not.toBe('krea2')
  })
})

describe('classifyLoraHeader — SDXL vs SD1.5', () => {
  it('calls it SDXL when a second text encoder is present', () => {
    expect(classifyLoraHeader(h([
      'lora_unet_input_blocks_4_1_transformer_blocks_0_attn1_to_q.lora_down.weight',
      'lora_te2_text_model_encoder_layers_0_self_attn_k_proj.lora_down.weight',
    ]))).toBe('sdxl')
  })

  it('calls it SD1.5 on a 768-dim cross-attention context', () => {
    const header: SafetensorsHeader = {
      'lora_unet_input_blocks_1_1_transformer_blocks_0_attn2_to_k.lora_down.weight': { shape: [32, 768] },
      'lora_te_text_model_encoder_layers_0_self_attn_k_proj.lora_down.weight': { shape: [32, 768] },
    }
    expect(classifyLoraHeader(header)).toBe('sd15')
  })

  it('calls it SDXL on a 2048-dim cross-attention context', () => {
    const header: SafetensorsHeader = {
      'lora_unet_input_blocks_4_1_transformer_blocks_0_attn2_to_k.lora_down.weight': { shape: [32, 2048] },
    }
    expect(classifyLoraHeader(header)).toBe('sdxl')
  })
})

describe('classifyLoraHeader — metadata is only a fallback', () => {
  it('ignores a lying modelspec.architecture when the keys disagree', () => {
    // Regression guard for the real ANIMA_muscgi_2.safetensors: its sd-scripts
    // fork wrote `stable-diffusion-v1/lora`, which is simply false. Trusting
    // metadata first would hide this LoRA from the model it was trained for.
    const header: SafetensorsHeader = {
      __metadata__: {
        'modelspec.architecture': 'stable-diffusion-v1/lora',
        ss_base_model_version: 'anima',
        ss_network_module: 'networks.lora_anima',
      },
      'lora_unet_blocks_0_adaln_modulation_cross_attn_1.lora_down.weight': { shape: [32, 2048] },
    }
    expect(classifyLoraHeader(header)).toBe('anima')
  })

  it('falls back to metadata when the key layout is unrecognised', () => {
    const header: SafetensorsHeader = {
      __metadata__: { ss_base_model_version: 'ernie' },
      'some.unknown.layout.lora_A.weight': { shape: [32, 256] },
    }
    expect(classifyLoraHeader(header)).toBe('ernie')
  })

  it('does not scan free-text metadata like dataset tags', () => {
    // ss_datasets embeds user tag names; a dataset tagged "flux" must not
    // classify the LoRA as Flux.
    const header: SafetensorsHeader = {
      __metadata__: { ss_datasets: '[{"tag_frequency": {"dataset": {"flux": 25}}}]' },
      'some.unknown.layout.lora_A.weight': { shape: [32, 256] },
    }
    expect(classifyLoraHeader(header)).toBeNull()
  })

  it('returns null for an unrecognised file so it stays visible', () => {
    expect(classifyLoraHeader(h(['mystery.weight']))).toBeNull()
    expect(classifyLoraHeader(null)).toBeNull()
  })
})

describe('readSafetensorsHeader', () => {
  let tmp: string
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'raccoon-lora-')) })
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }) })

  /** Write a minimal but structurally real safetensors file. */
  const write = (name: string, header: object, weights = 64): string => {
    const json = Buffer.from(JSON.stringify(header), 'utf8')
    const len = Buffer.alloc(8)
    len.writeBigUInt64LE(BigInt(json.length))
    const file = path.join(tmp, name)
    fs.writeFileSync(file, Buffer.concat([len, json, Buffer.alloc(weights)]))
    return file
  }

  it('reads the header without touching the weight blob', () => {
    const file = write('z.safetensors', {
      __metadata__: { 'modelspec.architecture': 'zimageturbo/lora' },
      'diffusion_model.layers.0.attention.to_k.lora_A.weight': { dtype: 'BF16', shape: [32, 3840], data_offsets: [0, 8] },
    })
    expect(readSafetensorsHeader(file)).toMatchObject({
      __metadata__: { 'modelspec.architecture': 'zimageturbo/lora' },
    })
    expect(classifyLoraFile(file)).toBe('zimage')
  })

  it('survives a header length larger than the file', () => {
    const file = path.join(tmp, 'truncated.safetensors')
    const len = Buffer.alloc(8)
    len.writeBigUInt64LE(BigInt(999_999))
    fs.writeFileSync(file, Buffer.concat([len, Buffer.from('{}')]))
    expect(readSafetensorsHeader(file)).toBeNull()
  })

  it('survives garbage, empty files and missing files', () => {
    const garbage = path.join(tmp, 'garbage.safetensors')
    fs.writeFileSync(garbage, Buffer.alloc(8, 0xff))
    expect(readSafetensorsHeader(garbage)).toBeNull()

    const empty = path.join(tmp, 'empty.safetensors')
    fs.writeFileSync(empty, Buffer.alloc(0))
    expect(readSafetensorsHeader(empty)).toBeNull()

    expect(readSafetensorsHeader(path.join(tmp, 'nope.safetensors'))).toBeNull()
  })

  it('rejects a header that parses to a non-object', () => {
    expect(readSafetensorsHeader(write('arr.safetensors', [1, 2, 3] as unknown as object))).toBeNull()
  })
})

describe('visibleLoras', () => {
  // Captured live: ComfyUI's /object_info LoRA list and this app's
  // /api/models/lora-arch response, on an install holding all three.
  const names = [
    'ANIMA_muscgi_2.safetensors',
    'LTX2.3_DMD_reshaped_r256.safetensors',
    'ZIT_muscgi_1.safetensors',
  ]
  const families = {
    'ANIMA_muscgi_2.safetensors': 'anima',
    'LTX2.3_DMD_reshaped_r256.safetensors': 'ltx',
    'ZIT_muscgi_1.safetensors': 'zimage',
  } as const

  it('shows a model only its own LoRAs', () => {
    expect(visibleLoras(names, families, 'zimage')).toEqual(['ZIT_muscgi_1.safetensors'])
    expect(visibleLoras(names, families, 'anima')).toEqual(['ANIMA_muscgi_2.safetensors'])
    expect(visibleLoras(names, families, 'ltx')).toEqual(['LTX2.3_DMD_reshaped_r256.safetensors'])
  })

  it('keeps the video LoRA out of the image pickers', () => {
    // The bug that motivated this: an LTX video LoRA was offered for image gen.
    expect(visibleLoras(names, families, 'sdxl')).toEqual([])
  })

  it('shows everything when the workflow declares no family', () => {
    expect(visibleLoras(names, families, undefined)).toEqual(names)
  })

  it('keeps unrecognised LoRAs visible for every family', () => {
    const withUnknown = [...names, 'mystery.safetensors']
    const map = { ...families, 'mystery.safetensors': null }
    expect(visibleLoras(withUnknown, map, 'sdxl')).toEqual(['mystery.safetensors'])
    // Missing from the map entirely (e.g. API failed) behaves the same way.
    expect(visibleLoras(withUnknown, families, 'sdxl')).toEqual(['mystery.safetensors'])
  })

  it('shows every LoRA when the arch API returned nothing', () => {
    expect(visibleLoras(names, {}, 'zimage')).toEqual(names)
  })

  it('matches ComfyUI subfolder names that use OS separators', () => {
    expect(visibleLoras(['style\ZIT_muscgi_1.safetensors'], { 'style/ZIT_muscgi_1.safetensors': 'zimage' }, 'zimage'))
      .toEqual(['style\ZIT_muscgi_1.safetensors'])
  })

  it('never drops the current selection', () => {
    expect(visibleLoras(names, families, 'zimage', 'ANIMA_muscgi_2.safetensors'))
      .toEqual(['ANIMA_muscgi_2.safetensors', 'ZIT_muscgi_1.safetensors'])
  })
})
