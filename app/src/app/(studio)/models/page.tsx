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
import { LTX23_ASSETS, ltxAssetInstalled, type Ltx23Asset } from '@/lib/models/ltx23-assets'

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

const PRESETS: PresetDefinition[] = [
  {
    id: 'anima',
    name: 'Anima',
    description: 'Anime-style text-to-image',
    files: [
      {
        name: 'anima-base-v1.0.safetensors',
        path: 'diffusion_models',
        url: 'https://huggingface.co/circlestone-labs/Anima/resolve/main/split_files/diffusion_models/anima-preview3-base.safetensors',
        sizeMb: 3200,
      },
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
      type ObjInfo = Record<string, { input?: { required?: Record<string, [string[]]> } }>
      const unetNames: string[] = (unetData as ObjInfo)?.UNETLoader?.input?.required?.unet_name?.[0] ?? []
      const clipNames: string[] = (clipData as ObjInfo)?.CLIPLoader?.input?.required?.clip_name?.[0] ?? []
      const vaeNames: string[]  = (vaeData  as ObjInfo)?.VAELoader?.input?.required?.vae_name?.[0]  ?? []
      const loraNames: string[] = (loraData as ObjInfo)?.LoraLoader?.input?.required?.lora_name?.[0] ?? []
      const ckptNames: string[] = (ckptData as ObjInfo)?.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[0] ?? []

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
      const [ckpt, lora, vae, clip, latent] = await Promise.all([
        safeFetch('/api/comfyui/object_info/CheckpointLoaderSimple'),
        safeFetch('/api/comfyui/object_info/LoraLoader'),
        safeFetch('/api/comfyui/object_info/VAELoader'),
        safeFetch('/api/comfyui/object_info/CLIPLoader'),
        safeFetch('/api/comfyui/object_info/LatentUpscaleModelLoader'),
      ])
      type ObjInfo = Record<string, { input?: { required?: Record<string, [string[]]> } }>
      const pick = (d: unknown, node: string, field: string): string[] =>
        (d as ObjInfo)?.[node]?.input?.required?.[field]?.[0] ?? []
      const available = new Set<string>([
        ...pick(ckpt, 'CheckpointLoaderSimple', 'ckpt_name'),
        ...pick(lora, 'LoraLoader', 'lora_name'),
        ...pick(vae, 'VAELoader', 'vae_name'),
        ...pick(clip, 'CLIPLoader', 'clip_name'),
        ...pick(latent, 'LatentUpscaleModelLoader', 'model_name'),
      ])
      for (const asset of LTX23_ASSETS) {
        patchState(`ltx23::${asset.name}`, {
          status: ltxAssetInstalled(asset.name, available) ? 'present' : 'missing',
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
        type ObjInfo = Record<string, { input?: { required?: Record<string, [string[]]> } }>
        const names: string[] = (data as ObjInfo)?.[asset.nodeClass]?.input?.required?.[asset.fieldName]?.[0] ?? []
        const installed = names.some((n) => n === asset.name || n.endsWith('/' + asset.name))
        patchState(`detailer::${asset.name}`, { status: installed ? 'present' : 'missing', progress: 0 })
      }
    }
    void checkDetailer()
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
          type ObjInfo = Record<string, { input?: { required?: Record<string, [string[]]> } }>
          const names: string[] = (data as ObjInfo)?.[asset.nodeClass]?.input?.required?.[asset.fieldName]?.[0] ?? []
          const installed = names.some((n) => n === asset.name || n.endsWith('/' + asset.name))
          patchState(`${prefix}::${asset.name}`, { status: installed ? 'present' : 'missing', progress: 0 })
        }
      }
    }
    void checkReference()
  }, [])

  // In-flight downloads by state key; aborting one cancels its fetch, which the
  // server sees as a stream teardown and answers by killing the upstream
  // request and deleting the partial .tmp file.
  const aborters = useRef(new Map<string, AbortController>())
  const cancelDownload = (key: string) => aborters.current.get(key)?.abort()

  const handleDownload = async (preset: PresetDefinition, file: ModelFile) => {
    const key = `${preset.id}::${file.name}`
    const ctrl = new AbortController()
    aborters.current.set(key, ctrl)
    patchState(key, { status: 'downloading', progress: 0, received: 0, total: 0 })
    toast.info(`Downloading ${file.name}…`)
    try {
      const res = await fetch('/api/models/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: file.url, path: file.path, name: file.name }),
        signal: ctrl.signal,
      })
      if (!res.ok) throw new Error(await res.text())
      if (!res.body) throw new Error('No response stream')

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const ev = JSON.parse(line.slice(6)) as {
              type: string; value?: number; receivedBytes?: number; totalBytes?: number; message?: string
            }
            if (ev.type === 'progress') {
              patchState(key, {
                progress: ev.value ?? 0,
                received: ev.receivedBytes,
                total: ev.totalBytes,
              })
            } else if (ev.type === 'done') {
              patchState(key, { status: 'done', progress: 100 })
              toast.success(`${file.name} downloaded`)
            } else if (ev.type === 'error') {
              throw new Error(ev.message ?? 'Unknown error')
            }
          } catch (e) { if (e instanceof SyntaxError) continue; throw e }
        }
      }
    } catch (e) {
      if (ctrl.signal.aborted) {
        patchState(key, { status: 'missing', progress: 0 })
        toast.info(`Cancelled ${file.name}`)
      } else {
        patchState(key, { status: 'error', error: String(e) })
        toast.error(`Download failed: ${e instanceof Error ? e.message : String(e)}`)
      }
    } finally {
      aborters.current.delete(key)
    }
  }

  const addPatreonEntry = (presetId: string, entry: PatreonEntry) =>
    setPatreonImports((prev) => ({ ...prev, [presetId]: [...(prev[presetId] ?? []), entry] }))

  const updatePatreonEntry = (presetId: string, name: string, patch: Partial<PatreonEntry>) =>
    setPatreonImports((prev) => ({
      ...prev,
      [presetId]: (prev[presetId] ?? []).map((e) => (e.name === name ? { ...e, ...patch } : e)),
    }))

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
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
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
      <LtxVideoSection
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

      {/* ponytail: local-import section hidden (LocalImportSection below); re-render this when it's wanted back */}

      {/* Manage installed models — disk usage + delete */}
      <ManageModelsSection />
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

