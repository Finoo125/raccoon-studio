import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { classifyLoraHeader, classifyBaseHeader, readSafetensorsHeader, classifyLoraFile, type SafetensorsHeader } from './lora-arch'
import { visibleForFamily } from './lora-family'

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

  it('identifies MiniMax H3 in both of its key formats', () => {
    // Mystic XXX ships v2 in ComfyUI keys and v4 in sd-scripts keys — one LoRA
    // family, no shared prefix, so both spellings need to land on 'h3'.
    expect(classifyLoraHeader(h([
      'diffusion_model.blocks.0.mlp.fc1.lora_A.weight',
      'diffusion_model.blocks.0.mlp.fc2.lora_B.weight',
    ]))).toBe('h3')
    expect(classifyLoraHeader(h([
      'lora_unet_blocks_24_attn_qkv_proj.lora_down.weight',
      'lora_unet_blocks_24_mlp_fc1.lora_down.weight',
    ]))).toBe('h3')
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

  it('identifies Krea2 in sd-scripts key format, despite Anima-style block keys', () => {
    // verified: aria_muscgi_krea2_r32_ep08.safetensors — ss_network_module
    // `networks.lora_krea2`, trained on krea2_raw_bf16. Its transformer blocks
    // are `lora_unet_blocks_*`, the same sd-scripts convention Anima uses, so
    // only the txtfusion keys separate the two — and the krea2 rule has to be
    // reached before the anima one for that to matter.
    expect(classifyLoraHeader(h([
      'lora_unet_blocks_0_attn_wk.lora_down.weight',
      'lora_unet_txtfusion_projector.lora_up.weight',
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

/** Like `h`, but with each tensor's shape spelled out — the Qwen split reads the attention width. */
const hs = (tensors: Record<string, number[]>): SafetensorsHeader =>
  Object.fromEntries(
    Object.entries(tensors).map(([n, shape]) => [n, { dtype: 'BF16', shape }]),
  ) as SafetensorsHeader

describe('classifyLoraHeader — Qwen-Image 2.1 vs Qwen-Image 1.x', () => {
  // Key shapes read from the real files' headers over HTTP range requests,
  // 2026-10-01 (spec: 2026-10-01-qwen-image-21-family-design.md).
  it('identifies BFS head-swap v1.1 for Qwen 2.1 (ComfyUI keys, fused gate_up)', () => {
    expect(classifyLoraHeader(hs({
      'diffusion_model.transformer_blocks.0.attn.to_k.lora_A.weight': [64, 4096],
      'diffusion_model.transformer_blocks.0.img_mlp.gate_up.lora_A.weight': [64, 4096],
      'diffusion_model.transformer_blocks.0.img_mlp.out.lora_B.weight': [4096, 64],
    }))).toBe('qwen21')
  })

  it('identifies the Pruna 8-step LoRA (diffusers keys, split gate_layer/proj)', () => {
    expect(classifyLoraHeader(hs({
      'transformer.transformer_blocks.0.attn.to_q.lora_A.weight': [64, 4096],
      'transformer.transformer_blocks.0.img_mlp.gate_layer.lora_A.weight': [64, 4096],
      'transformer.transformer_blocks.0.img_mlp.proj.lora_B.weight': [12288, 64],
    }))).toBe('qwen21')
  })

  it('identifies attention-only Viggle turbo by its 4096 attention width', () => {
    expect(classifyLoraHeader(hs({
      'transformer.modulation.1.lora_A.weight': [128, 4096],
      'transformer.time_text_embed.timestep_embedder.linear_1.lora_A.weight': [128, 256],
      'transformer.transformer_blocks.0.attn.to_k.lora_A.weight': [128, 4096],
      'transformer.transformer_blocks.0.attn.to_k.lora_B.weight': [4096, 128],
    }))).toBe('qwen21')
  })

  it('identifies bare keys with no .weight suffix (Alibaba Fun-Acc)', () => {
    expect(classifyLoraHeader(hs({
      'transformer_blocks.0.attn.to_k.lora_down': [64, 4096],
      'transformer_blocks.0.attn.to_k.lora_up': [4096, 64],
      'transformer_blocks.0.attn.norm_k.weight': [128],
    }))).toBe('qwen21')
  })

  it('identifies sd-scripts underscore keys', () => {
    expect(classifyLoraHeader(hs({
      'lora_unet_transformer_blocks_3_img_mlp_gate_up.lora_down.weight': [32, 4096],
    }))).toBe('qwen21')
  })

  it('files a Qwen-Image-Edit 2511 LoRA as qwenimage, not LTX', () => {
    // verified: BFS head v5 for 2511 — 60 dual-stream blocks at width 3072.
    expect(classifyLoraHeader(hs({
      'diffusion_model.transformer_blocks.0.attn.add_k_proj.lora_A.weight': [4, 3072],
      'diffusion_model.transformer_blocks.0.attn.to_k.lora_A.weight': [4, 3072],
      'diffusion_model.transformer_blocks.0.txt_mlp.net.0.proj.lora_A.weight': [4, 3072],
      'diffusion_model.transformer_blocks.0.img_mod.1.lora_A.weight': [4, 3072],
    }))).toBe('qwenimage')
  })

  it('files an attention-only Qwen-Image 1.x LoRA in ComfyUI keys as qwenimage', () => {
    expect(classifyLoraHeader(hs({
      'diffusion_model.transformer_blocks.0.attn.add_q_proj.lora_A.weight': [16, 3072],
      'diffusion_model.transformer_blocks.0.attn.to_q.lora_A.weight': [16, 3072],
    }))).toBe('qwenimage')
  })

  it('keeps LTX on attn1/attn2, even at the same 4096 width', () => {
    expect(classifyLoraHeader(hs({
      'diffusion_model.transformer_blocks.0.attn1.to_q.lora_A.weight': [32, 4096],
      'diffusion_model.transformer_blocks.0.ff.net.0.proj.lora_A.weight': [32, 4096],
    }))).toBe('ltx')
  })

  it('does not claim a diffusers Flux LoRA, which also spells attn.to_q', () => {
    expect(classifyLoraHeader(hs({
      'transformer.transformer_blocks.0.attn.to_q.lora_A.weight': [16, 3072],
      'transformer.transformer_blocks.0.attn.add_q_proj.lora_A.weight': [16, 3072],
      'transformer.single_transformer_blocks.0.attn.to_q.lora_A.weight': [16, 3072],
    }))).toBeNull()
  })

  it('leaves an attention-only Qwen-style LoRA of unknown width unrecognised', () => {
    expect(classifyLoraHeader(h(['transformer.transformer_blocks.0.attn.to_q.lora_A.weight']))).toBeNull()
  })

  it('still finds Krea2 first — its diffusers LoRAs share the transformer. prefix', () => {
    expect(classifyLoraHeader(hs({
      'transformer.text_fusion.projector.lora_A.weight': [1, 12],
      'transformer.transformer_blocks.0.attn.to_q.lora_A.weight': [16, 4096],
    }))).toBe('krea2')
  })

  it('hides Qwen-Image 1.x LoRAs from the Qwen 2.1 and LTX pickers', () => {
    const families = { 'a.safetensors': 'qwen21', 'b.safetensors': 'qwenimage', 'c.safetensors': 'ltx' } as const
    const names = Object.keys(families)
    expect(visibleForFamily(names, families, 'qwen21')).toEqual(['a.safetensors'])
    expect(visibleForFamily(names, families, 'ltx')).toEqual(['c.safetensors'])
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

describe('classifyBaseHeader - checkpoints and diffusion models', () => {
  // Every key set below is the head of a real file's header in the reference
  // install, read with `struct.unpack('<Q', f.read(8))` + json.loads.
  it('identifies an SDXL checkpoint by its two text encoders', () => {
    // waiMatureIllustrious_v30 (a user import) and aria_illu share this shape;
    // the import is the case that motivated all of this - it was invisible in
    // the Model dropdown because its *filename* carried no Patreon token.
    expect(classifyBaseHeader(h([
      'conditioner.embedders.0.transformer.text_model.embeddings.token_embedding.weight',
      'first_stage_model.decoder.conv_in.bias',
      'model.diffusion_model.input_blocks.0.0.weight',
    ]))).toBe('sdxl')
  })

  it('identifies SD1.5 by its single encoder in the same slot', () => {
    expect(classifyBaseHeader(h([
      'cond_stage_model.transformer.text_model.embeddings.token_embedding.weight',
      'first_stage_model.decoder.conv_in.bias',
    ]))).toBe('sd15')
  })

  it('identifies the LTX 2.3 checkpoint by its audio branch', () => {
    // Lives in checkpoints/ next to the SDXL models, so this is what keeps a
    // 29 GB video model out of the image pickers.
    expect(classifyBaseHeader(h([
      'model.diffusion_model.transformer_blocks.10.attn1.to_k.weight_scale',
      'vocoder.vocoder.conv_pre.bias',
      'audio_vae.decoder.conv_in.weight',
    ]))).toBe('ltx')
  })

  it('splits Krea2 from H3, which share the bare blocks.N. naming', () => {
    expect(classifyBaseHeader(h([
      'blocks.0.attn.wk.weight_scale',
      'txtfusion.layerwise_blocks.0.weight',
    ]))).toBe('krea2')
    expect(classifyBaseHeader(h([
      'adaln_t_table',
      'audio_patch_proj.weight',
      'blocks.0.attn_qkv_proj.weight',
    ]))).toBe('h3')
  })

  it('identifies Z-Image with and without ComfyUI\'s ModelSave prefix', () => {
    expect(classifyBaseHeader(h(['cap_embedder.0.weight', 'layers.0.attention.qkv.weight']))).toBe('zimage')
    expect(classifyBaseHeader(h([
      'model.diffusion_model.cap_embedder.0.weight',
      'model.diffusion_model.layers.0.attention.qkv.weight',
    ]))).toBe('zimage')
  })

  it('identifies Anima in both of its key layouts', () => {
    expect(classifyBaseHeader(h([
      'net.blocks.0.adaln_modulation_cross_attn.1.weight',
      'net.llm_adapter.0.weight',
    ]))).toBe('anima')
    // anima-turbo-v1.0 is a ComfyUI re-save: no `net.` wrapper, so it lands on
    // the bare `blocks.N.` naming Krea2 and H3 also use. It read as unrecognised
    // (and so showed in every family's picker) until the adaLN pattern went in.
    expect(classifyBaseHeader(h([
      'model.diffusion_model.blocks.0.adaln_modulation_cross_attn.1.weight',
      'model.diffusion_model.blocks.0.attention.wq.weight',
    ]))).toBe('anima')
  })

  it('identifies the Qwen-Image 2.1 diffusion model and splits it from Qwen-Image 1.x', () => {
    // verified: qwen_image_2.1_int8_convrot (txt_in.text_norm is the key
    // ComfyUI's own model_detection keys 2.1 on).
    expect(classifyBaseHeader(h([
      'img_in.weight',
      'txt_in.text_norm.weight',
      'transformer_blocks.0.img_mlp.gate_up.weight',
    ]))).toBe('qwen21')
    expect(classifyBaseHeader(h(['model.diffusion_model.txt_in.text_norm.weight']))).toBe('qwen21')
    expect(classifyBaseHeader(h([
      'txt_norm.weight',
      'transformer_blocks.0.img_mod.1.weight',
      'transformer_blocks.0.txt_mlp.net.0.proj.weight',
    ]))).toBe('qwenimage')
  })

  it('falls back to metadata, then to null for an unknown architecture', () => {
    const meta = { __metadata__: { 'modelspec.architecture': 'stable-diffusion-xl-v1-base/lora' } }
    expect(classifyBaseHeader({ ...h(['some.unknown.weight']), ...meta })).toBe('sdxl')
    expect(classifyBaseHeader(h(['some.unknown.weight']))).toBeNull()
  })
})

describe('visibleForFamily', () => {
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
    expect(visibleForFamily(names, families, 'zimage')).toEqual(['ZIT_muscgi_1.safetensors'])
    expect(visibleForFamily(names, families, 'anima')).toEqual(['ANIMA_muscgi_2.safetensors'])
    expect(visibleForFamily(names, families, 'ltx')).toEqual(['LTX2.3_DMD_reshaped_r256.safetensors'])
  })

  it('keeps the video LoRA out of the image pickers', () => {
    // The bug that motivated this: an LTX video LoRA was offered for image gen.
    expect(visibleForFamily(names, families, 'sdxl')).toEqual([])
  })

  it('shows everything when the workflow declares no family', () => {
    expect(visibleForFamily(names, families, undefined)).toEqual(names)
  })

  it('keeps unrecognised LoRAs visible for every family', () => {
    const withUnknown = [...names, 'mystery.safetensors']
    const map = { ...families, 'mystery.safetensors': null }
    expect(visibleForFamily(withUnknown, map, 'sdxl')).toEqual(['mystery.safetensors'])
    // Missing from the map entirely (e.g. API failed) behaves the same way.
    expect(visibleForFamily(withUnknown, families, 'sdxl')).toEqual(['mystery.safetensors'])
  })

  it('shows every LoRA when the arch API returned nothing', () => {
    expect(visibleForFamily(names, {}, 'zimage')).toEqual(names)
  })

  it('matches ComfyUI subfolder names that use OS separators', () => {
    expect(visibleForFamily(['style\ZIT_muscgi_1.safetensors'], { 'style/ZIT_muscgi_1.safetensors': 'zimage' }, 'zimage'))
      .toEqual(['style\ZIT_muscgi_1.safetensors'])
  })

  it('never drops the current selection', () => {
    expect(visibleForFamily(names, families, 'zimage', 'ANIMA_muscgi_2.safetensors'))
      .toEqual(['ANIMA_muscgi_2.safetensors', 'ZIT_muscgi_1.safetensors'])
  })
})
