'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import {
  CheckCircle, Download, AlertCircle, Package, ChevronRight, FolderInput, X,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import { LTX23_ASSETS, assetInstalled, type ModelAsset } from '@/lib/models/ltx23-assets'
import { MINIMAX_H3_ASSETS } from '@/lib/models/minimax-h3-assets'
import { comboOptions } from '@/lib/models/installed'
import { restartComfyUI } from '@/lib/comfyui/restart'
import { createTransferTracker } from '@/lib/models/transfer-tracker'
import ImportPanel from '@/components/models/ImportPanel'
import dynamic from 'next/dynamic'
import Link from 'next/link'
const MyModelsTab = dynamic(() => import('@/components/models/MyModelsTab'))
// Type-only: lib/models/transfers.ts is server code (fs, https) and this import
// is erased at build, so none of it reaches the browser bundle.
import type { Transfer } from '@/lib/models/transfers'
import { KREA2_KROMA_LORA } from '@/lib/workflows/krea2'
import { QWEN21_FUN_MODEL } from '@/lib/workflows/zimage-controlnet'
import { QWEN21_PE_T2I, QWEN21_BFS_LORAS, qwen21BfsUrl } from '@/lib/workflows/qwen21'
import { presetNameById } from '@/lib/workflows/preset-families'
import { IMAGE_PRESETS, type PresetDefinition } from '@/lib/models/image-presets'
import { rowSummary } from '@/lib/models/catalog-summary'
import { useUiMode } from '@/lib/ui-mode'
import SimpleAdvancedSwitch from '@/components/SimpleAdvancedSwitch'
import { GuideChip } from '@/components/GuideLink'
import SimpleModels from '@/components/models/SimpleModels'

// ─── Types ────────────────────────────────────────────────────────────────────


interface DownloadState {
  status: 'idle' | 'checking' | 'missing' | 'present' | 'downloading' | 'done' | 'error'
  progress: number
  /** Bytes received / total — total is 0 when the server sent no content-length. */
  received?: number
  total?: number
  error?: string
}

// ─── Data ─────────────────────────────────────────────────────────────────────


// Synthetic preset so the LTX section can reuse the page's download flow + state
// map (keyed `ltx23::<filename>`) without a real PRESETS entry.
// Same rule as the H3 preset below: `id` must match the state-key prefix the
// status probe writes, or every row sits at "idle" while the download reports
// progress under a key nothing is reading.
const LTX_PRESET: PresetDefinition = {
  id: 'ltx23',
  name: 'LTX 2.3 (Video)',
  description: 'Models for the Generate Videos workflow',
  files: [],
}

// `id` must match the state-key prefix the H3 status probe writes, or every row
// stays stuck at "idle" while the download reports progress under another key.
const MINIMAX_H3_PRESET: PresetDefinition = {
  id: 'minimax-h3',
  name: 'MiniMax H3 (Video)',
  description: 'Models for the MiniMax H3 video workflow',
  files: [],
}

interface DetailerAsset {
  name: string
  path: string
  url: string
  sizeMb: number
  nodeClass: string
  fieldName: string
}

const DETAILER_ASSETS: DetailerAsset[] = [
  {
    name: 'face_yolov8m.pt',
    path: 'ultralytics/bbox',
    url: 'https://huggingface.co/Bingsu/adetailer/resolve/main/face_yolov8m.pt',
    sizeMb: 25,
    nodeClass: 'UltralyticsDetectorProvider',
    fieldName: 'model_name',
  },
  {
    name: 'sam_vit_b_01ec64.pth',
    path: 'sams',
    url: 'https://dl.fbaipublicfiles.com/segment_anything/sam_vit_b_01ec64.pth',
    sizeMb: 375,
    nodeClass: 'SAMLoader',
    fieldName: 'model_name',
  },
]

const DETAILER_PRESET: PresetDefinition = {
  id: 'detailer',
  name: 'Face Detailer',
  description: 'Models for the Face Detailer stage (requires ComfyUI Impact Pack)',
  files: [],
}

// Face-swap models beyond what the ReActor installer fetches itself: the
// FaceFusion hyperswap swappers (256px, stronger identity than inswapper —
// 1c generally the best) and the GPEN-BFR-1024 restorer the swap chain uses
// by default (face-swap.ts). Those are hosted on the same Gourieff/ReActor
// dataset ReActor's own installer downloads from; sizes verified against the
// live files 2026-07-17. Presence is detected via ReActorFaceSwap's own dropdowns.
//
// AlphaFace is the exception on both counts: it comes straight from FaceFusion's
// own asset releases (ReActor has never shipped it), and its presence is probed
// through RaccoonPixelBoostSwap instead — ReActor cannot load it at all, so a
// ReActorFaceSwap probe would report it missing forever. It also gets its own
// models dir for the reason spelled out in the vendored pack's `_MODEL_DIRS`.
const FACESWAP_ASSETS: DetailerAsset[] = [
  {
    name: 'GPEN-BFR-1024.onnx',
    path: 'facerestore_models',
    url: 'https://huggingface.co/datasets/Gourieff/ReActor/resolve/main/models/facerestore_models/GPEN-BFR-1024.onnx',
    sizeMb: 285,
    nodeClass: 'ReActorFaceSwap',
    fieldName: 'face_restore_model',
  },
  {
    name: 'hyperswap_1a_256.onnx',
    path: 'hyperswap',
    url: 'https://huggingface.co/datasets/Gourieff/ReActor/resolve/main/models/hyperswap_1a_256.onnx',
    sizeMb: 403,
    nodeClass: 'ReActorFaceSwap',
    fieldName: 'swap_model',
  },
  {
    name: 'hyperswap_1b_256.onnx',
    path: 'hyperswap',
    url: 'https://huggingface.co/datasets/Gourieff/ReActor/resolve/main/models/hyperswap_1b_256.onnx',
    sizeMb: 403,
    nodeClass: 'ReActorFaceSwap',
    fieldName: 'swap_model',
  },
  {
    name: 'hyperswap_1c_256.onnx',
    path: 'hyperswap',
    url: 'https://huggingface.co/datasets/Gourieff/ReActor/resolve/main/models/hyperswap_1c_256.onnx',
    sizeMb: 403,
    nodeClass: 'ReActorFaceSwap',
    fieldName: 'swap_model',
  },
  {
    name: 'alphaface_256.onnx',
    path: 'alphaface',
    url: 'https://github.com/facefusion/facefusion-assets/releases/download/models-3.9.0/alphaface_256.onnx',
    sizeMb: 530,
    nodeClass: 'RaccoonPixelBoostSwap',
    fieldName: 'swap_model',
  },
  // FaceFusion's occlusion segmenter, used only by the VIDEO swap: it decides
  // which pixels of an aligned face crop are really face, so a hand or a mic
  // stays in front of the swapped face instead of being painted over. It runs on
  // the 256px crop rather than the frame, which is what makes it affordable on
  // every frame of a clip.
  //
  // Presence is probed through `RaccoonVideoFaceSwap.occlusion`, which is a combo
  // of what is installed in `models/facefusion/` — the node exposes it that way
  // precisely so this catalog and the swap dialog can both read availability off
  // /object_info instead of needing a disk probe of their own.
  {
    name: 'xseg_1.onnx',
    path: 'facefusion',
    url: 'https://github.com/facefusion/facefusion-assets/releases/download/models-3.1.0/xseg_1.onnx',
    sizeMb: 67,
    nodeClass: 'RaccoonVideoFaceSwap',
    fieldName: 'occlusion',
  },
]

