/**
 * Which base-model family a LoRA was trained for, read out of the file itself.
 *
 * Filenames are worthless for this: a Civitai download lands as
 * `detailed_skin_v3.safetensors` with no hint of its base model, and users
 * rename files freely. Every `.safetensors` instead opens with
 * `[8-byte LE u64 header length][that many bytes of JSON]`, and that JSON is a
 * complete tensor index (name → shape/dtype) plus whatever `__metadata__` the
 * trainer chose to write. Reading it costs one `fs.read` of a few hundred KB —
 * the multi-hundred-MB weight blob behind it is never touched.
 *
 * ⚠️ Tensor keys first, metadata second — metadata lies. `ANIMA_muscgi_2` in
 * the reference install declares `modelspec.architecture = stable-diffusion-v1/lora`,
 * a leftover default from the sd-scripts fork it was trained with; trusting it
 * would file an Anima LoRA under SD1.5 and hide it from the model it belongs to.
 * (Its `ss_base_model_version = anima` is right, but only the tensor layout is
 * structurally incapable of being wrong: it *is* the weights.) The LTX LoRA
 * carries no metadata at all. So metadata only ever answers what the key rules
 * couldn't.
 *
 * ── Extending this to new models ────────────────────────────────────────────
 * This table is deliberately small and grows one row at a time as families are
 * added to the app. To add a model family:
 *   1. Put one of its LoRAs in `models/loras/`.
 *   2. Dump the header — the first few tensor names are enough:
 *      `node -e "const f=require('fs').openSync(process.argv[1]);const l=Buffer.alloc(8);
 *       require('fs').readSync(f,l,0,8,0);const n=Number(l.readBigUInt64LE(0));
 *       const b=Buffer.alloc(n);require('fs').readSync(f,b,0,n,8);
 *       console.log(Object.keys(JSON.parse(b)).slice(0,8))" <file>`
 *   3. Add a row to KEY_RULES with the distinguishing prefix, and a case to the
 *      test file. Add the family to `LoraFamily` and set `loraFamily` on the
 *      workflow definition.
 * Anything unrecognised returns null and stays visible everywhere — an unknown
 * LoRA is shown, never hidden, so a family we haven't fingerprinted yet degrades
 * to today's behaviour instead of vanishing from the picker.
 */

import fs from 'fs'
import type { LoraFamily } from './lora-family'

// Server-only: this module reads files. The `LoraFamily` type and the picker's
// filter live in `lora-family.ts` so components can import them without pulling
// `fs` into the browser bundle.
export type { LoraFamily }

interface TensorInfo {
  dtype?: string
  shape?: number[]
}

export interface SafetensorsHeader {
  __metadata__?: Record<string, string>
  [tensor: string]: TensorInfo | Record<string, string> | undefined
}

/** Headers run ~60 KB–700 KB in practice; anything past this is corrupt or hostile. */
const MAX_HEADER_BYTES = 32 * 1024 * 1024

/**
 * Tensor-name prefixes that identify an architecture. Verified against real
 * files where noted; the rest follow the published key layout for that format.
 * Prefixes are disjoint, so rule order is documentation rather than precedence —
 * except that `lora_unet_blocks_` (Anima) is NOT a prefix of
 * `lora_unet_input_blocks_` (SDXL), which is why both can be matched with a
 * plain startsWith.
 */
const KEY_RULES: { family: LoraFamily; prefixes: string[] }[] = [
  // verified: LTX2.3_DMD_reshaped_r256.safetensors
  { family: 'ltx', prefixes: ['diffusion_model.transformer_blocks.', 'diffusion_model.audio_'] },
  // verified: ZIT_muscgi_1.safetensors (dim 3840)
  { family: 'zimage', prefixes: ['diffusion_model.layers.'] },
  // verified: ANIMA_muscgi_2.safetensors (DiT adaLN blocks, dim 2048)
  { family: 'anima', prefixes: ['lora_unet_blocks_'] },
  { family: 'flux', prefixes: ['diffusion_model.double_blocks.', 'diffusion_model.single_blocks.', 'lora_unet_double_blocks_', 'lora_unet_single_blocks_'] },
  // ponytail: no Ernie LoRA on hand to fingerprint — Ernie is caught by the
  // metadata fallback below, or falls through to null (shown everywhere). Add a
  // prefix row here the first time one turns up.
]

