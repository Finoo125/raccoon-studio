'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import {
  CheckCircle, Download, AlertCircle, Package,
  Upload, FolderOpen, ChevronDown, ChevronUp, Lock,
  Trash2, HardDrive, RefreshCw, X,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import { PATREON_PATTERNS, isPatreonModel, patreonSubfolder, matchesPatreonPreset } from '@/lib/models/patreon'
import { LTX23_ASSETS, assetInstalled, type ModelAsset } from '@/lib/models/ltx23-assets'
import { MINIMAX_H3_ASSETS } from '@/lib/models/minimax-h3-assets'
import { comboOptions } from '@/lib/models/installed'
import { restartComfyUI } from '@/lib/comfyui/restart'
import { createTransferTracker } from '@/lib/models/transfer-tracker'
// Type-only: lib/models/transfers.ts is server code (fs, https) and this import
// is erased at build, so none of it reaches the browser bundle.
import type { Transfer } from '@/lib/models/transfers'
import { KREA2_REFUSAL_LORA, KREA2_PROJECTOR_LORA, KREA2_KROMA_LORA } from '@/lib/workflows/krea2'

// ─── Types ────────────────────────────────────────────────────────────────────

interface ModelFile {
  name: string
  path: string
  url: string
  sizeMb: number
}

interface PresetDefinition {
  id: string
  name: string
  description: string
  files: ModelFile[]
}

interface DownloadState {
  status: 'idle' | 'checking' | 'missing' | 'present' | 'downloading' | 'done' | 'error'
  progress: number
  /** Bytes received / total — total is 0 when the server sent no content-length. */
  received?: number
  total?: number
  error?: string
}

interface PatreonEntry {
  name: string
  subfolder: 'loras' | 'checkpoints' | 'diffusion_models'
  status: 'active' | 'importing' | 'error'
  error?: string
}

// ─── Data ─────────────────────────────────────────────────────────────────────

// The SDXL fp16-fix VAE is a required part of working with the SDXL-family
// checkpoints (SDXL/Pony/Illustrious all decode through it to avoid washed-out
// colors), so it ships inside each of those presets. One shared file object —
// the download de-dupes on disk, so grabbing any one model fetches it once.
// Name/path must match SDXL_FIX_VAE in lib/workflows/sdxl.ts.
const SDXL_VAE_FILE: ModelFile = {
  name: 'sdxl_vae.safetensors',
  path: 'vae',
  url: 'https://huggingface.co/madebyollin/sdxl-vae-fp16-fix/resolve/main/sdxl.vae.safetensors',
  sizeMb: 335,
}

// Both Anima checkpoints run on the same Qwen text encoder + VAE, so those two
// files appear in both presets — the download de-dupes on disk, so whichever
// preset is grabbed second only fetches its checkpoint.
const ANIMA_SHARED_FILES: ModelFile[] = [
  {
    name: 'qwen_3_06b_base.safetensors',
    path: 'text_encoders',
    url: 'https://huggingface.co/circlestone-labs/Anima/resolve/main/split_files/text_encoders/qwen_3_06b_base.safetensors',
    sizeMb: 1200,
  },
  {
    name: 'qwen_image_vae.safetensors',
    path: 'vae',
    url: 'https://huggingface.co/circlestone-labs/Anima/resolve/main/split_files/vae/qwen_image_vae.safetensors',
    sizeMb: 160,
  },
]

// Krea2 Turbo and RAW run on the same Qwen3-VL text encoder, VAE and pair of
// built-in LoRAs, so those four files appear in both presets — the download
// de-dupes on disk, so whichever preset is grabbed second only fetches its
// 13 GB checkpoint. The VAE de-dupes with Anima's copy of the same file too.
// Both LoRA filenames come from lib/workflows/krea2.ts: the builder asks ComfyUI
// for exactly these names, so renaming one here is a silent generation failure.
const KREA2_SHARED_FILES: ModelFile[] = [
  {
    name: 'qwen3vl_4b_fp8_scaled.safetensors',
    path: 'text_encoders',
    url: 'https://huggingface.co/Comfy-Org/Krea-2/resolve/main/text_encoders/qwen3vl_4b_fp8_scaled.safetensors',
    sizeMb: 5000,
  },
  {
    name: 'qwen_image_vae.safetensors',
    path: 'vae',
    url: 'https://huggingface.co/Comfy-Org/Krea-2/resolve/main/vae/qwen_image_vae.safetensors',
    sizeMb: 242,
  },
  {
    // TextFusion refusal-reduction patch, applied at strength 1. Hosted on a
    // third-party mirror because the canonical Civitai listing (model 2775340)
    // requires an API token; verified public and unauthenticated 2026-07-27.
    name: KREA2_REFUSAL_LORA,
    path: 'loras',
    url: 'https://huggingface.co/Kutches/Kr3a/resolve/main/Krea2_TextFusion_Refusal_Reduction.safetensors',
    sizeMb: 27,
  },
  {
    // Projector-scale patch (the "NSFW filter" slider in Generate). Upstream
    // ships it under the generic name `pytorch_lora_weights.safetensors`, which
    // is meaningless in a shared loras/ folder, so it is renamed on the way in.
    // All of 268 bytes — two rank-1 tensors on the text-fusion projector.
    name: KREA2_PROJECTOR_LORA,
    path: 'loras',
    url: 'https://huggingface.co/Beinsezii/Krea-2-Turbo-Projector-Scale-LoRA-Diffusers/resolve/main/pytorch_lora_weights.safetensors',
    sizeMb: 1,
  },
]