const FACESWAP_PRESET: PresetDefinition = {
  id: 'faceswap',
  name: 'Face Swap',
  description: 'Hyperswap + AlphaFace swap models, the GPEN-BFR-1024 face restorer, and the occlusion mask for video swaps',
  files: [],
}

// Krea2's official style LoRAs. Purely optional flavour — none is needed to
// generate — so they are individual rows rather than part of a preset, and each
// user grabs only the looks they want. Presence is detected through LoraLoader's
// own file list, the same node/field probe the detailer and face-swap assets use.
const KREA2_STYLE_LORAS: DetailerAsset[] = [
  'darkbrush', 'dotmatrix', 'kidsdrawing', 'neondrip', 'rainywindow',
  'retroanime', 'softwatercolor', 'sunsetblur', 'vintagetarot',
].map((style) => ({
  name: `krea2_${style}.safetensors`,
  path: 'loras',
  url: `https://huggingface.co/Comfy-Org/Krea-2/resolve/main/loras/krea2_${style}.safetensors`,
  sizeMb: 448,
  nodeClass: 'LoraLoader',
  fieldName: 'lora_name',
})).concat([
  {
    name: 'krea2_style_reference.safetensors',
    path: 'loras',
    url: 'https://huggingface.co/Comfy-Org/Krea-2/resolve/main/loras/krea2_style_reference.safetensors',
    sizeMb: 436,
    nodeClass: 'LoraLoader',
    fieldName: 'lora_name',
  },
])

const KREA2_STYLE_PRESET: PresetDefinition = {
  id: 'krea2-styles',
  name: 'Krea2 Style LoRAs',
  description: 'Optional looks for the Krea2 models',
  files: [],
}

// The Kroma uncensor fine-tune — the heavyweight alternative to the 27 MB
// refusal patch that ships inside both Krea2 presets. Its own opt-in row rather
// than part of a preset: 1.9 GB, and it changes how every image looks, so it is
// not something to hand someone who just wanted Krea2. Filename must match
// KREA2_KROMA_LORA in lib/workflows/krea2.ts — the Generate form asks ComfyUI
// for exactly that name. Upstream also publishes `-rl` and `-rl-mild` variants
// (3.8 / 2.8 GB) that the model card does not document; deliberately not listed.
const KREA2_NSFW_LORAS: DetailerAsset[] = [
  {
    name: KREA2_KROMA_LORA,
    path: 'loras',
    url: 'https://huggingface.co/lodestones/Kroma/resolve/main/kroma-v0.1.safetensors',
    sizeMb: 1883,
    nodeClass: 'LoraLoader',
    fieldName: 'lora_name',
  },
]

const KREA2_NSFW_PRESET: PresetDefinition = {
  id: 'krea2-nsfw',
  name: 'Krea2 NSFW',
  description: 'Optional uncensor model for the Krea2 models',
  files: [],
}

// Qwen-Image 2.1's optional extras. The enhancer is its own 9.5 GB model rather
// than the loaded text encoder, so it is a row of its own instead of part of the
// presets — most prompts do not need it. Filename shared with the builder.
const QWEN21_EXTRAS: DetailerAsset[] = [
  {
    name: QWEN21_PE_T2I,
    path: 'text_encoders',
    url: `https://huggingface.co/Comfy-Org/Qwen-Image-2.1/resolve/main/text_encoders/${QWEN21_PE_T2I}`,
    sizeMb: 9032,
    nodeClass: 'CLIPLoader',
    fieldName: 'clip_name',
  },
  // BFS head swap (MIT) — the Edit preset's "Head swap" chip. Both builds:
  // alternative is the default (won our comparison), v1.1 the author's pick.
  ...(['alternative', 'v1.1'] as const).map((variant): DetailerAsset => ({
    name: QWEN21_BFS_LORAS[variant],
    path: 'loras',
    url: qwen21BfsUrl(variant),
    sizeMb: variant === 'alternative' ? 304 : 248,
    nodeClass: 'LoraLoader',
    fieldName: 'lora_name',
  })),
]

const QWEN21_EXTRAS_PRESET: PresetDefinition = {
  id: 'qwen21-extras',
  name: 'Qwen-Image 2.1 extras',
  description: 'Optional prompt enhancer and head-swap LoRAs for the Qwen-Image 2.1 models',
  files: [],
}

