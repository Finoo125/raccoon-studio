// app/src/lib/models/starter.ts
/**
 * The first-start setup's model list: what each model is for in plain words,
 * which version a computer gets, and what that costs to download, so "does
 * this fit my card?" has one answer. Read by /setup, DownloadModelButton,
 * GenerationForm (PRESET_ORDER, starterFor) and video-form-context
 * (videoFilesFor, videoStarterFor). The start page does not read it: its
 * redirect asks `modelsOnDisk` (on-disk.ts). Spec: 2026-10-11-first-start-setup-design.md.
 *
 * ponytail: every model has only its full version until plan 2's GGUF test
 * lands the compact ones — `versions` is already a list so they slot in.
 * Thresholds are estimates from file sizes, not measurements.
 */
import type { Hardware } from '@/lib/hardware'
import type { H3CheckpointId } from '@/types/video-workflow'
import { H3_EROS, H3_HYBRID, H3_SPARSEREF, H3_REF2VA_CKPT, H3_REALISM_LORA } from '@/lib/workflows/minimax-h3'
import { QWEN21_BFS_LORAS, qwen21BfsUrl } from '@/lib/workflows/qwen21'
import { IMAGE_PRESETS } from './image-presets'
import { LTX23_ASSETS, type ModelAsset } from './ltx23-assets'
import { MINIMAX_H3_ASSETS } from './minimax-h3-assets'

/** 'edit' is Simple Models only: the setup lists photo, anime and video. */
export type StarterGroup = 'photo' | 'anime' | 'video' | 'edit'
export interface StarterFile { name: string; folder: string; url: string; sizeMb: number; optional?: boolean }
export interface StarterVersion {
  /** Smallest graphics memory this version is offered on, in GB. */
  minVramGb: number
  /** GGUF quant ("Q5") for a compact version; absent on the full one. */
  quant?: string
  files: StarterFile[]
}
export interface StarterModel {
  id: string
  group: StarterGroup
  name: string
  blurb: string
  /** Best first: the first one whose minVramGb fits the card is offered. */
  versions: StarterVersion[]
  minRamGb?: number
  /** One per group: recommended while graphics memory is ≥ fromGb (and < belowGb). */
  recommend?: { fromGb: number; belowGb?: number }
  /** Filled into Generate Image by "Make my first picture". */
  samplePrompt?: string
  opens: { page: 'image'; preset: string } | { page: 'video'; workflow: 'minimax-h3' | 'ltx23'; h3Checkpoint?: 'hybrid' | 'eros' }
}
export interface CommunityRow { id: string; group: 'photo' | 'anime'; name: string; blurb: string }

export const CIVITAI_URL = 'https://civitai.com/models?types=Checkpoint'
export const NO_HARDWARE: Hardware = { gpuName: null, vramGb: null, ramGb: null, freeDiskGb: null }

/** Driver figures run a little under the label: an "8 GB" card reads 7.99, a 32 GB machine with an iGPU ~30.9. */
const VRAM_SLACK = 0.5
const RAM_SLACK = 3

const fromPreset = (id: string): StarterFile[] => {
  const p = IMAGE_PRESETS.find((x) => x.id === id)
  if (!p) throw new Error(`starter: no image preset "${id}"`)
  return p.files.map((f) => ({ name: f.name, folder: f.path, url: f.url, sizeMb: f.sizeMb, optional: f.optional }))
}
// `names` IS the required set: the catalog's `optional` is relative to stock H3, where the Hybrid
// and 10Eros checkpoints are extras — carried over, each model's own checkpoint would read optional.
const fromAssets = (assets: ModelAsset[], names: string[]): StarterFile[] =>
  names.map((n) => {
    const a = assets.find((x) => x.name === n)
    if (!a?.url) throw new Error(`starter: no downloadable asset "${n}"`)
    return { name: a.name, folder: a.folder, url: a.url, sizeMb: a.sizeMb }
  })

/** The stock H3 checkpoint — the bundled graph's own (test-guarded against MinimaxH3.json). */
export const H3_STOCK_CKPT = 'minimax_h3_fl2va_pruned_int8_convrot.safetensors'
/** Text encoder, video VAE and audio VAE — every H3 checkpoint needs all three. */
const H3_SHARED = [
  'qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors',
  'minimax_h3_video_vae_fp16.safetensors',
  'minimax_h3_audio_vae_fp32.safetensors',
]
/**
 * The realism adapter rides along with every H3 package (optional, so a model without it still reads installed):
 * the form turns it on by default once it is on disk, and the 2026-10-14 skin test made it the one lever against
 * oily, plastic H3 skin.
 */