const PRESETS: PresetDefinition[] = [
  {
    id: 'anima',
    name: 'Anima',
    description: 'Anime-style text-to-image',
    files: [
      {
        name: 'anima-aesthetic-v1.1.safetensors',
        path: 'diffusion_models',
        url: 'https://huggingface.co/circlestone-labs/Anima/resolve/main/split_files/diffusion_models/anima-aesthetic-v1.1.safetensors',
        sizeMb: 4000,
      },
      ...ANIMA_SHARED_FILES,
    ],
  },
  {
    id: 'anima-turbo',
    name: 'Anima Turbo',
    description: 'Distilled Anima — same look, ~3× fewer steps',
    files: [
      {
        name: 'anima-turbo-v1.0.safetensors',
        path: 'diffusion_models',
        url: 'https://huggingface.co/circlestone-labs/Anima/resolve/main/split_files/diffusion_models/anima-turbo-v1.0.safetensors',
        sizeMb: 4000,
      },
      ...ANIMA_SHARED_FILES,
    ],
  },
  {
    id: 'ernie-turbo',
    name: 'Ernie Image Turbo',
    description: 'Fast photorealistic generation',
    files: [
      {
        name: 'ernie-image-turbo.safetensors',
        path: 'diffusion_models',
        url: 'https://huggingface.co/Comfy-Org/ERNIE-Image/resolve/main/diffusion_models/ernie-image-turbo.safetensors',
        sizeMb: 13000,
      },
      {
        name: 'ministral-3-3b.safetensors',
        path: 'text_encoders',
        url: 'https://huggingface.co/Comfy-Org/ERNIE-Image/resolve/main/text_encoders/ministral-3-3b.safetensors',
        sizeMb: 6000,
      },
      {
        name: 'ernie-image-prompt-enhancer.safetensors',
        path: 'text_encoders',
        url: 'https://huggingface.co/Comfy-Org/ERNIE-Image/resolve/main/text_encoders/ernie-image-prompt-enhancer.safetensors',
        sizeMb: 1500,
      },
      {
        name: 'flux2-vae.safetensors',
        path: 'vae',
        url: 'https://huggingface.co/Comfy-Org/ERNIE-Image/resolve/main/vae/flux2-vae.safetensors',
        sizeMb: 335,
      },
    ],
  },
  {
    id: 'krea2-turbo',
    name: 'Krea2 Turbo',
    description: 'Fast 8-step Krea2 — the everyday model',
    files: [
      {
        name: 'krea2_turbo_fp8_scaled.safetensors',
        path: 'diffusion_models',
        url: 'https://huggingface.co/Comfy-Org/Krea-2/resolve/main/diffusion_models/krea2_turbo_fp8_scaled.safetensors',
        sizeMb: 12533,
      },
      ...KREA2_SHARED_FILES,
    ],
  },
  {
    id: 'krea2-raw',
    name: 'Krea2 RAW',
    description: 'Full 52-step Krea2 base — slower, highest fidelity',
    files: [
      {
        name: 'krea2_raw_fp8_scaled.safetensors',
        path: 'diffusion_models',
        url: 'https://huggingface.co/Comfy-Org/Krea-2/resolve/main/diffusion_models/krea2_raw_fp8_scaled.safetensors',
        sizeMb: 12533,
      },
      ...KREA2_SHARED_FILES,
    ],
  },
  {
    id: 'z-image-turbo',
    name: 'Z Image Turbo',
    description: 'Fast turbo with optional 1.5× upscale',
    files: [
      {
        name: 'z_image_turbo_bf16.safetensors',
        path: 'diffusion_models',
        url: 'https://huggingface.co/Comfy-Org/z_image_turbo/resolve/main/split_files/diffusion_models/z_image_turbo_bf16.safetensors',
        sizeMb: 12000,
      },
      {
        name: 'qwen_3_4b.safetensors',
        path: 'text_encoders',
        url: 'https://huggingface.co/Comfy-Org/z_image_turbo/resolve/main/split_files/text_encoders/qwen_3_4b.safetensors',
        sizeMb: 8070,
      },
      {
        name: 'ae.safetensors',
        path: 'vae',
        url: 'https://huggingface.co/Comfy-Org/z_image_turbo/resolve/main/split_files/vae/ae.safetensors',
        sizeMb: 335,
      },
    ],
  },
  {
    id: 'sdxl',
    name: 'SDXL',
    description: 'Stable Diffusion XL base 1.0',
    files: [
      {
        name: 'sd_xl_base_1.0.safetensors',
        path: 'checkpoints',
        url: 'https://huggingface.co/stabilityai/stable-diffusion-xl-base-1.0/resolve/main/sd_xl_base_1.0.safetensors',
        sizeMb: 6940,
      },
      SDXL_VAE_FILE,
    ],
  },
  {
    id: 'pony',
    name: 'Pony',
    description: 'Pony Diffusion V6 XL (score_* tags)',
    files: [
      {
        name: 'ponyDiffusionV6XL_v6StartWithThisOne.safetensors',
        path: 'checkpoints',
        url: 'https://huggingface.co/LyliaEngine/Pony_Diffusion_V6_XL/resolve/main/ponyDiffusionV6XL_v6StartWithThisOne.safetensors',
        sizeMb: 6940,
      },
      SDXL_VAE_FILE,
    ],
  },
  {
    id: 'illustrious',
    name: 'Illustrious',
    description: 'Illustrious XL v0.1 (Danbooru anime base)',
    files: [
      {
        name: 'Illustrious-XL-v0.1.safetensors',
        path: 'checkpoints',
        url: 'https://huggingface.co/OnomaAIResearch/Illustrious-xl-early-release-v0/resolve/main/Illustrious-XL-v0.1.safetensors',
        sizeMb: 6940,
      },
      SDXL_VAE_FILE,
    ],
  },
]

// Synthetic preset so the LTX section can reuse the page's download flow + state
// map (keyed `ltx23::<filename>`) without a real PRESETS entry.
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
// by default (face-swap.ts). All hosted on the same Gourieff/ReActor dataset
// ReActor's own installer downloads from; sizes verified against the live
// files 2026-07-17. Presence is detected via ReActorFaceSwap's own dropdowns.
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
]