// ControlNet + IP-Adapter reference models. Mirrors exactly what the installers
// fetch (see install-windows.ps1 / install-linux.sh "ControlNet Aux + IP-Adapter"
// step) so a user who skipped or whose install failed that step can grab them
// here. Names/paths must match the workflow helpers: UNION_MODEL in
// controlnet.ts, FUN_MODEL in zimage-controlnet.ts, and the IPAdapterUnifiedLoader
// preset's expected ip-adapter + CLIP-vision filenames. Presence is detected via
// each model's loader node + field (same mechanism as DETAILER_ASSETS).
const REFERENCE_ASSETS: DetailerAsset[] = [
  {
    name: 'controlnet-union-sdxl-promax.safetensors',
    path: 'controlnet',
    url: 'https://huggingface.co/xinsir/controlnet-union-sdxl-1.0/resolve/main/diffusion_pytorch_model_promax.safetensors',
    sizeMb: 2513,
    nodeClass: 'ControlNetLoader',
    fieldName: 'control_net_name',
  },
  {
    name: 'Z-Image-Turbo-Fun-Controlnet-Union-2.1-2601-8steps.safetensors',
    path: 'model_patches',
    url: 'https://huggingface.co/alibaba-pai/Z-Image-Turbo-Fun-Controlnet-Union-2.1/resolve/main/Z-Image-Turbo-Fun-Controlnet-Union-2.1-2601-8steps.safetensors',
    sizeMb: 6712,
    nodeClass: 'ModelPatchLoader',
    fieldName: 'name',
  },
  {
    name: QWEN21_FUN_MODEL,
    path: 'model_patches',
    url: `https://huggingface.co/Comfy-Org/Qwen-Image-2.1/resolve/main/model_patches/${QWEN21_FUN_MODEL}`,
    sizeMb: 3604,
    nodeClass: 'ModelPatchLoader',
    fieldName: 'name',
  },
  {
    name: 'ip-adapter-plus_sdxl_vit-h.safetensors',
    path: 'ipadapter',
    url: 'https://huggingface.co/h94/IP-Adapter/resolve/main/sdxl_models/ip-adapter-plus_sdxl_vit-h.safetensors',
    sizeMb: 850,
    nodeClass: 'IPAdapterModelLoader',
    fieldName: 'ipadapter_file',
  },
  {
    name: 'CLIP-ViT-H-14-laion2B-s32B-b79K.safetensors',
    path: 'clip_vision',
    url: 'https://huggingface.co/h94/IP-Adapter/resolve/main/models/image_encoder/model.safetensors',
    sizeMb: 2530,
    nodeClass: 'CLIPVisionLoader',
    fieldName: 'clip_name',
  },
]

const REFERENCE_PRESET: PresetDefinition = {
  id: 'reference',
  name: 'ControlNet & IP-Adapter',
  description: 'Reference-guidance models (ControlNet, IP-Adapter, Z-Image Fun patch)',
  files: [],
}

// ─── Catalog ──────────────────────────────────────────────────────────────────

type Category = 'image' | 'video' | 'face' | 'extras'

/** One downloadable file, whichever list above it came from. No `url` = import by hand. */
interface CatalogFile {
  name: string
  path: string
  url?: string
  sizeMb: number
  /** Where a file without a `url` comes from. */
  source?: string
  /** Not needed to render — an extra; never makes the row read as half-installed. */
  optional?: boolean
}

/** One collapsible row. `id` is the state-key prefix that entry's probe writes. */
interface CatalogEntry {
  id: string
  /** Image presets: the family, named as on the Generate panel; `name` is then the variant. */
  family?: string
  name: string
  description: string
  category: Category
  files: CatalogFile[]
}

const GROUPS: { id: Category; chip: string; heading: string }[] = [
  { id: 'image', chip: 'Image', heading: 'Image models' },
  { id: 'video', chip: 'Video', heading: 'Video models' },
  { id: 'face', chip: 'Face', heading: 'Face' },
  { id: 'extras', chip: 'Extras', heading: 'Extras' },
]
const CHIPS: { id: Category | 'all'; label: string }[] = [
  { id: 'all', label: 'All' },
  ...GROUPS.map((g) => ({ id: g.id, label: g.chip })),
]
/** Which chip was picked last — a per-browser convenience, nothing depends on it. */
const CATEGORY_KEY = 'raccoon-studio:models-category'

const fromAsset = (a: ModelAsset): CatalogFile =>
  ({ name: a.name, path: a.folder, url: a.url, sizeMb: a.sizeMb, source: a.source, optional: a.optional })