const H3_REALISM_FILE: StarterFile = { ...fromAssets(MINIMAX_H3_ASSETS, [H3_REALISM_LORA])[0], optional: true }
/** What LTX 2.3 cannot render without; FaceID, the IC-LoRAs and the style LoRA are optional. */
const LTX_REQUIRED = [
  'ltx2310eros1.4.safetensors',
  'gemma-3-12b-it-ablit-norms-biproj-fp8mixed.safetensors',
  'LTX2.3_DMD_reshaped_r256.safetensors',
  'VBVR-I2V-390K-R32.safetensors',
  'ltx-2.3-spatial-upscaler-x2-1.1.safetensors',
  'taeltx2_3.safetensors',
]

const PHOTO_PROMPT = 'a cosy cabin in a snowy forest at dusk, warm light in the windows'
const ANIME_PROMPT = '1girl, sitting by the window of a cosy cabin, snowy forest, dusk, warm light, scarf, smile'

// ponytail: Krea2 + Z-Image offered from 12 GB on the owner's call (2026-10-11). The full
// models finished on a SIMULATED 8 GB card with DynamicVRAM off (first-start spec, GGUF
// appendix); no real 12 GB card has run them, so they are not recommended below 16.
export const STARTER_MODELS: StarterModel[] = [
  { id: 'krea2-turbo', group: 'photo', name: 'Krea2 Turbo', blurb: 'Realistic pictures in seconds. The everyday all-rounder.',
    versions: [{ minVramGb: 12, files: fromPreset('krea2-turbo') }], recommend: { fromGb: 16 },
    samplePrompt: PHOTO_PROMPT, opens: { page: 'image', preset: 'krea2-turbo' } },
  { id: 'krea2-raw', group: 'photo', name: 'Krea2 RAW', blurb: 'Same look as Krea2 Turbo, slower, with the finest detail.',
    versions: [{ minVramGb: 12, files: fromPreset('krea2-raw') }],
    samplePrompt: PHOTO_PROMPT, opens: { page: 'image', preset: 'krea2-raw' } },
  { id: 'z-image-turbo', group: 'photo', name: 'Z-Image Turbo', blurb: 'Very fast, crisp photos. Works best with short descriptions.',
    versions: [{ minVramGb: 12, files: fromPreset('z-image-turbo') }],
    samplePrompt: PHOTO_PROMPT, opens: { page: 'image', preset: 'z-image-turbo' } },
  { id: 'ernie-turbo', group: 'photo', name: 'Ernie Image Turbo', blurb: 'Fast pictures; good with text, posters and comic layouts.',
    versions: [{ minVramGb: 16, files: fromPreset('ernie-turbo') }],
    samplePrompt: PHOTO_PROMPT, opens: { page: 'image', preset: 'ernie-turbo' } },
  { id: 'anima-turbo', group: 'anime', name: 'Anima Turbo', blurb: 'Anime and illustration in seconds. Small download.',
    versions: [{ minVramGb: 6, files: fromPreset('anima-turbo') }], recommend: { fromGb: 0 },
    samplePrompt: ANIME_PROMPT, opens: { page: 'image', preset: 'anima-turbo' } },
  { id: 'anima', group: 'anime', name: 'Anima', blurb: 'Same anime look with more detail, a bit slower.',
    versions: [{ minVramGb: 6, files: fromPreset('anima') }],
    samplePrompt: ANIME_PROMPT, opens: { page: 'image', preset: 'anima' } },
  { id: 'h3-hybrid', group: 'video', name: 'MiniMax H3 Hybrid', blurb: 'Video with sound. The steadiest motion and the richest stereo.',
    versions: [{ minVramGb: 24, files: [...fromAssets(MINIMAX_H3_ASSETS, [H3_HYBRID.ckpt, ...H3_SHARED]), H3_REALISM_FILE] }],
    minRamGb: 32, recommend: { fromGb: 24 }, opens: { page: 'video', workflow: 'minimax-h3', h3Checkpoint: 'hybrid' } },
  { id: 'h3-eros', group: 'video', name: 'MiniMax H3 10Eros Max', blurb: 'Video with sound, uncensored, and about a quarter faster than Hybrid.',
    versions: [{ minVramGb: 24, files: [...fromAssets(MINIMAX_H3_ASSETS, [H3_EROS.ckpt, ...H3_SHARED]), H3_REALISM_FILE] }],
    minRamGb: 32, opens: { page: 'video', workflow: 'minimax-h3', h3Checkpoint: 'eros' } },
  { id: 'ltx23', group: 'video', name: 'LTX 2.3', blurb: 'Video with sound from another model family, with its own look. Also runs on 16 GB cards.',
    versions: [{ minVramGb: 16, files: fromAssets(LTX23_ASSETS, LTX_REQUIRED) }],
    minRamGb: 32, opens: { page: 'video', workflow: 'ltx23' } },
  // ponytail: 16 GB is an estimate from the files (6.9 GB model + 8.9 GB encoder), never run on a smaller card.
  { id: 'qwen21-edit', group: 'edit', name: 'Qwen-Image 2.1 Edit',
    blurb: 'Changes a picture you give it: new clothes, a character sheet, a head swap. Experimental; research use only.',
    versions: [{ minVramGb: 16, files: [
      ...fromPreset('qwen21-turbo'),
      { name: QWEN21_BFS_LORAS.alternative, folder: 'loras', url: qwen21BfsUrl('alternative'), sizeMb: 304, optional: true },
    ] }],
    opens: { page: 'image', preset: 'qwen21-edit' } },
]