const FACESWAP_PRESET: PresetDefinition = {
  id: 'faceswap',
  name: 'Face Swap',
  description: 'Hyperswap swap models + GPEN-BFR-1024 face restorer (requires ReActor)',
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

const LOCAL_SUBFOLDERS = [
  { value: 'diffusion_models', label: 'Diffusion models' },
  { value: 'text_encoders', label: 'Text encoders' },
  { value: 'vae', label: 'VAE' },
  { value: 'loras', label: 'LoRAs' },
  { value: 'checkpoints', label: 'Checkpoints' },
  { value: 'controlnet', label: 'ControlNet' },
  { value: 'model_patches', label: 'Model patches (Z-Image ControlNet)' },
  { value: 'ipadapter', label: 'IP-Adapter' },
  { value: 'clip_vision', label: 'CLIP vision (IP-Adapter)' },
  { value: 'ultralytics/bbox', label: 'Ultralytics bbox (detailer)' },
  { value: 'sams', label: 'SAM models (detailer)' },
  { value: 'hyperswap', label: 'Hyperswap (face swap)' },
  { value: 'facerestore_models', label: 'Face restore (face swap)' },
]

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ModelsPage() {
  const [states, setStates] = useState<Record<string, DownloadState>>({})
  const [modelsDir, setModelsDir] = useState<string | null>(null)
  const [detectedPatreon, setDetectedPatreon] = useState<string[]>([])
  const [patreonImports, setPatreonImports] = useState<Record<string, PatreonEntry[]>>({})

  useEffect(() => {
    fetch('/api/models/paths')
      .then((r) => r.json())
      .then((d: { modelsDir: string | null }) => setModelsDir(d.modelsDir))
      .catch(() => {})
  }, [])

  const patchState = (key: string, patch: Partial<DownloadState>) =>
    setStates((s) => ({ ...s, [key]: { ...(s[key] ?? { status: 'idle', progress: 0 }), ...patch } }))

  useEffect(() => {
    const check = async () => {
      const safeFetch = async (url: string) => {
        try { return await (await fetch(url)).json() } catch { return null }
      }
      const [unetData, clipData, vaeData, loraData, ckptData] = await Promise.all([
        safeFetch('/api/comfyui/object_info/UNETLoader'),
        safeFetch('/api/comfyui/object_info/CLIPLoader'),
        safeFetch('/api/comfyui/object_info/VAELoader'),
        safeFetch('/api/comfyui/object_info/LoraLoader'),
        safeFetch('/api/comfyui/object_info/CheckpointLoaderSimple'),
      ])
      const unetNames = comboOptions(unetData, 'UNETLoader', 'unet_name')
      const clipNames = comboOptions(clipData, 'CLIPLoader', 'clip_name')
      const vaeNames  = comboOptions(vaeData,  'VAELoader', 'vae_name')
      const loraNames = comboOptions(loraData, 'LoraLoader', 'lora_name')
      const ckptNames = comboOptions(ckptData, 'CheckpointLoaderSimple', 'ckpt_name')

      const allPresent = [...unetNames, ...clipNames, ...vaeNames, ...ckptNames]
      for (const preset of PRESETS) {
        for (const file of preset.files) {
          const key = `${preset.id}::${file.name}`
          const present = allPresent.some((n) => n === file.name || n.endsWith('/' + file.name))
          patchState(key, { status: present ? 'present' : 'missing', progress: 0 })
        }
      }
      // Patreon models live across loras (muscgi/muscgro) and checkpoints (aria).
      const detected = [...loraNames, ...ckptNames]
        .filter(isPatreonModel)
        .map((n) => n.split('/').pop() ?? n)
      setDetectedPatreon(detected)
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
  const handleDownload = async (preset: PresetDefinition, file: ModelFile) => {
    const key = `${preset.id}::${file.name}`
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

  // These two are also how an import reports its progress: PatreonPanel adds the
  // entry as 'importing' when the copy starts and flips it to 'active' (the file
  // landed — new or replaced) or 'error' when it settles. That is exactly the
  // begin/end pair the restart prompt needs, so imports join the same counter as
  // downloads without an extra prop.
  const addPatreonEntry = (presetId: string, entry: PatreonEntry) => {
    if (entry.status === 'importing') transfers.begin()
    setPatreonImports((prev) => ({ ...prev, [presetId]: [...(prev[presetId] ?? []), entry] }))
  }

  const updatePatreonEntry = (presetId: string, name: string, patch: Partial<PatreonEntry>) => {
    if (patch.status && patch.status !== 'importing') transfers.end(patch.status === 'active')
    setPatreonImports((prev) => ({
      ...prev,
      [presetId]: (prev[presetId] ?? []).map((e) => (e.name === name ? { ...e, ...patch } : e)),
    }))
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
          <p className="text-sm text-muted-foreground mt-1.5">
            Manage your Patreon models, or download a preset to start generating.
          </p>
        </div>
      </div>

      {/* Patreon panel — full width, prominent */}
      <PatreonPanel
        presets={PRESETS}
        modelsDir={modelsDir}
        detectedFiles={detectedPatreon}
        patreonImports={patreonImports}
        onAdd={addPatreonEntry}
        onUpdate={updatePatreonEntry}
      />

      {/* Preset cards — 3-column grid */}
      <div className="space-y-3">
      <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Image Models</h2>
      {/* data-tour: what the first-run tour rings on its Models step — "download
          one of these" is the whole point of the page for a new install. On the
          grid, not the section, so the ring doesn't cut through the heading. */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4" data-tour="/models">
        {PRESETS.map((preset) => (
          <PresetCard
            key={preset.id}
            preset={preset}
            states={states}
            onDownload={(file) => void handleDownload(preset, file)}
            onCancel={(file) => cancelDownload(`${preset.id}::${file.name}`)}
          />
        ))}
      </div>
      </div>

      {/* LTX 2.3 video models */}
      <VideoModelSection
        title="LTX 2.3 (Video)"
        blurb={`Models for the Generate Videos workflow. ${LTX23_ASSETS.filter((a) => !a.url).length} files have no public mirror — import them below (or copy from an existing ComfyUI install).`}
        assets={LTX23_ASSETS}
        keyPrefix={LTX_PRESET.id}
        states={states}
        onDownload={(asset) =>
          void handleDownload(LTX_PRESET, {
            name: asset.name,
            path: asset.folder,
            url: asset.url ?? '',
            sizeMb: asset.sizeMb,
          })
        }
        onCancel={(asset) => cancelDownload(`${LTX_PRESET.id}::${asset.name}`)}
      />

      {/* MiniMax H3 video models */}
      <VideoModelSection
        title="MiniMax H3 (Video)"
        blurb="Video with natively synced stereo audio, 24 fps. The first four files are required — the audio VAE included, or clips come out silent — and total ~42.5 GB; the rest are optional and each unlocks one mode in the video form. Needs ComfyUI 0.30.0 or newer."
        assets={MINIMAX_H3_ASSETS}
        keyPrefix={MINIMAX_H3_PRESET.id}
        states={states}
        onDownload={(asset) =>
          void handleDownload(MINIMAX_H3_PRESET, {
            name: asset.name,
            path: asset.folder,
            url: asset.url ?? '',
            sizeMb: asset.sizeMb,
          })
        }
        onCancel={(asset) => cancelDownload(`${MINIMAX_H3_PRESET.id}::${asset.name}`)}
      />

      {/* ControlNet + IP-Adapter reference models */}
      <AssetSection
        assets={REFERENCE_ASSETS}
        keyPrefix="reference"
        title={REFERENCE_PRESET.name}
        description="ControlNet, IP-Adapter, and the Z-Image Fun ControlNet patch. Needed to enable the ControlNet / IP-Adapter toggles in Generate."
        states={states}
        onDownload={(asset) =>
          void handleDownload(REFERENCE_PRESET, {
            name: asset.name,
            path: asset.path,
            url: asset.url,
            sizeMb: asset.sizeMb,
          })
        }
        onCancel={(asset) => cancelDownload(`${REFERENCE_PRESET.id}::${asset.name}`)}
      />

      {/* Face Detailer models */}
      <AssetSection
        assets={DETAILER_ASSETS}
        keyPrefix="detailer"
        title={DETAILER_PRESET.name}
        description="Models for the Face Detailer stage. Requires ComfyUI Impact Pack + Impact-Subpack."
        states={states}
        onDownload={(asset) =>
          void handleDownload(DETAILER_PRESET, {
            name: asset.name,
            path: asset.path,
            url: asset.url,
            sizeMb: asset.sizeMb,
          })
        }
        onCancel={(asset) => cancelDownload(`${DETAILER_PRESET.id}::${asset.name}`)}
      />

      {/* Face-swap models (hyperswap + GPEN restore) */}
      <AssetSection
        assets={FACESWAP_ASSETS}
        keyPrefix="faceswap"
        title={FACESWAP_PRESET.name}
        description="Hyperswap 256px swap models (1C has the best likeness) and the GPEN-BFR-1024 face restorer the swap chain uses by default. Requires the ReActor node."
        states={states}
        onDownload={(asset) =>
          void handleDownload(FACESWAP_PRESET, {
            name: asset.name,
            path: asset.path,
            url: asset.url,
            sizeMb: asset.sizeMb,
          })
        }
        onCancel={(asset) => cancelDownload(`${FACESWAP_PRESET.id}::${asset.name}`)}
      />

      {/* Krea2 NSFW — the optional heavyweight uncensor model */}
      <AssetSection
        assets={KREA2_NSFW_LORAS}
        keyPrefix={KREA2_NSFW_PRESET.id}
        title={KREA2_NSFW_PRESET.name}
        description="Kroma is a re-trained, uncensored version of Krea2. Optional — the Krea2 models already come with a small uncensor patch that costs you nothing, and that is enough for most prompts. Kroma goes further (more willing, better bodies and skin) but it also changes the look of every image and adds 1.9 GB. Once installed, pick it under NSFW in Generate."
        states={states}
        onDownload={(asset) =>
          void handleDownload(KREA2_NSFW_PRESET, {
            name: asset.name,
            path: asset.path,
            url: asset.url,
            sizeMb: asset.sizeMb,
          })
        }
        onCancel={(asset) => cancelDownload(`${KREA2_NSFW_PRESET.id}::${asset.name}`)}
      />

      {/* Krea2 style LoRAs — optional looks, pick any */}
      <AssetSection
        assets={KREA2_STYLE_LORAS}
        keyPrefix="krea2-styles"
        title={KREA2_STYLE_PRESET.name}
        description="Optional style LoRAs for the Krea2 models. None is required to generate — grab only the looks you want. They show up in the LoRA picker in Generate once installed."
        states={states}
        onDownload={(asset) =>
          void handleDownload(KREA2_STYLE_PRESET, {
            name: asset.name,
            path: asset.path,
            url: asset.url,
            sizeMb: asset.sizeMb,
          })
        }
        onCancel={(asset) => cancelDownload(`${KREA2_STYLE_PRESET.id}::${asset.name}`)}
      />

      {/* ponytail: local-import section hidden (LocalImportSection below); re-render this when it's wanted back */}

      {/* Manage installed models — disk usage + delete */}
      <ManageModelsSection />

      {/* Raised once every started download and import has finished. */}
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

// ─── PresetCard ───────────────────────────────────────────────────────────────

function PresetCard({
  preset,
  states,
  onDownload,
  onCancel,
}: {
  preset: PresetDefinition
  states: Record<string, DownloadState>
  onDownload: (file: ModelFile) => void
  onCancel: (file: ModelFile) => void
}) {
  const missingFiles = preset.files.filter((f) => {
    const s = states[`${preset.id}::${f.name}`]?.status
    return !s || s === 'missing' || s === 'idle'
  })

  return (
    <div className="group rounded-xl border border-border bg-card p-3.5 flex flex-col gap-2.5 transition-colors hover:border-primary/30">
      <div>
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/12 ring-1 ring-primary/20 shrink-0">
            <Package className="h-3.5 w-3.5 text-primary" />
          </div>
          <h2 className="font-heading font-bold text-base tracking-tight">{preset.name}</h2>
        </div>
        <p className="text-xs text-muted-foreground mt-1 leading-snug line-clamp-2">{preset.description}</p>
      </div>

      <div className="flex flex-col gap-1.5 flex-1">
        {preset.files.map((file) => {
          const key = `${preset.id}::${file.name}`
          const state = states[key] ?? { status: 'idle', progress: 0 }
          return (
            <FileRow
              key={key}
              file={file}
              state={state}
              onDownload={() => onDownload(file)}
              onCancel={() => onCancel(file)}
            />
          )
        })}
      </div>

      {missingFiles.length > 0 && (
        <Button
          className="w-full h-8 mt-auto text-sm font-semibold shadow-md shadow-primary/20"
          onClick={() => missingFiles.forEach((f) => onDownload(f))}
        >
          <Download className="h-3.5 w-3.5 mr-1.5" />
          Download all
        </Button>
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
  file: ModelFile
  state: DownloadState
  onDownload: () => void
  onCancel?: () => void
}) {
  const barWidth =
    state.status === 'present' || state.status === 'done' ? 100
    : state.status === 'downloading' ? state.progress
    : 0

  const barColor =
    state.status === 'present' || state.status === 'done' ? 'color-mix(in oklch, #22c55e 70%, transparent)'
    : state.status === 'error' ? 'var(--destructive)'
    : 'var(--action)'

  const icon =
    state.status === 'present' || state.status === 'done' ? (
      <CheckCircle className="h-4 w-4 text-green-500 shrink-0" />
    ) : state.status === 'error' ? (
      <AlertCircle className="h-4 w-4 text-destructive shrink-0" />
    ) : (
      <div className="h-4 w-4 rounded-full border border-muted-foreground/50 shrink-0" />
    )

  return (
    <div className="relative flex items-center gap-2 rounded-lg bg-muted/40 px-2.5 py-1.5 overflow-hidden">
      {icon}
      <div className="flex-1 min-w-0">
        <p className="text-xs font-mono truncate leading-tight">{file.name}</p>
        <p className="text-[11px] text-muted-foreground leading-tight mt-0.5">
          {file.path} · {file.sizeMb >= 1000 ? `${(file.sizeMb / 1000).toFixed(1)} GB` : `${file.sizeMb} MB`}
        </p>
      </div>
      <div className="shrink-0">
        {state.status === 'present' || state.status === 'done' ? (
          <Badge variant="secondary" className="text-[11px] h-5 px-2">Installed</Badge>
        ) : state.status === 'downloading' ? (
          <DownloadingBadge state={state} onCancel={onCancel} />
        ) : (
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={onDownload} title="Download">
            <Download className="h-3.5 w-3.5" />
          </Button>
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

// ─── VideoModelSection ────────────────────────────────────────────────────────

/**
 * One video family's model files. Shared by LTX 2.3 and MiniMax H3 — the two
 * differ only in title, blurb, asset list and state-key prefix, so they render
 * through the same component rather than a copied one.
 */
function VideoModelSection({
  title,
  blurb,
  assets,
  keyPrefix,
  states,
  onDownload,
  onCancel,
}: {
  title: string
  blurb: string
  assets: ModelAsset[]
  keyPrefix: string
  states: Record<string, DownloadState>
  onDownload: (asset: ModelAsset) => void
  onCancel: (asset: ModelAsset) => void
}) {
  const isMissing = (a: ModelAsset) => {
    const s = states[`${keyPrefix}::${a.name}`]?.status
    return !s || s === 'missing' || s === 'idle'
  }
  // Only files with a verified public URL can be fetched here; the rest are
  // imported manually via the section below.
  const downloadableMissing = assets.filter((a) => a.url && isMissing(a))
  const totalGb = downloadableMissing.reduce((n, a) => n + a.sizeMb, 0) / 1000

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">{title}</h2>
          <p className="text-xs text-muted-foreground mt-1">{blurb}</p>
        </div>
        {downloadableMissing.length > 0 && (
          <Button
            className="h-9 font-semibold shadow-md shadow-primary/20 shrink-0"
            onClick={() => downloadableMissing.forEach((a) => onDownload(a))}
          >
            <Download className="h-4 w-4 mr-2" />
            Download available ({downloadableMissing.length} · {totalGb.toFixed(1)} GB)
          </Button>
        )}
      </div>

      <div className="rounded-xl border border-border bg-card p-4 grid grid-cols-1 md:grid-cols-2 gap-2">
        {assets.map((asset) => (
          <LtxAssetRow
            key={asset.name}
            asset={asset}
            state={states[`${keyPrefix}::${asset.name}`] ?? { status: 'idle', progress: 0 }}
            onDownload={() => onDownload(asset)}
            onCancel={() => onCancel(asset)}
          />
        ))}
      </div>
    </div>
  )
}

function LtxAssetRow({
  asset,
  state,
  onDownload,
  onCancel,
}: {
  asset: ModelAsset
  state: DownloadState
  onDownload: () => void
  onCancel?: () => void
}) {
  const installed = state.status === 'present' || state.status === 'done'
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
        <p className="text-xs font-mono truncate leading-tight">{asset.name}</p>
        <p className="text-[11px] text-muted-foreground leading-tight mt-0.5 truncate">
          {asset.folder} · {asset.sizeMb >= 1000 ? `${(asset.sizeMb / 1000).toFixed(1)} GB` : `${asset.sizeMb} MB`}
          {!asset.url && <span> · {asset.source}</span>}
        </p>
      </div>
      <div className="shrink-0">
        {installed ? (
          <Badge variant="secondary" className="text-[11px] h-5 px-2">Installed</Badge>
        ) : state.status === 'downloading' ? (
          <DownloadingBadge state={state} onCancel={onCancel} />
        ) : asset.url ? (
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={onDownload} title="Download">
            <Download className="h-3.5 w-3.5" />
          </Button>
        ) : (
          <Badge variant="outline" className="text-[11px] h-5 px-2" title={asset.source}>Manual</Badge>
        )}
      </div>

      <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-muted/20">
        <div
          className="h-full transition-all duration-300 ease-out"
          style={{ width: `${barWidth}%`, backgroundColor: barColor }}
        />
      </div>
    </div>
  )
}

// ─── DetailerSection ──────────────────────────────────────────────────────────

// Renders a grid of downloadable assets (detailer, ControlNet/IP-Adapter) with a
// "Download all" action. Presence keys are `${keyPrefix}::${asset.name}`, matching
// the per-section availability probes above.
function AssetSection({
  assets,
  keyPrefix,
  title,
  description,
  states,
  onDownload,
  onCancel,
}: {
  assets: DetailerAsset[]
  keyPrefix: string
  title: string
  description: string
  states: Record<string, DownloadState>
  onDownload: (asset: DetailerAsset) => void
  onCancel: (asset: DetailerAsset) => void
}) {
  const missingDownloadable = assets.filter((a) => {
    const s = states[`${keyPrefix}::${a.name}`]?.status
    return !s || s === 'missing' || s === 'idle'
  })

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">{title}</h2>
          <p className="text-xs text-muted-foreground mt-1">{description}</p>
        </div>
        {missingDownloadable.length > 0 && (
          <Button
            className="h-9 font-semibold shadow-md shadow-primary/20 shrink-0"
            onClick={() => missingDownloadable.forEach((a) => onDownload(a))}
          >
            <Download className="h-4 w-4 mr-2" />
            Download all ({missingDownloadable.length})
          </Button>
        )}
      </div>

      <div className="rounded-xl border border-border bg-card p-4 grid grid-cols-1 md:grid-cols-2 gap-2">
        {assets.map((asset) => {
          const state = states[`${keyPrefix}::${asset.name}`] ?? { status: 'idle', progress: 0 }
          const installed = state.status === 'present' || state.status === 'done'
          const barWidth = installed ? 100 : state.status === 'downloading' ? state.progress : 0
          const barColor = installed
            ? 'color-mix(in oklch, #22c55e 70%, transparent)'
            : state.status === 'error' ? 'var(--destructive)' : 'var(--action)'
          return (
            <div key={asset.name} className="relative flex items-center gap-2 rounded-lg bg-muted/40 px-2.5 py-1.5 overflow-hidden">
              {installed ? (
                <CheckCircle className="h-4 w-4 text-green-500 shrink-0" />
              ) : state.status === 'error' ? (
                <AlertCircle className="h-4 w-4 text-destructive shrink-0" />
              ) : (
                <div className="h-4 w-4 rounded-full border border-muted-foreground/50 shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <p className="text-xs font-mono truncate leading-tight">{asset.name}</p>
                <p className="text-[11px] text-muted-foreground leading-tight mt-0.5">
                  {asset.path} · {asset.sizeMb >= 1000 ? `${(asset.sizeMb / 1000).toFixed(1)} GB` : `${asset.sizeMb} MB`}
                </p>
              </div>
              <div className="shrink-0">
                {installed ? (
                  <Badge variant="secondary" className="text-[11px] h-5 px-2">Installed</Badge>
                ) : state.status === 'downloading' ? (
                  <DownloadingBadge state={state} onCancel={() => onCancel(asset)} />
                ) : (
                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => onDownload(asset)} title="Download">
                    <Download className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
              <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-muted/20">
                <div className="h-full transition-all duration-300 ease-out" style={{ width: `${barWidth}%`, backgroundColor: barColor }} />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── PatreonPanel ─────────────────────────────────────────────────────────────

function PatreonPanel({
  presets,
  modelsDir,
  detectedFiles,
  patreonImports,
  onAdd,
  onUpdate,
}: {
  presets: PresetDefinition[]
  modelsDir: string | null
  detectedFiles: string[]
  patreonImports: Record<string, PatreonEntry[]>
  onAdd: (presetId: string, entry: PatreonEntry) => void
  onUpdate: (presetId: string, name: string, patch: Partial<PatreonEntry>) => void
}) {
  const [activeId, setActiveId] = useState(presets[0].id)
  const [validationError, setValidationError] = useState<string | null>(null)
  const [localPath, setLocalPath] = useState('')

  // Flatten this session's imports (across all tabs) and merge with models already
  // present in ComfyUI, deduped by filename. Then keep only those matching the
  // active family's keywords, so each tab shows just its own checkpoints/loras.
  const byName = new Map<string, PatreonEntry>()
  for (const e of Object.values(patreonImports).flat()) byName.set(e.name, e)
  for (const n of detectedFiles) {
    if (!byName.has(n)) byName.set(n, { name: n, subfolder: patreonSubfolder(n), status: 'active' })
  }
  const combined = [...byName.values()].filter((e) => matchesPatreonPreset(e.name, activeId))

  const importByName = async (filename: string, doImport: (subfolder: string) => Promise<{ ok?: boolean; replaced?: boolean; error?: string; name?: string }>) => {
    setValidationError(null)
    const lname = filename.toLowerCase()
    if (!lname.endsWith('.safetensors')) {
      setValidationError('Only .safetensors files are supported.')
      return
    }
    if (!PATREON_PATTERNS.some((p) => lname.includes(p))) {
      setValidationError('Filename must contain "muscgi", "muscgro", or "aria".')
      return
    }
    if (combined.some((e) => e.name === filename)) {
      setValidationError(`${filename} is already listed.`)
      return
    }

    const subfolder = patreonSubfolder(filename)
    const entry: PatreonEntry = { name: filename, subfolder, status: 'importing' }
    onAdd(activeId, entry)

    try {
      const json = await doImport(subfolder)
      onUpdate(activeId, filename, { status: 'active' })
      toast.success(`${filename} ${json.replaced ? 'replaced' : 'imported'}`)
    } catch (e) {
      onUpdate(activeId, filename, { status: 'error', error: String(e) })
      toast.error(`Import failed: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  // Import a model the server can read directly via its path — copy-local streams
  // the file (fs.copyFile), so this works for multi-GB models with no upload.
  const importFromPath = (fullPath: string) => {
    const filename = fullPath.split(/[/\\]/).pop() ?? fullPath
    void importByName(filename, async (subfolder) => {
      const res = await fetch('/api/models/copy-local', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourcePath: fullPath, subfolder }),
      })
      const json = (await res.json()) as { ok?: boolean; replaced?: boolean; error?: string; name?: string }
      if (!res.ok) throw new Error(json.error ?? res.statusText)
      return json
    })
  }

  const handleLocalPath = () => {
    const trimmed = localPath.trim()
    if (!trimmed) return
    importFromPath(trimmed)
    setLocalPath('')
  }

  // Open a native OS file dialog (server-side) so non-technical users can browse
  // and pick a model file. Returns a real path, which copy-local then imports.
  const handleBrowse = async () => {
    if (!modelsDir) {
      toast.error('Set COMFYUI_MODELS_DIR in .env.local to enable imports')
      return
    }
    try {
      const res = await fetch('/api/models/pick-file', { method: 'POST' })
      const json = (await res.json()) as { path?: string | null; error?: string }
      if (!res.ok) throw new Error(json.error ?? res.statusText)
      if (json.path) importFromPath(json.path) // null = cancelled
    } catch (e) {
      toast.error(`Could not open file picker: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  return (
    <div className="rounded-xl border border-primary/25 bg-primary/[0.04]">

      {/* Panel header */}
      <div className="flex items-start gap-4 px-6 py-5 border-b border-primary/15">
        <div className="h-11 w-11 rounded-xl bg-primary/15 border border-primary/25 flex items-center justify-center shrink-0 mt-0.5">
          <Lock className="h-5 w-5 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="font-heading font-bold text-lg tracking-tight">Patreon Models</h2>
          <p className="text-sm text-muted-foreground mt-1 leading-relaxed">
            Exclusive models provided via Patreon. Accepted filenames contain{' '}
            <code className="text-xs text-primary/90">muscgi</code>,{' '}
            <code className="text-xs text-primary/90">muscgro</code>, or{' '}
            <code className="text-xs text-primary/90">aria</code>.
          </p>
          {/* Import controls — subfolder is derived from filename automatically */}
          <div className="flex items-center gap-2 mt-3 flex-wrap">
            {/* Local path (recommended for large files — no browser upload needed) */}
            <input
              type="text"
              value={localPath}
              onChange={(e) => { setLocalPath(e.target.value); setValidationError(null) }}
              onKeyDown={(e) => { if (e.key === 'Enter') handleLocalPath() }}
              placeholder="/home/…/aria_model.safetensors"
              className="h-8 w-80 rounded-md border border-primary/30 bg-background px-3 text-xs font-mono placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-primary/50"
            />
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5 h-8 border-primary/30 text-primary hover:bg-primary/10 hover:text-primary hover:border-primary/50"
              disabled={!localPath.trim()}
              onClick={() => {
                if (!modelsDir) {
                  toast.error('Set COMFYUI_MODELS_DIR in .env.local to enable imports')
                  return
                }
                handleLocalPath()
              }}
            >
              <Upload className="h-3.5 w-3.5" />
              Import from path
            </Button>
            {/* Browse the OS file explorer (native dialog) and import the chosen file */}
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5 h-8 border-primary/30 text-primary hover:bg-primary/10 hover:text-primary hover:border-primary/50"
              onClick={() => void handleBrowse()}
            >
              <FolderOpen className="h-3.5 w-3.5" />
              Import File
            </Button>
          </div>
        </div>
      </div>

      {/* Preset tabs */}
      <div className="flex gap-0 border-b border-primary/15 px-5">
        {presets.map((p) => (
          <button
            key={p.id}
            onClick={() => setActiveId(p.id)}
            className={`px-5 py-3 text-base font-semibold transition-colors border-b-2 -mb-px ${
              activeId === p.id
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
            }`}
          >
            {p.name}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="p-5 space-y-3">
        {validationError && (
          <p className="text-xs text-destructive">{validationError}</p>
        )}
        {!modelsDir && (
          <p className="text-xs text-primary/70">
            Set <code>COMFYUI_MODELS_DIR</code> in <code>.env.local</code> to enable import.
          </p>
        )}

        {combined.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 gap-2 text-muted-foreground/50">
            <Lock className="h-8 w-8 opacity-30" />
            <p className="text-sm">No Patreon models imported yet for {presets.find((p) => p.id === activeId)?.name}.</p>
            <p className="text-xs">Paste the file path above and click Import, or use Upload file.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
            {combined.map((entry) => (
              <PatreonFileRow key={entry.name} entry={entry} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── PatreonFileRow ───────────────────────────────────────────────────────────

function PatreonFileRow({
  entry,
}: {
  entry: { name: string; subfolder: string; status: string; error?: string }
}) {
  return (
    <div className="relative flex items-center gap-2.5 rounded-lg border border-primary/15 bg-primary/[0.03] px-3 py-2.5 overflow-hidden">
      {entry.status === 'importing' ? (
        <div className="h-4 w-4 rounded-full border-2 border-primary border-t-transparent animate-spin shrink-0" />
      ) : entry.status === 'active' ? (
        <CheckCircle className="h-4 w-4 text-green-400 shrink-0" />
      ) : (
        <AlertCircle className="h-4 w-4 text-destructive shrink-0" />
      )}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-mono truncate">{entry.name}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{entry.subfolder}</p>
        {entry.status === 'error' && entry.error && (
          <p className="text-xs text-destructive">{entry.error}</p>
        )}
      </div>
      <div className="flex flex-col items-end gap-1 shrink-0">
        {entry.status === 'active' && (
          <Badge className="text-[11px] h-5 px-2 bg-green-500/15 text-green-400 border-green-500/20 border">
            Active
          </Badge>
        )}
        <Badge className="text-[11px] h-5 px-2 bg-primary/15 text-primary border-primary/20 border">
          Patreon
        </Badge>
      </div>

      {/* Thin bar */}
      <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-primary/10">
        {entry.status === 'active' && (
          <div className="h-full w-full" style={{ backgroundColor: '#22c55e88' }} />
        )}
        {entry.status === 'importing' && (
          <div className="h-full w-1/3 animate-pulse bg-primary/60" />
        )}
      </div>
    </div>
  )
}

// ─── LocalImportSection ───────────────────────────────────────────────────────

interface ImportResult {
  name: string
  status: 'importing' | 'done' | 'replaced' | 'error'
  error?: string
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- kept, just not rendered (see above)
function LocalImportSection({ modelsDir }: { modelsDir: string | null }) {
  const [open, setOpen] = useState(false)
  const [subfolder, setSubfolder] = useState('diffusion_models')
  const [results, setResults] = useState<ImportResult[]>([])
  const [localPath, setLocalPath] = useState('')
  const [copyStatus, setCopyStatus] = useState<ImportResult | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const handleFiles = async (files: FileList) => {
    const arr = Array.from(files)
    setResults(arr.map((f) => ({ name: f.name, status: 'importing' as const })))
    await Promise.all(
      arr.map(async (file, i) => {
        const fd = new FormData()
        fd.append('file', file)
        fd.append('subfolder', subfolder)
        try {
          const res = await fetch('/api/models/import', { method: 'POST', body: fd })
          const json = (await res.json()) as { ok?: boolean; replaced?: boolean; error?: string }
          if (!res.ok) throw new Error(json.error ?? res.statusText)
          setResults((prev) => {
            const next = [...prev]
            next[i] = { name: file.name, status: json.replaced ? 'replaced' : 'done' }
            return next
          })
          toast.success(`${file.name} ${json.replaced ? 'replaced' : 'imported'}`)
        } catch (e) {
          setResults((prev) => {
            const next = [...prev]
            next[i] = { name: file.name, status: 'error', error: String(e) }
            return next
          })
          toast.error(`Failed to import ${file.name}`)
        }
      })
    )
  }

  const handleCopyLocal = useCallback(async () => {
    const trimmed = localPath.trim()
    if (!trimmed) return
    const name = trimmed.split('/').pop() ?? trimmed
    setCopyStatus({ name, status: 'importing' })
    try {
      const res = await fetch('/api/models/copy-local', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourcePath: trimmed, subfolder }),
      })
      const json = (await res.json()) as { ok?: boolean; replaced?: boolean; error?: string; name?: string }
      if (!res.ok) throw new Error(json.error ?? res.statusText)
      setCopyStatus({ name: json.name ?? name, status: json.replaced ? 'replaced' : 'done' })
      toast.success(`${json.name ?? name} ${json.replaced ? 'replaced' : 'copied'}`)
      setLocalPath('')
    } catch (e) {
      setCopyStatus({ name, status: 'error', error: String(e) })
      toast.error(`Copy failed: ${e instanceof Error ? e.message : String(e)}`)
    }
  }, [localPath, subfolder])

  return (
    <div className="rounded-lg border border-border bg-card">
      <button
        className="w-full flex items-center justify-between px-4 py-3 text-left"
        onClick={() => setOpen((v) => !v)}
      >
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <FolderOpen className="h-3.5 w-3.5" />
          <span>Import any local model file</span>
        </div>
        {open ? (
          <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
        )}
      </button>

      {open && (
        <div className="border-t border-border px-4 py-4 space-y-4">
          {!modelsDir ? (
            <p className="text-xs text-primary">
              Set <code>COMFYUI_MODELS_DIR</code> in <code>.env.local</code> to enable.
            </p>
          ) : (
            <>
              <div className="flex items-center gap-3">
                <Select value={subfolder} onValueChange={(v) => { if (v) setSubfolder(v) }}>
                  <SelectTrigger className="h-8 text-sm w-56">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LOCAL_SUBFOLDERS.map((s) => (
                      <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs font-mono text-muted-foreground truncate">
                  → {modelsDir}/{subfolder}/
                </p>
              </div>

              {/* Local path copy — for large files that can't be uploaded via browser */}
              <div className="space-y-1.5">
                <p className="text-xs text-muted-foreground">Copy from local path (recommended for large files):</p>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={localPath}
                    onChange={(e) => { setLocalPath(e.target.value); setCopyStatus(null) }}
                    onKeyDown={(e) => { if (e.key === 'Enter') void handleCopyLocal() }}
                    placeholder="/home/user/Downloads/model.safetensors"
                    className="flex-1 h-8 rounded-md border border-input bg-background px-3 text-xs font-mono placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5 shrink-0"
                    disabled={!localPath.trim() || copyStatus?.status === 'importing'}
                    onClick={() => void handleCopyLocal()}
                  >
                    {copyStatus?.status === 'importing' ? (
                      <div className="h-3.5 w-3.5 rounded-full border-2 border-primary border-t-transparent animate-spin" />
                    ) : (
                      <Upload className="h-3.5 w-3.5" />
                    )}
                    Copy
                  </Button>
                </div>
                {copyStatus && copyStatus.status !== 'importing' && (
                  <div className="flex items-center gap-2 text-xs pt-0.5">
                    {(copyStatus.status === 'done' || copyStatus.status === 'replaced') ? (
                      <CheckCircle className="h-3 w-3 text-green-500 shrink-0" />
                    ) : (
                      <AlertCircle className="h-3 w-3 text-destructive shrink-0" />
                    )}
                    <span className="font-mono truncate">{copyStatus.name}</span>
                    {copyStatus.status === 'replaced' && <Badge variant="outline" className="text-[10px] h-4 px-1">Replaced</Badge>}
                    {copyStatus.status === 'done' && <Badge variant="secondary" className="text-[10px] h-4 px-1">Copied</Badge>}
                    {copyStatus.status === 'error' && <span className="text-destructive">{copyStatus.error}</span>}
                  </div>
                )}
              </div>

              {/* Browser file upload — limited to small files by browser/server constraints */}
              <div className="space-y-1.5">
                <p className="text-xs text-muted-foreground">Or upload via browser (small files only):</p>
                <input
                  ref={fileRef}
                  type="file"
                  multiple
                  accept=".safetensors,.ckpt,.pt,.bin,.gguf,.pth"
                  className="hidden"
                  onChange={(e) => { if (e.target.files?.length) void handleFiles(e.target.files) }}
                />
                <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()} className="gap-1.5">
                  <Upload className="h-3.5 w-3.5" />
                  Choose files…
                </Button>
              </div>

              {results.length > 0 && (
                <div className="space-y-1">
                  {results.map((r, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs">
                      {r.status === 'importing' && (
                        <div className="h-3 w-3 rounded-full border-2 border-primary border-t-transparent animate-spin shrink-0" />
                      )}
                      {(r.status === 'done' || r.status === 'replaced') && (
                        <CheckCircle className="h-3 w-3 text-green-500 shrink-0" />
                      )}
                      {r.status === 'error' && <AlertCircle className="h-3 w-3 text-destructive shrink-0" />}
                      <span className="font-mono truncate">{r.name}</span>
                      {r.status === 'replaced' && <Badge variant="outline" className="text-[10px] h-4 px-1">Replaced</Badge>}
                      {r.status === 'done' && <Badge variant="secondary" className="text-[10px] h-4 px-1">Imported</Badge>}
                      {r.status === 'error' && <span className="text-destructive">{r.error}</span>}
                    </div>
                  ))}
                  <p className="text-xs text-muted-foreground pt-1">Restart ComfyUI for new files to appear.</p>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ─── ManageModelsSection ────────────────────────────────────────────────────────

interface DiskFile { name: string; path: string; sizeBytes: number; mtime: string }
interface DiskGroup { subfolder: string; sizeBytes: number; count: number; files: DiskFile[] }
interface DiskUsage { modelsDir: string | null; total: { sizeBytes: number; count: number }; subfolders: DiskGroup[] }

function fmtBytes(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)} GB`
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)} MB`
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)} KB`
  return `${n} B`
}

function ManageModelsSection() {
  const [open, setOpen] = useState(false)
  const [usage, setUsage] = useState<DiskUsage | null>(null)
  const [loading, setLoading] = useState(false)
  const [pending, setPending] = useState<DiskFile | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/models/disk-usage', { cache: 'no-store' })
      setUsage((await res.json()) as DiskUsage)
    } catch { toast.error('Could not read disk usage') }
    finally { setLoading(false) }
  }, [])

  // eslint-disable-next-line react-hooks/set-state-in-effect -- lazy-load disk usage the first time the section opens
  useEffect(() => { if (open && !usage) void refresh() }, [open, usage, refresh])

  const doDelete = async (file: DiskFile) => {
    try {
      const res = await fetch('/api/models/delete', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: file.path }),
      })
      if (!res.ok) throw new Error(await res.text())
      toast.success(`Deleted ${file.name}`)
      await refresh()
    } catch (e) {
      toast.error(`Delete failed: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  return (
    <div className="rounded-lg border border-border bg-card">
      <button className="w-full flex items-center justify-between px-4 py-3 text-left" onClick={() => setOpen((v) => !v)}>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <HardDrive className="h-3.5 w-3.5" />
          <span>Manage installed models{usage && ` · ${fmtBytes(usage.total.sizeBytes)} across ${usage.total.count} files`}</span>
        </div>
        {open ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />}
      </button>

      {open && (
        <div className="border-t border-border px-4 py-4 space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">Files are read straight from disk. Restart ComfyUI for changes to take effect.</p>
            <Button size="sm" variant="outline" className="h-8 gap-1.5" disabled={loading} onClick={() => void refresh()}>
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
            </Button>
          </div>

          {!usage?.modelsDir ? (
            <p className="text-xs text-primary">Set <code>COMFYUI_MODELS_DIR</code> in <code>.env.local</code> to enable.</p>
          ) : usage.subfolders.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No model files found.</p>
          ) : (
            usage.subfolders.map((group) => (
              <div key={group.subfolder} className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{group.subfolder}</h3>
                  <span className="text-xs text-muted-foreground tabular-nums">{fmtBytes(group.sizeBytes)} · {group.count}</span>
                </div>
                <div className="space-y-1">
                  {group.files.map((file) => (
                    <div key={file.path} className="flex items-center gap-2 rounded-lg bg-muted/40 px-2.5 py-1.5">
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-mono truncate">{file.name}</p>
                      </div>
                      <span className="text-[11px] text-muted-foreground tabular-nums shrink-0">{fmtBytes(file.sizeBytes)}</span>
                      <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive shrink-0"
                        title="Delete" onClick={() => setPending(file)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      <ConfirmDialog
        open={pending !== null} onOpenChange={(v) => { if (!v) setPending(null) }}
        title={pending ? `Delete ${pending.name}?` : ''}
        description={pending ? `This permanently removes ${fmtBytes(pending.sizeBytes)} from disk and cannot be undone.` : ''}
        confirmLabel="Delete" destructive
        onConfirm={() => { if (pending) void doDelete(pending); setPending(null) }}
      />
    </div>
  )
}