const CATALOG: CatalogEntry[] = [
  // Image presets share their ids with the Generate presets, so they take the
  // same family · variant names.
  ...IMAGE_PRESETS.map((p): CatalogEntry => {
    const n = presetNameById(p.id)
    return { ...p, category: 'image', ...(n && { family: n.family, name: n.variant }) }
  }),
  {
    id: LTX_PRESET.id,
    name: 'LTX 2.3',
    category: 'video',
    description: `Models for the Generate Videos workflow. ${LTX23_ASSETS.filter((a) => !a.url).length} files have no public mirror — bring them in with Import… (or copy from an existing ComfyUI install).`,
    files: LTX23_ASSETS.map(fromAsset),
  },
  {
    id: MINIMAX_H3_PRESET.id,
    name: 'MiniMax H3',
    category: 'video',
    description: 'Video with natively synced stereo audio, 24 fps. The first four files are required — the audio VAE included, or clips come out silent — and total ~42.5 GB; the rest are optional — the Turbo/ref2v/realism files each unlock one mode in the video form, 10Eros Max is an uncensored finetune you pick as a checkpoint there, and the Mystic style LoRAs are picked by hand in its LoRA slots. Needs ComfyUI 0.30.0 or newer.',
    files: MINIMAX_H3_ASSETS.map(fromAsset),
  },
  {
    id: DETAILER_PRESET.id,
    name: DETAILER_PRESET.name,
    category: 'face',
    description: 'Models for the Face Detailer stage. Requires ComfyUI Impact Pack + Impact-Subpack.',
    files: DETAILER_ASSETS,
  },
  {
    id: FACESWAP_PRESET.id,
    name: FACESWAP_PRESET.name,
    category: 'face',
    description: '256px swap models and the GPEN-BFR-1024 face restorer the swap chain uses by default. Hyperswap 1C has the best likeness on straight-on faces; AlphaFace holds up better when the head is turned. Hyperswap and GPEN need the ReActor node; AlphaFace runs through the bundled pixel-boost node.',
    files: FACESWAP_ASSETS,
  },
  {
    id: REFERENCE_PRESET.id,
    name: REFERENCE_PRESET.name,
    category: 'extras',
    description: 'ControlNet, IP-Adapter, and the Z-Image and Qwen-Image 2.1 Fun ControlNet patches. Needed to enable the ControlNet / IP-Adapter toggles in Generate.',
    files: REFERENCE_ASSETS,
  },
  {
    // The optional heavyweight uncensor model
    id: KREA2_NSFW_PRESET.id,
    name: KREA2_NSFW_PRESET.name,
    category: 'extras',
    description: 'Kroma is a re-trained, uncensored version of Krea2. Optional — the Krea2 models already come with a small uncensor patch that costs you nothing, and that is enough for most prompts. Kroma goes further (more willing, better bodies and skin) but it also changes the look of every image and adds 1.9 GB. Once installed, pick it under NSFW in Generate.',
    files: KREA2_NSFW_LORAS,
  },
  {
    id: KREA2_STYLE_PRESET.id,
    name: KREA2_STYLE_PRESET.name,
    category: 'extras',
    description: 'Optional style LoRAs for the Krea2 models. None is required to generate — grab only the looks you want. They show up in the LoRA picker in Generate once installed.',
    files: KREA2_STYLE_LORAS,
  },
  {
    id: QWEN21_EXTRAS_PRESET.id,
    name: QWEN21_EXTRAS_PRESET.name,
    category: 'extras',
    description: "Qwen's own prompt enhancer, a separate 9.5 GB model: it turns a short idea into the long, literal description Qwen-Image 2.1 renders best — once installed, the Prompt enhancer switch in Generate turns on for the Qwen presets. Plus the two BFS head-swap LoRAs (MIT) for the Edit preset's Head swap chip: Alternative (default) and v1.1. Only swap in a person who has agreed to it. Qwen Research License — research or evaluation use only.",
    files: QWEN21_EXTRAS,
  },
]


// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ModelsPage() {
  const [states, setStates] = useState<Record<string, DownloadState>>({})

  useEffect(() => {
    fetch('/api/models/paths')
      .then((r) => r.json())
      .then(() => {})
      .catch(() => {})
  }, [])

  const patchState = (key: string, patch: Partial<DownloadState>) =>
    setStates((s) => ({ ...s, [key]: { ...(s[key] ?? { status: 'idle', progress: 0 }), ...patch } }))

  useEffect(() => {
    const check = async () => {
      const safeFetch = async (url: string) => {
        try { return await (await fetch(url)).json() } catch { return null }
      }
      const [unetData, clipData, vaeData, ckptData] = await Promise.all([
        safeFetch('/api/comfyui/object_info/UNETLoader'),
        safeFetch('/api/comfyui/object_info/CLIPLoader'),
        safeFetch('/api/comfyui/object_info/VAELoader'),
        safeFetch('/api/comfyui/object_info/CheckpointLoaderSimple'),
      ])
      const unetNames = comboOptions(unetData, 'UNETLoader', 'unet_name')
      const clipNames = comboOptions(clipData, 'CLIPLoader', 'clip_name')
      const vaeNames  = comboOptions(vaeData,  'VAELoader', 'vae_name')
      const ckptNames = comboOptions(ckptData, 'CheckpointLoaderSimple', 'ckpt_name')

      const allPresent = [...unetNames, ...clipNames, ...vaeNames, ...ckptNames]
      for (const preset of IMAGE_PRESETS) {
        for (const file of preset.files) {
          const key = `${preset.id}::${file.name}`
          const present = allPresent.some((n) => n === file.name || n.endsWith('/' + file.name))
          patchState(key, { status: present ? 'present' : 'missing', progress: 0 })
        }
      }
    }
    void check()
  }, [])

  // LTX video assets live across checkpoints/loras/vae/text_encoders/latent
  // upscalers — query each loader and union the names to mark installed/missing.
  useEffect(() => {
    const checkLtx = async () => {
      const safeFetch = async (url: string) => {
        try { return await (await fetch(url)).json() } catch { return null }
      }
      const [ckpt, lora, vae, clip, latent, unet] = await Promise.all([
        safeFetch('/api/comfyui/object_info/CheckpointLoaderSimple'),
        safeFetch('/api/comfyui/object_info/LoraLoader'),
        safeFetch('/api/comfyui/object_info/VAELoader'),
        safeFetch('/api/comfyui/object_info/CLIPLoader'),
        safeFetch('/api/comfyui/object_info/LatentUpscaleModelLoader'),
        // MiniMax H3's DiT lives in models/diffusion_models, which only
        // UNETLoader enumerates — without this probe every H3 row reads "missing"
        // even once the 21 GB file is on disk.
        safeFetch('/api/comfyui/object_info/UNETLoader'),
      ])
      const available = new Set<string>([
        ...comboOptions(ckpt, 'CheckpointLoaderSimple', 'ckpt_name'),
        ...comboOptions(lora, 'LoraLoader', 'lora_name'),
        ...comboOptions(vae, 'VAELoader', 'vae_name'),
        ...comboOptions(clip, 'CLIPLoader', 'clip_name'),
        ...comboOptions(latent, 'LatentUpscaleModelLoader', 'model_name'),
        ...comboOptions(unet, 'UNETLoader', 'unet_name'),
      ])
      for (const asset of LTX23_ASSETS) {
        patchState(`ltx23::${asset.name}`, {
          status: assetInstalled(asset.name, available) ? 'present' : 'missing',
          progress: 0,
        })
      }
      for (const asset of MINIMAX_H3_ASSETS) {
        patchState(`minimax-h3::${asset.name}`, {
          status: assetInstalled(asset.name, available) ? 'present' : 'missing',
          progress: 0,
        })
      }
    }
    void checkLtx()
  }, [])

  // Detailer models: check via the node classes that expose them (Impact Pack only).
  useEffect(() => {
    const checkDetailer = async () => {
      const safeFetch = async (url: string) => {
        try { return await (await fetch(url)).json() } catch { return null }
      }
      for (const asset of DETAILER_ASSETS) {
        const data = await safeFetch(`/api/comfyui/object_info/${asset.nodeClass}`)
        const names = comboOptions(data, asset.nodeClass, asset.fieldName)
        const installed = names.some((n) => n === asset.name || n.endsWith('/' + asset.name))
        patchState(`detailer::${asset.name}`, { status: installed ? 'present' : 'missing', progress: 0 })
      }
    }
    void checkDetailer()
  }, [])

  // Krea2 style + NSFW LoRAs: one LoraLoader probe covers all of them, rather
  // than the per-asset probe above repeating the same fetch.
  useEffect(() => {
    const checkKrea2Styles = async () => {
      let names: string[]
      try {
        names = comboOptions(
          await (await fetch('/api/comfyui/object_info/LoraLoader')).json(),
          'LoraLoader',
          'lora_name',
        )
      } catch {
        // ComfyUI down — leave every row in its initial state rather than
        // claiming the files are missing.
        return
      }
      const mark = (prefix: string, assets: DetailerAsset[]) => {
        for (const asset of assets) {
          const installed = names.some((n) => n === asset.name || n.endsWith('/' + asset.name))
          patchState(`${prefix}::${asset.name}`, {
            status: installed ? 'present' : 'missing',
            progress: 0,
          })
        }
      }
      mark(KREA2_STYLE_PRESET.id, KREA2_STYLE_LORAS)
      mark(KREA2_NSFW_PRESET.id, KREA2_NSFW_LORAS)
    }
    void checkKrea2Styles()
  }, [])

  // ControlNet / IP-Adapter reference models + face-swap models: same
  // node-class probe as the detailer assets — each is exposed by its loader
  // node's file-list field.
  useEffect(() => {
    const checkReference = async () => {
      const safeFetch = async (url: string) => {
        try { return await (await fetch(url)).json() } catch { return null }
      }
      const groups = [
        ['reference', REFERENCE_ASSETS],
        ['faceswap', FACESWAP_ASSETS],
        [QWEN21_EXTRAS_PRESET.id, QWEN21_EXTRAS],
      ] as const
      for (const [prefix, assets] of groups) {
        for (const asset of assets) {
          const data = await safeFetch(`/api/comfyui/object_info/${asset.nodeClass}`)
          const names = comboOptions(data, asset.nodeClass, asset.fieldName)
          const installed = names.some((n) => n === asset.name || n.endsWith('/' + asset.name))
          patchState(`${prefix}::${asset.name}`, { status: installed ? 'present' : 'missing', progress: 0 })
        }
      }
    }
    void checkReference()
  }, [])

  // Downloads run on the server now, so the page cannot cancel one by walking
  // away from it — cancelling is an explicit request. `key` here is the page's
  // own `preset::file` key; the server keys by the file's real location, which
  // is what the second half reconstructs.
  const cancelDownload = (key: string) => {
    const name = key.split('::').pop()!
    const t = serverTransfers.current.find((x) => x.name === name && x.status === 'running')
    if (!t) return
    void fetch('/api/models/download/cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: t.key }),
    })
  }

  // New model files only reach ComfyUI's pickers when it restarts. Catalogue
  // downloads and Patreon imports both register with one tracker, so a bulk
  // download or a run of imports asks once, when the last transfer settles.
  const [restartOpen, setRestartOpen] = useState(false)
  const [tab, setTab] = useState<'catalog' | 'mine' | 'civitai'>('catalog')
  const [category, setCategory] = useState<Category | 'all'>('all')
  const [importOpen, setImportOpen] = useState(false)
  // Simple (spec §5): two tabs — the file list (My Models) is Advanced only.
  const simple = useUiMode() === 'simple'
  const shownTab = simple && tab === 'mine' ? 'catalog' : tab
  useEffect(() => {
    try {
      const saved = localStorage.getItem(CATEGORY_KEY)
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time restore from storage
      if (saved && CHIPS.some((c) => c.id === saved)) setCategory(saved as Category | 'all')
    } catch { /* storage unavailable */ }
  }, [])
  const pickCategory = (c: Category | 'all') => {
    setCategory(c)
    try { localStorage.setItem(CATEGORY_KEY, c) } catch { /* quota or unavailable */ }
  }
  const [justConnected, setJustConnected] = useState(false)

  /**
   * The Civitai sign-in result, read HERE rather than inside `MyModelsTab`.
   *
   * The callback redirects to `/models?civitai=…`, and this page opens on the
   * Catalog tab — so while the tab owned this effect, `next/dynamic` kept it
   * unmounted and **a failed sign-in reported nothing at all**: no toast, and
   * the query string left in the URL to replay on the next refresh. Landing on
   * the tab the user was signing in to reach is the other half of the fix.
   */
  useEffect(() => {
    const q = new URLSearchParams(window.location.search)
    const r = q.get('civitai')
    if (!r) return
    window.history.replaceState({}, '', window.location.pathname)
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot read of the sign-in result on arrival
    setTab('civitai')
    if (r === 'connected') setJustConnected(true)

    // Deferred a tick, NOT decoration. Effects run child-before-parent, so on
    // the hard navigation the OAuth callback always arrives as, this effect
    // fires before `<Toaster>` in the studio layout has subscribed to sonner's
    // store — and a toast emitted with no subscriber is dropped silently.
    // Measured: the effect ran and called toast.error, and no toast element
    // ever appeared. Every later toast on this page works, which is exactly what
    // makes it look like the sign-in result specifically is broken.
    const id = setTimeout(() => {
      if (r === 'connected') toast.success('Connected to Civitai')
      else toast.error(`Civitai sign-in failed: ${q.get('reason') ?? 'unknown error'}`)
    }, 0)
    return () => clearTimeout(id)
  }, [])
  /** Live server transfers, so the Civitai browser can show its own progress
   *  without standing up a second poller. */
  const [liveTransfers, setLiveTransfers] = useState<Transfer[]>([])
  const transfers = useRef(createTransferTracker(() => setRestartOpen(true))).current

  /** Last poll result, so Cancel can turn a page key into a server key. */
  const serverTransfers = useRef<Transfer[]>([])
  /** Server keys this page started and has not yet seen settle. Only these get
   *  a toast and a restart-prompt tick — a revisit must not re-announce a
   *  download that finished while the page was closed. */
  const watched = useRef(new Set<string>())

  /**
   * Fold the server's view of every transfer into the page's per-file state.
   *
   * Every state key ends in `::<filename>`, across all the catalogues on this
   * page, and a transfer knows its filename — so one suffix match covers
   * presets, LTX, H3 and the detailer without a second mapping to keep in step
   * with them. Two presets that share a file both light up, which is correct:
   * it is one file and one download.
   */
  const applyTransfers = useCallback((incoming: Transfer[]) => {
    serverTransfers.current = incoming
    setLiveTransfers(incoming)
    if (incoming.length) {
      setStates((s) => {
        const next = { ...s }
        for (const t of incoming) {
          const status: DownloadState['status'] =
            t.status === 'running' ? 'downloading'
            : t.status === 'done' ? 'done'
            : t.status === 'cancelled' ? 'missing'
            : 'error'
          for (const key of Object.keys(next)) {
            if (!key.endsWith(`::${t.name}`)) continue
            next[key] = {
              ...next[key],
              status,
              progress: t.status === 'done' ? 100 : t.value,
              received: t.receivedBytes,
              total: t.totalBytes,
              error: t.status === 'error' ? t.error : undefined,
            }
          }
        }
        return next
      })
    }

    for (const t of incoming) {
      if (t.status === 'running' || !watched.current.has(t.key)) continue
      watched.current.delete(t.key)
      if (t.status === 'done') toast.success(`${t.name} downloaded`)
      else if (t.status === 'cancelled') toast.info(`Cancelled ${t.name}`)
      else toast.error(`Download failed: ${t.error ?? 'Unknown error'}`)
      // Only a file that actually landed makes ComfyUI's pickers stale.
      transfers.end(t.status === 'done' && !t.alreadyExists)
    }
  }, [transfers])

  /**
   * Poll for transfer state. This is what makes coming back to the page show a
   * download in progress rather than an idle list — and it keeps working when
   * the download was started from a different tab entirely.
   */
  useEffect(() => {
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const loop = async () => {
      let running = false
      try {
        const r = await fetch('/api/models/download', { cache: 'no-store' })
        const { transfers: list } = (await r.json()) as { transfers: Transfer[] }
        if (stopped) return
        applyTransfers(list)
        running = list.some((t) => t.status === 'running')
      } catch { /* transient — try again on the next tick */ }
      if (stopped) return
      // Idle polling stays slow but does not stop: a download started elsewhere
      // should still show up here.
      timer = setTimeout(() => void loop(), running ? 1_000 : 5_000)
    }
    void loop()
    return () => { stopped = true; if (timer) clearTimeout(timer) }
  }, [applyTransfers])

  /**
   * Ask the server to start a download, then stop caring about this request.
   *
   * The old version held the connection for the whole transfer and read SSE off
   * it, which quietly made the browser the owner: leaving the page aborted the
   * fetch, and the server answered by deleting the partial file. Now the POST
   * returns as soon as the job is registered and the poll below reports it, so
   * a download outlives the page that started it.
   */
  const handleDownload = async (entryId: string, file: CatalogFile) => {
    if (!file.url) return // manual-only file; its row offers no download
    const key = `${entryId}::${file.name}`
    patchState(key, { status: 'downloading', progress: 0, received: 0, total: 0 })
    try {
      const res = await fetch('/api/models/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: file.url, path: file.path, name: file.name }),
      })
      const data = (await res.json()) as { transfer?: Transfer; error?: string }
      if (!res.ok || !data.transfer) throw new Error(data.error ?? `HTTP ${res.status}`)

      if (data.transfer.status === 'done') {
        // Already on disk — nothing was fetched, so ComfyUI has seen it and the
        // restart prompt must not be armed for it.
        patchState(key, { status: 'done', progress: 100 })
        return
      }
      // Settlement, its toast and the restart prompt are all the poll's job now,
      // because they have to happen even if this page is long gone by then.
      if (!watched.current.has(data.transfer.key)) {
        watched.current.add(data.transfer.key)
        transfers.begin()
      }
      toast.info(`Downloading ${file.name}…`)
    } catch (e) {
      patchState(key, { status: 'error', error: String(e) })
      toast.error(`Download failed: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  return (
    <div className="p-6 md:p-8 space-y-5">

      {/* Header */}
      <div className="flex items-start gap-3.5">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 ring-1 ring-primary/20 shrink-0">
          <Package className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight leading-none">Models</h1>
          {simple ? (
            <p className="mt-1.5 text-sm text-muted-foreground">Download models that fit your computer, or add your own.</p>
          ) : (
            <>
              <p className="mt-1.5 text-sm text-muted-foreground">
                Not sure what to get? <Link href="/setup" className="font-medium text-foreground underline">Start here</Link> — it picks models that fit your computer.
              </p>
              <p className="text-sm text-muted-foreground mt-1.5">
                Download a preset to start generating, import your own, or browse Civitai.
              </p>
            </>
          )}
        </div>
        <div className="ml-auto flex items-center gap-2.5">
          <GuideChip slug={shownTab === 'civitai' ? 'civitai' : 'models'} />
          <SimpleAdvancedSwitch />
        </div>
      </div>

      {/* Tab strip */}
      <div className="flex gap-1 bg-muted rounded-lg p-1 w-fit">
        {(simple
          ? ([['catalog', 'Models'], ['civitai', 'Civitai Browser']] as const)
          : ([['catalog', 'Catalog'], ['mine', 'My Models'], ['civitai', 'Civitai Browser']] as const)
        ).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`text-xs font-semibold px-3.5 py-1.5 rounded-md ${
              shownTab === id
                ? 'bg-gradient-to-br from-primary to-[#ffa64d] text-primary-foreground'
                : 'text-muted-foreground'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Two tabs, one gated component: the add-on lock, the locked panel and
          the dynamic chunk are shared, and only the Civitai pane pays for the
          sign-in state. What is installed no longer sits behind a Civitai
          account, which it never needed. */}
      {shownTab === 'mine' && <MyModelsTab pane="library" />}

      {shownTab === 'civitai' && (
        <MyModelsTab
          pane="civitai"
          activeTransfers={liveTransfers}
          justConnected={justConnected}
          onStarted={(t) => {
            // Arm the restart prompt only. Settlement, its toast and the prompt
            // itself are the poll's job — calling end() here fired the dialog
            // the instant a download STARTED, because the POST returns as soon
            // as the server job is registered.
            if (t.status === 'done') return // already on disk; nothing landed
            if (watched.current.has(t.key)) return
            watched.current.add(t.key)
            transfers.begin()
          }}
        />
      )}

      {/* Simple (spec §5). Its own import strip, opened by "Add a model file…": a mode
          switch mid-import restarts only the progress row — the import itself runs on the server. */}
      {shownTab === 'catalog' && simple && (
        <>
          <SimpleModels onSearchCivitai={() => setTab('civitai')} onAddFile={() => setImportOpen(true)} />
          <div className={importOpen ? undefined : 'hidden'}>
            <ImportPanel onBegin={() => transfers.begin()} onEnd={(ok) => transfers.end(ok)} />
          </div>
        </>
      )}

      {shownTab === 'catalog' && !simple && (<>

      {/* Toolbar — category chips, and Import… opening the import strip */}
      <div className="flex flex-wrap items-center gap-2">
        {/* A filter, not navigation: kept quieter than the orange tab strip above. */}
        {CHIPS.map((c) => (
          <button
            key={c.id}
            type="button"
            aria-pressed={category === c.id}
            onClick={() => pickCategory(c.id)}
            className={`h-7 rounded-full border px-3 text-xs font-medium transition-colors ${
              category === c.id
                ? 'border-primary/50 bg-primary/10 text-foreground'
                : 'border-border text-muted-foreground hover:text-foreground'
            }`}
          >
            {c.label}
          </button>
        ))}
        <Button
          variant="outline"
          className="ml-auto h-8 gap-1.5 px-3 text-xs"
          aria-expanded={importOpen}
          onClick={() => setImportOpen((o) => !o)}
        >
          <FolderInput className="h-3.5 w-3.5" /> Import…
        </Button>
      </div>

      {/* Import any LoRA or checkpoint — no filename rules, no Patreon key. Kept
          mounted while closed, so an import in flight keeps its row. */}
      <div className={importOpen ? undefined : 'hidden'}>
        <ImportPanel onBegin={() => transfers.begin()} onEnd={(ok) => transfers.end(ok)} />
      </div>


      {GROUPS.filter((g) => category === 'all' || category === g.id).map((g) => (
        <section key={g.id} className="space-y-2">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">{g.heading}</h2>
          {/* data-tour: what the first-run tour rings on its Models step — "download
              one of these" is the whole point of the page for a new install. */}
          <div className="space-y-2" data-tour={g.id === 'image' ? '/models' : undefined}>
            {CATALOG.filter((e) => e.category === g.id).map((entry) => (
              <CatalogRow
                key={entry.id}
                entry={entry}
                states={states}
                onDownload={(file) => void handleDownload(entry.id, file)}
                onCancel={(file) => cancelDownload(`${entry.id}::${file.name}`)}
              />
            ))}
          </div>
        </section>
      ))}

      </>)}

      {/* Raised once every started download and import has finished. Outside the
          tab switch on purpose: a download started in My Models must still be
          able to raise it. */}
      <ConfirmDialog
        open={restartOpen}
        onOpenChange={setRestartOpen}
        title="Restart ComfyUI to load the new models?"
        description={
          'All downloads and imports have finished. ComfyUI only scans its model folders when it starts, ' +
          'so the new files will not appear in the pickers until it restarts.'
        }
        confirmLabel="Restart ComfyUI"
        onConfirm={() => void restartComfyUI()}
      />
    </div>
  )
}