export const COMMUNITY_ROWS: CommunityRow[] = [
  { id: 'sdxl-photo', group: 'photo', name: 'SDXL — realistic finished models',
    blurb: "Thousands of realistic SDXL models made by the community. The plain SDXL base isn't good on its own, so we don't download it: get a finished one, then add it here." },
  { id: 'sdxl-anime', group: 'anime', name: 'Pony & Illustrious — finished models',
    blurb: "The biggest anime collections, made by the community. The plain bases aren't good on their own: get a finished one from Civitai or the Aria lineup on the Raccoon Portal, then add it here." },
]

export const fmtGb = (mb: number) => (mb / 1000).toFixed(1)

/** The version this computer gets: the best whose minimum fits. Unknown graphics memory → none (the setup asks first). */
export function versionFor(m: StarterModel, hw: Hardware): StarterVersion | null {
  if (hw.vramGb === null) return null
  const vram = hw.vramGb
  return m.versions.find((v) => vram + VRAM_SLACK >= v.minVramGb) ?? null
}

/** Why a model is not offered here, as the row says it; null when it fits (or when we cannot tell yet). */
export function whyNot(m: StarterModel, hw: Hardware): string | null {
  if (hw.vramGb === null) return null
  if (!versionFor(m, hw)) {
    const need = Math.min(...m.versions.map((v) => v.minVramGb))
    return `Needs ${need} GB of graphics memory — yours has ${Math.round(hw.vramGb)}.`
  }
  if (m.minRamGb && hw.ramGb !== null && hw.ramGb + RAM_SLACK < m.minRamGb) {
    return `Needs ${m.minRamGb} GB of RAM — yours has ${Math.round(hw.ramGb)}.`
  }
  return null
}

/** The one model a group recommends for this computer, or none. */
export function recommendedFor(group: StarterGroup, hw: Hardware): StarterModel | null {
  if (hw.vramGb === null) return null
  const vram = hw.vramGb + VRAM_SLACK
  return STARTER_MODELS.find((m) => m.group === group && m.recommend && vram >= m.recommend.fromGb &&
    (m.recommend.belowGb === undefined || vram < m.recommend.belowGb) && !whyNot(m, hw)) ?? null
}

/** Every REQUIRED file of one version is on disk — a missing optional extra never makes a model look half-installed. */
export function isInstalled(m: StarterModel, onDisk: Set<string>): boolean {
  return m.versions.some((v) => v.files.every((f) => f.optional || onDisk.has(f.name)))
}

/** Megabytes of this model's files that are on disk (Simple Models' "on disk"). */
export function versionOnDiskMb(m: StarterModel, onDisk: Set<string>): number {
  const seen = new Set<string>()
  let mb = 0
  for (const v of m.versions) for (const f of v.files) {
    if (onDisk.has(f.name) && !seen.has(f.name)) { seen.add(f.name); mb += f.sizeMb }
  }
  return mb
}