/** Both SDXL and SD1.5 use these; they're split by context dim further down. */
const UNET_BLOCK_PREFIXES = [
  'lora_unet_input_blocks_', 'lora_unet_middle_block_', 'lora_unet_output_blocks_',
  // diffusers-native naming, also in circulation
  'lora_unet_down_blocks_', 'lora_unet_mid_block_', 'lora_unet_up_blocks_',
]

/**
 * Metadata fallback, consulted only when the tensor keys didn't resolve. Read
 * the warning at the top before extending this: these strings are whatever the
 * trainer felt like writing.
 */
const META_RULES: { family: LoraFamily; needles: string[] }[] = [
  { family: 'zimage', needles: ['zimage', 'z-image'] },
  { family: 'anima', needles: ['anima'] },
  { family: 'ernie', needles: ['ernie'] },
  { family: 'ltx', needles: ['ltx'] },
  { family: 'flux', needles: ['flux'] },
  { family: 'sdxl', needles: ['sdxl', 'stable-diffusion-xl'] },
]

/** Metadata fields worth trusting as a hint. Deliberately NOT the whole blob —
 *  `ss_datasets` embeds user tag names, so a dataset tagged "flux" would poison
 *  a naive full-text scan. */
const META_FIELDS = ['ss_base_model_version', 'modelspec.architecture', 'ss_sd_model_name', 'ss_network_module']

function tensorNames(header: SafetensorsHeader): string[] {
  return Object.keys(header).filter((k) => k !== '__metadata__')
}

/** SDXL and SD1.5 share the UNet block naming; the cross-attention context dim
 *  (2048 vs 768) separates them, and SDXL's second text encoder is a shortcut
 *  when the LoRA carries text-encoder weights at all. */
function splitUnetFamily(header: SafetensorsHeader, names: string[]): LoraFamily {
  if (names.some((k) => k.startsWith('lora_te2_'))) return 'sdxl'
  const crossAttn = names.find((k) => /attn2_to_k\.lora_down\.weight$/.test(k))
  const contextDim = crossAttn ? (header[crossAttn] as TensorInfo)?.shape?.[1] : undefined
  if (contextDim === 768) return 'sd15'
  // 2048 → SDXL; unknown → SDXL too, which is the overwhelmingly common UNet-only
  // case and errs toward showing the LoRA rather than hiding it.
  return 'sdxl'
}

/** Classify an already-parsed safetensors header. Null = unrecognised. */
export function classifyLoraHeader(header: SafetensorsHeader | null): LoraFamily | null {
  if (!header) return null
  const names = tensorNames(header)

  for (const rule of KEY_RULES) {
    if (names.some((k) => rule.prefixes.some((p) => k.startsWith(p)))) return rule.family
  }
  if (names.some((k) => UNET_BLOCK_PREFIXES.some((p) => k.startsWith(p)))) {
    return splitUnetFamily(header, names)
  }

  const meta = header.__metadata__
  if (meta) {
    const hint = META_FIELDS.map((f) => meta[f] ?? '').join(' ').toLowerCase()
    for (const rule of META_RULES) {
      if (rule.needles.some((n) => hint.includes(n))) return rule.family
    }
  }
  return null
}

/**
 * Read and parse a safetensors header. Returns null for anything that isn't a
 * readable safetensors file — a truncated download, a `.ckpt` pickle, or a
 * corrupt header claiming a preposterous length.
 */
export function readSafetensorsHeader(file: string): SafetensorsHeader | null {
  let fd: number | undefined
  try {
    const size = fs.statSync(file).size
    if (size < 8) return null
    fd = fs.openSync(file, 'r')

    const lengthBytes = Buffer.alloc(8)
    if (fs.readSync(fd, lengthBytes, 0, 8, 0) !== 8) return null
    const headerBytes = Number(lengthBytes.readBigUInt64LE(0))
    if (!headerBytes || headerBytes > MAX_HEADER_BYTES || headerBytes + 8 > size) return null

    const json = Buffer.alloc(headerBytes)
    if (fs.readSync(fd, json, 0, headerBytes, 8) !== headerBytes) return null

    const parsed: unknown = JSON.parse(json.toString('utf8'))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    return parsed as SafetensorsHeader
  } catch {
    return null
  } finally {
    if (fd !== undefined) {
      try { fs.closeSync(fd) } catch { /* already gone */ }
    }
  }
}

/** Convenience: read a LoRA file and classify it. Null = unrecognised (show it). */
export function classifyLoraFile(file: string): LoraFamily | null {
  return classifyLoraHeader(readSafetensorsHeader(file))
}