// ─── CatalogRow ───────────────────────────────────────────────────────────────

const IDLE: DownloadState = { status: 'idle', progress: 0 }
const isInstalled = (st: DownloadState) => st.status === 'present' || st.status === 'done'
const fmtMb = (mb: number) => (mb >= 1000 ? `${(mb / 1000).toFixed(1)} GB` : `${Math.round(mb)} MB`)

/**
 * One catalog entry as a single collapsible row: status and Download act on the
 * collapsed line, the file list opens underneath. Rows start collapsed — most
 * entries on a real install are partly installed (optional files), so
 * "collapse once complete" would leave most of them open.
 */
function CatalogRow({
  entry,
  states,
  onDownload,
  onCancel,
}: {
  entry: CatalogEntry
  states: Record<string, DownloadState>
  onDownload: (file: CatalogFile) => void
  onCancel: (file: CatalogFile) => void
}) {
  const [open, setOpen] = useState(false)
  const rows = entry.files.map((file) => ({ file, state: states[`${entry.id}::${file.name}`] ?? IDLE }))
  const downloading = rows.filter((r) => r.state.status === 'downloading')
  const failed = rows.filter((r) => r.state.status === 'error').length
  // Ready / one size (fixes 2 + 6): optional extras never make a row look half-installed.
  // Only files with a verified public URL can be fetched here; the rest are imported by hand.
  const sum = rowSummary(rows.map((r) => ({
    optional: r.file.optional, sizeMb: r.file.sizeMb, installed: isInstalled(r.state),
    downloadable: !!r.file.url && (r.state.status === 'missing' || r.state.status === 'idle'),
  })))
  // Download takes what the size shows (the required files); extras come after, as "Get N extras".
  const missing = sum.fetch.map((i) => rows[i])

  const status =
    downloading.length > 0 ? (
      <span className="text-primary tabular-nums">
        Downloading {Math.round(downloading.reduce((n, r) => n + r.state.progress, 0) / downloading.length)}%
      </span>
    ) : failed > 0 ? (
      <span className="text-destructive">{failed} failed</span>
    ) : rows.every((r) => r.state.status === 'idle') ? (
      <span>Checking…</span>
    ) : sum.ready ? (
      <span className="flex items-center gap-1 text-green-500"><CheckCircle className="h-3.5 w-3.5" /> Ready</span>
    ) : sum.installedRequired === 0 ? (
      <span>Not installed</span>
    ) : (
      <span>{sum.installedRequired} of {sum.required} needed files</span>
    )

  return (
    <div className="rounded-xl border border-border bg-card transition-colors hover:border-primary/30">
      <div className="flex items-center gap-3 px-3.5 py-2">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
        >
          <ChevronRight className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? 'rotate-90' : ''}`} />
          <span className="flex w-52 shrink-0 items-baseline gap-2">
            {entry.family && (
              <span className="w-[4.5rem] shrink-0 truncate font-heading text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                {entry.family}
              </span>
            )}
            <span className="min-w-0 truncate font-heading text-sm font-bold tracking-tight">{entry.name}</span>
          </span>
          {!open && <span className="min-w-0 flex-1 text-xs text-muted-foreground line-clamp-2">{entry.description}</span>}
        </button>
        <span className="w-36 shrink-0 text-xs text-muted-foreground">{status}</span>
        <span className="w-16 shrink-0 text-right text-xs tabular-nums text-muted-foreground" title={sum.sizeIsDownload ? 'Still to download' : 'On disk'}>
          {fmtMb(sum.sizeMb)}
        </span>
        <div className="flex h-8 w-44 shrink-0 items-center justify-end">
          {missing.length > 0 && (
            <Button
              // An image preset with nothing installed is the call to action — it
              // cannot generate yet. Topping up, and optional packs, stay quiet.
              variant={sum.installedRequired === 0 && !sum.ready && entry.category === 'image' ? 'default' : 'outline'}
              className="h-8 px-3 text-xs font-semibold"
              title={missing.map((r) => r.file.name).join('\n')}
              onClick={() => missing.forEach((r) => onDownload(r.file))}
            >
              <Download className="mr-1.5 h-3.5 w-3.5" />
              {sum.ready ? `Get ${missing.length} extra${missing.length > 1 ? 's' : ''}` : 'Download'}
            </Button>
          )}
        </div>
      </div>

      {open && (
        <div className="space-y-3 border-t border-border px-3.5 py-3">
          <p className="text-xs leading-relaxed text-muted-foreground">{entry.description}</p>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {rows.map(({ file, state }) => (
              <FileRow
                key={file.name}
                file={file}
                state={state}
                onDownload={() => onDownload(file)}
                onCancel={() => onCancel(file)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── FileRow ──────────────────────────────────────────────────────────────────

/** Percent (size known), downloaded MB/GB (size unknown), plus a cancel ×. */
function DownloadingBadge({ state, onCancel }: { state: DownloadState; onCancel?: () => void }) {
  const text =
    state.total && state.total > 0 ? `${state.progress}%`
    : state.received && state.received > 0 ? fmtBytesShort(state.received)
    : '…'
  return (
    <span className="flex items-center gap-1">
      <Badge variant="outline" className="text-[11px] h-5 px-2 tabular-nums min-w-14 justify-center">
        {text}
      </Badge>
      {onCancel && (
        <Button
          size="icon" variant="ghost"
          className="h-5 w-5 text-muted-foreground hover:text-destructive"
          onClick={onCancel}
          title="Cancel download"
        >
          <X className="h-3 w-3" />
        </Button>
      )}
    </span>
  )
}

function fmtBytesShort(bytes: number): string {
  const mb = bytes / 1048576
  return mb >= 1000 ? `${(mb / 1000).toFixed(1)} GB` : `${Math.round(mb)} MB`
}

function FileRow({
  file,
  state,
  onDownload,
  onCancel,
}: {
  file: CatalogFile
  state: DownloadState
  onDownload: () => void
  onCancel?: () => void
}) {
  const installed = isInstalled(state)
  const barWidth = installed ? 100 : state.status === 'downloading' ? state.progress : 0
  const barColor = installed
    ? 'color-mix(in oklch, #22c55e 70%, transparent)'
    : state.status === 'error'
    ? 'var(--destructive)'
    : 'var(--action)'

  return (
    <div className="relative flex items-center gap-2 rounded-lg bg-muted/40 px-2.5 py-1.5 overflow-hidden">
      {installed ? (
        <CheckCircle className="h-4 w-4 text-green-500 shrink-0" />
      ) : state.status === 'error' ? (
        <AlertCircle className="h-4 w-4 text-destructive shrink-0" />
      ) : (
        <div className="h-4 w-4 rounded-full border border-muted-foreground/50 shrink-0" />
      )}
      <div className="flex-1 min-w-0">
        <p className="text-xs font-mono truncate leading-tight">{file.name}</p>
        <p className="text-[11px] text-muted-foreground leading-tight mt-0.5 truncate">
          {file.path} · {fmtMb(file.sizeMb)}{file.optional ? ' · optional' : ''}
          {!file.url && file.source && <span> · {file.source}</span>}
        </p>
      </div>
      <div className="shrink-0">
        {installed ? (
          <Badge variant="secondary" className="text-[11px] h-5 px-2">Installed</Badge>
        ) : state.status === 'downloading' ? (
          <DownloadingBadge state={state} onCancel={onCancel} />
        ) : file.url ? (
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={onDownload} title="Download">
            <Download className="h-3.5 w-3.5" />
          </Button>
        ) : (
          <Badge variant="outline" className="text-[11px] h-5 px-2" title={file.source}>Manual</Badge>
        )}
      </div>

      {/* Thin progress bar */}
      <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-muted/20">
        <div
          className="h-full transition-all duration-300 ease-out"
          style={{ width: `${barWidth}%`, backgroundColor: barColor }}
        />
      </div>
    </div>
  )
}