/**
 * The files Remove deletes: this model's files on disk, minus any file another
 * installed model or preset still uses (Krea2 and Anima share qwen_image_vae;
 * H3 Hybrid and 10Eros share the text encoder and both VAEs), and minus `keep`
 * (Krea2's text encoder while it is a supporter's built-in Help me write writer).
 */
export function removalPlan(m: StarterModel, onDisk: Set<string>, keep: readonly string[] = []): StarterFile[] {
  const others = [
    ...STARTER_MODELS.filter((o) => o.id !== m.id && isInstalled(o, onDisk)).flatMap((o) => o.versions.flatMap((v) => v.files)),
    // presets outside the starter table (SDXL family, Qwen) count as installed when their main file is there —
    // unless that file is this model's own (Advanced's Qwen Turbo preset is Qwen Edit's model)
    ...IMAGE_PRESETS.filter((p) => !STARTER_MODELS.some((s) => s.opens.page === 'image' && s.opens.preset === p.id) && onDisk.has(p.files[0].name)
      && !m.versions.some((v) => v.files.some((f) => f.name === p.files[0].name)))
      .flatMap((p) => p.files),
    // stock H3 (and ref2va, which reference mode loads) is no starter model but needs the same encoder and VAEs,
    // and its form uses the realism adapter the H3 packages bring along
    ...([H3_STOCK_CKPT, H3_REF2VA_CKPT].some((c) => onDisk.has(c)) ? [...H3_SHARED, H3_REALISM_LORA].map((name) => ({ name })) : []),
  ]
  const needed = new Set([...others.map((f) => f.name), ...keep])
  const out: StarterFile[] = []
  for (const v of m.versions) for (const f of v.files) {
    if (onDisk.has(f.name) && !needed.has(f.name) && !out.some((x) => x.name === f.name)) out.push(f)
  }
  return out
}

/** The files still to fetch for these versions — a file two models share is fetched once. */
export function downloadPlan(versions: StarterVersion[], onDisk: Set<string>): { files: StarterFile[]; totalMb: number } {
  const files: StarterFile[] = []
  for (const v of versions) for (const f of v.files) {
    if (!onDisk.has(f.name) && !files.some((x) => x.folder === f.folder && x.name === f.name)) files.push(f)
  }
  return { files, totalMb: files.reduce((n, f) => n + f.sizeMb, 0) }
}

/** The ticks the setup opens with: the recommended photo and anime models not yet installed. Never video (42 GB+). */
export function defaultPicks(hw: Hardware, onDisk: Set<string>): string[] {
  return (['photo', 'anime'] as const)
    .map((g) => recommendedFor(g, hw))
    .filter((m): m is StarterModel => !!m && !isInstalled(m, onDisk))
    .map((m) => m.id)
}

/** The starter model behind a Generate Image preset; none for presets the table does not offer (SDXL family, Qwen Turbo/base). */
export function starterFor(presetId: string): StarterModel | null {
  return STARTER_MODELS.find((m) => m.opens.page === 'image' && m.opens.preset === presetId) ?? null
}

/** The files a Generate Video pick cannot render without. Director runs the LTX graph. */
export function videoFilesFor(workflowId: string, h3Checkpoint?: H3CheckpointId, mode?: string): string[] {
  if (workflowId !== 'minimax-h3') return LTX_REQUIRED
  if (h3Checkpoint === 'sparseref') return [H3_SPARSEREF.ckpt, ...H3_SHARED, H3_SPARSEREF.lora.name]
  const ckpt = h3Checkpoint === 'eros' ? H3_EROS.ckpt
    : h3Checkpoint === 'hybrid' ? H3_HYBRID.ckpt
    // Edit runs on reference conditioning, so it loads ref2va too (minimax-h3.ts).
    : mode === 'ref2v' || mode === 'edit' ? H3_REF2VA_CKPT : H3_STOCK_CKPT
  return [ckpt, ...H3_SHARED]
}

/** The starter model a Generate Video pick downloads; none for stock H3 or SparseRef15, which the setup does not offer. */
export function videoStarterFor(workflowId: string, h3Checkpoint?: H3CheckpointId): StarterModel | null {
  const id = workflowId !== 'minimax-h3' ? 'ltx23' : h3Checkpoint === 'eros' ? 'h3-eros' : h3Checkpoint === 'hybrid' ? 'h3-hybrid' : ''
  return STARTER_MODELS.find((m) => m.id === id) ?? null
}