// ─── LtxVideoSection ──────────────────────────────────────────────────────────

function LtxVideoSection({
  states,
  onDownload,
  onCancel,
}: {
  states: Record<string, DownloadState>
  onDownload: (asset: Ltx23Asset) => void
  onCancel: (asset: Ltx23Asset) => void
}) {
  const isMissing = (a: Ltx23Asset) => {
    const s = states[`ltx23::${a.name}`]?.status
    return !s || s === 'missing' || s === 'idle'
  }
  // Only files with a verified public URL can be fetched here; the rest are
  // imported manually via the section below.
  const downloadableMissing = LTX23_ASSETS.filter((a) => a.url && isMissing(a))
  const manualCount = LTX23_ASSETS.filter((a) => !a.url).length

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">LTX 2.3 (Video)</h2>
          <p className="text-xs text-muted-foreground mt-1">
            Models for the Generate Videos workflow. {manualCount} files have no public mirror — import
            them below (or copy from an existing ComfyUI install).
          </p>
        </div>
        {downloadableMissing.length > 0 && (
          <Button
            className="h-9 font-semibold shadow-md shadow-primary/20 shrink-0"
            onClick={() => downloadableMissing.forEach((a) => onDownload(a))}
          >
            <Download className="h-4 w-4 mr-2" />
            Download available ({downloadableMissing.length})
          </Button>
        )}
      </div>

      <div className="rounded-xl border border-border bg-card p-4 grid grid-cols-1 md:grid-cols-2 gap-2">
        {LTX23_ASSETS.map((asset) => (
          <LtxAssetRow
            key={asset.name}
            asset={asset}
            state={states[`ltx23::${asset.name}`] ?? { status: 'idle', progress: 0 }}
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
  asset: Ltx23Asset
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
