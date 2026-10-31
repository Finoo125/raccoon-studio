'use client'

import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Shuffle, RotateCcw, Wand2, Loader2, Sparkles, Maximize2, Square, ScanFace, Plus, LayoutGrid, SlidersHorizontal, Pencil } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { workflows } from '@/lib/workflows'
import { FUN_MODEL, QWEN21_FUN_MODEL } from '@/lib/workflows/zimage-controlnet'
import { SDXL_FIX_VAE } from '@/lib/workflows/sdxl'
import {
  KREA2_REFUSAL_LORA, KREA2_PROJECTOR_LORA, KREA2_PROJECTOR_DEFAULT, KREA2_PROJECTOR_ON,
  KREA2_KROMA_LORA, KREA2_KROMA_DEFAULT,
} from '@/lib/workflows/krea2'
import {
  QWEN21_PE_T2I, QWEN21_BFS_LORAS, QWEN21_EDIT_SLOTS, toggleEditChip, qwen21EditProblem, editUploadName,
  qwen21EditLinkPatch, bfsVariantFor, jobBatchSize, pickEditTask, headSwapChipDisabled, type EditChip,
} from '@/lib/workflows/qwen21'
import { ERNIE_ENHANCER } from '@/lib/workflows/ernie-turbo'
import { switchPresetParams } from '@/lib/generation/preset-switch'
import { PRESET_GROUPS } from '@/lib/workflows/preset-families'
import { FACE_SWAP_NODE, PIXEL_BOOST_NODE } from '@/lib/workflows/face-swap'
import { comboOptions, presetAvailable, fileInstalled, withoutPresetModels } from '@/lib/models/installed'
import { effectiveAriaModel } from '@/lib/models/patreon'
import { visibleForFamily, type LoraFamily } from '@/lib/models/lora-family'
import { DEFAULT_LORA_PARAMS, MAX_LORAS, FREE_LORA_SLOTS, LORA_STACK_ACK_KEY } from '@/lib/workflows/lora-chain'
import { negativePromptApplies } from '@/lib/workflows/expert-sampler'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import { useQueueStore } from '@/lib/comfyui/queue'
import { submitPrompt } from '@/lib/comfyui/submit'
import { useStudioStore } from '@/lib/generation/studio-store'
import LoraSelector from './LoraSelector'
import FaceSwapInput from './FaceSwapInput'
import BaseImageInput from './BaseImageInput'
import EditPicturesInput from './EditPicturesInput'
import ControlNetInput from './ControlNetInput'
import IpAdapterInput from './IpAdapterInput'
import { InfoTip, Knob, SwitchTile, TileBody } from './SwitchTile'
import type { MaskBrushHandle } from './MaskBrush'
import PromptPresets from './PromptPresets'
import WildcardManager from './WildcardManager'
import PromptHelperDialog, { PromptHelperButton } from './PromptHelper'
import { expandWildcards, hasWildcards } from '@/lib/prompts/wildcards-expand'
import { promptLengthWarning } from '@/lib/workflows/z-image-turbo'
import { uploadImageBlob, uploadImageFromUrl } from '@/lib/generation/upload'
import type { WildcardLists } from '@/lib/prompts/store'
import type { GenerationParams, LoraParam, WorkflowDefinition } from '@/types/workflow'
import { parseGalleryLoras } from '@/lib/gallery/lora-transfer'
import { presetOnlyLink } from '@/lib/workflows/generate-link'
import { presetStamp } from '@/lib/gallery/reuse-settings'
import DownloadModelButton from '@/components/setup/DownloadModelButton'
import { STARTER_MODELS, starterFor } from '@/lib/models/starter'
import { preferredPreset } from '@/lib/workflows/preferred-preset'
import { useUiMode, arriveAdvanced } from '@/lib/ui-mode'
import SimpleAdvancedSwitch from '@/components/SimpleAdvancedSwitch'
import { GuideChip } from '@/components/GuideLink'
import { SimpleSteps, SimpleModelCards, SimpleMoreHint } from './SimpleSteps'
import { simpleImageValues, advancedImageReasons, simpleShapes, shapeOf, simplePresetIds } from '@/lib/workflows/simple-values'

// Persists the workflow choice and all form params across reloads (localStorage).
const FORM_STORAGE_KEY = 'raccoon-studio:generate-form'
// Remembers that the user accepted the >2-LoRA quality warning, so the dialog is
// a one-time gate rather than a nag on every reload. The slot count itself is
// not persisted — sessions start at two, same as the selections.
// Same one-time-gate treatment for Expert Mode: the sampler settings a family
// ships are what it was tuned for, so the first unlock asks once per browser.
const EXPERT_ACK_KEY = 'raccoon-studio:expert-mode-ack'
// Every preset's own model — none of them is an Aria stand-in for another preset.
const PRESET_MODELS = workflows.map((w) => w.baseModel)
// Which preset a new install opens on: the setup's picture models in its order, then every other preset.
// Not picture editing first — a session must never open on a preset that needs a picture.
const PRESET_ORDER = [
  ...STARTER_MODELS.flatMap((m) => (m.opens.page === 'image' && m.group !== 'edit' ? [m.opens.preset] : [])),
  ...workflows.map((w) => w.id),
]
// Nothing installed: open on the setup's always-recommended model — it fits every card and is the smallest download.
const STARTER_PRESET = 'anima-turbo'
const EDIT_INSTRUCTION_HINT = 'Say what to change, e.g. "put her in the jacket from picture 2, keep the pose"'

export default function GenerationForm() {
  const { clientId, addJob } = useQueueStore()
  const updateJob = useQueueStore((s) => s.updateJob)
  // Whether a generation is in flight (queued or running). Selecting a boolean
  // keeps the zustand v5 selector stable — returning a filtered array here would
  // produce a new reference every render and thrash.
  const hasActiveJob = useQueueStore((s) =>
    s.jobs.some((j) => j.status === 'pending' || j.status === 'running'),
  )
  // Seed of the most recently queued image (newest job), for "use last seed".
  const lastJobSeed = useQueueStore((s) => s.jobs[0]?.generationParams.seed ?? null)
  const { prefill, setPrefill } = useStudioStore()
  const activeImageUrl = useStudioStore((s) => s.activeImageUrl)
  const searchParams = useSearchParams()
  const simple = useUiMode() === 'simple'
  const [workflowId, setWorkflowId] = useState(workflows[0].id)
  // Seed the initially-selected workflow's defaults (e.g. the anime models'
  // quality-tag prompt + negative) so the boxes aren't blank on first load. A
  // saved session, a gallery/history prefill, or a model switch all override
  // this afterwards, so seeding it as the *initial* value is collision-free.
  const [params, setParams] = useState<GenerationParams>({
    prompt: '',
    negativePrompt: '',
    width: 832,
    height: 1216,
    seed: -1,
    promptEnhancer: false,
    loras: DEFAULT_LORA_PARAMS.map((lora) => ({ ...lora })),
    ...workflows[0].defaultParams,
  })
  // Per-preset LoRA memory for this session: a stack that cannot load on the
  // preset being switched to is parked here and comes back on return, instead
  // of being reset on every switch. (Prompts are not stashed — they follow the
  // user with the family's tag prefix swapped, see the switch handler.)
  // ponytail: in-memory only (resets on reload); persist per-preset if users ask.
  const [loraStash, setLoraStash] = useState<Record<string, LoraParam[] | undefined>>({})
  const [isGenerating, setIsGenerating] = useState(false)
  const [loraWarnOpen, setLoraWarnOpen] = useState(false)
  const [expertWarnOpen, setExpertWarnOpen] = useState(false)
  // Sampler/scheduler choices, read live off ComfyUI's own KSampler definition so
  // the lists follow what this install actually offers rather than a hardcoded
  // copy that drifts. Empty when ComfyUI is offline — the Expert dropdowns then
  // show the current value and nothing else, which still submits fine.
  const [samplerNames, setSamplerNames] = useState<string[]>([])
  const [schedulerNames, setSchedulerNames] = useState<string[]>([])
  // Wildcard lists for `__name__` expansion, loaded once; drives the inline
  // preview and the per-job expansion at submit time.
  const [wildcardLists, setWildcardLists] = useState<WildcardLists>({})
  const [previewSeed, setPreviewSeed] = useState(0) // bump to reroll the sample preview
  useEffect(() => {
    void (async () => {
      try { setWildcardLists((await (await fetch('/api/prompts/wildcards')).json()).wildcards ?? {}) } catch { /* offline */ }
    })()
  }, [])
  // Set by Cancel to abort an in-flight batch submit loop (jobCount > 1) so it
  // stops queuing further prompts once the user has bailed out.
  const cancelledRef = useRef(false)
  // Everything the three ComfyUI loaders offer; which one the active workflow
  // reads is decided by workflow.ariaModelKind: 'checkpoint' (SDXL family →
  // CheckpointLoaderSimple), 'unet' (z-image/ernie/anima → UNETLoader), or
  // 'lora' (legacy LoraLoader). These used to be filtered to Patreon "Aria"
  // filenames, which left a checkpoint the user imported themselves invisible
  // in the Model dropdown while ComfyUI was offering it. Family filtering now
  // happens below, off each file's own header.
  const [ckptNames, setCkptNames] = useState<string[]>([])
  const [loraNames, setLoraNames] = useState<string[]>([])
  const [unetNames, setUnetNames] = useState<string[]>([])
  // Architecture read from each base model's safetensors header, keyed by the
  // name ComfyUI reports. Same source and same rules as the LoRA slots; a failed
  // fetch leaves the maps empty, which shows every model unfiltered.
  const [baseFamilies, setBaseFamilies] = useState<{
    checkpoints: Record<string, LoraFamily | null>
    diffusion_models: Record<string, LoraFamily | null>
  }>({ checkpoints: {}, diffusion_models: {} })
  // The headers above have been asked for (answered or failed) — the opening-preset check waits for it.
  const [familiesLoaded, setFamiliesLoaded] = useState(false)
  // True once all three lists above reflect a real answer from ComfyUI. Until
  // then they are indistinguishable from "this install has no extra models", and
  // a stale `params.ariaModel` must not be cleared on that basis.
  const [ariaLoaded, setAriaLoaded] = useState(false)
  // Every checkpoint + diffusion model ComfyUI offers (not just the Aria ones),
  // which is what decides whether a model preset is downloaded and usable.
  const [installedBaseModels, setInstalledBaseModels] = useState<string[]>([])
  // Whether ComfyUI has the FaceDetailer node (Impact Pack installed).
  // null = still loading; false = unavailable; true = available.
  const [faceDetailerAvailable, setFaceDetailerAvailable] = useState<boolean | null>(null)
  // Face swap and pixel boost come from two different node packs — ReActor
  // (upstream) and RaccoonSwapNodes (ours, vendored) — so either can be missing
  // on its own. Tracked separately: a broken RaccoonSwapNodes import must cost
  // the user pixel boost, not the whole face-swap feature.
  const [faceSwapAvailable, setFaceSwapAvailable] = useState<boolean | null>(null)
  const [pixelBoostAvailable, setPixelBoostAvailable] = useState<boolean | null>(null)
  // Whether ComfyUI has the ControlNet Aux + IP-Adapter Plus nodes installed.
  const [controlNetAvailable, setControlNetAvailable] = useState<boolean | null>(null)
  const [ipAdapterAvailable, setIpAdapterAvailable] = useState<boolean | null>(null)
  // Fun ControlNet patches (Z-Image, Qwen-Image 2.1) share one core node; which
  // file a preset needs depends on its kind, so keep the list, not a boolean.
  // null = not answered yet.
  const [funPatchNames, setFunPatchNames] = useState<string[] | null>(null)
  // Whether the dedicated SDXL fp16-fix VAE is installed (cures washed-out
  // colors on SDXL checkpoints with a bad baked VAE, e.g. Illustrious). When
  // present, SDXL-family jobs decode through it instead of the checkpoint VAE.
  const [sdxlVaeAvailable, setSdxlVaeAvailable] = useState(false)
  // Which of Krea2's three built-in LoRAs are actually on disk. They are patched
  // in outside the user's LoRA slots — refusal reduction at a fixed strength 1
  // or Kroma in its place, projector scale on the slider below — and ComfyUI
  // rejects an unknown lora_name outright, so none is ever passed until it has
  // been seen here.
  const [krea2Builtins, setKrea2Builtins] = useState({ refusal: false, projector: false, kroma: false })
  // Whether Qwen-Image 2.1's prompt enhancer — its own 9.5 GB model in
  // text_encoders/ — is installed. Same confirm-then-inject rule as above.
  const [qwen21EnhancerInstalled, setQwen21EnhancerInstalled] = useState(false)
  const [ernieEnhancerInstalled, setErnieEnhancerInstalled] = useState(false)
  // Krea2's text encoder doubles as the Prompt Helper's built-in writer.
  const [helperOpen, setHelperOpen] = useState(false)
  // Which BFS head-swap LoRAs ComfyUI lists — the Edit preset's Head swap chip
  // is only queued once its file is there (an unknown lora_name fails the job).
  const [bfsInstalled, setBfsInstalled] = useState({ alternative: false, 'v1.1': false })
  // An edit picture is uploading.
  const [pictureBusy, setPictureBusy] = useState(false)
  // Gate persistence until the saved session has been restored, so the first
  // render's defaults don't overwrite what we're about to load.
  const [restored, setRestored] = useState(false)
  // The restore found a saved pick — only then is the opening preset someone's choice to keep.
  const hadSession = useRef(false)

  // ── Base image (img2img / inpaint / outpaint) ──────────────────────────────
  // The uploaded filename lives on `params.baseImage`; the preview URL and busy
  // flag are transient (not persisted). `brushRef` exposes the inpaint mask
  // canvas so handleGenerate can upload it at submit time. `baseObjectUrl` tracks
  // the object URL we created (file uploads) so we can revoke it; route URLs
  // (gallery / last result) are left alone.
  const [basePreview, setBasePreview] = useState<string | null>(null)
  const [baseBusy, setBaseBusy] = useState(false)
  const brushRef = useRef<MaskBrushHandle>(null)
  const baseObjectUrl = useRef<string | null>(null)

  const setBaseFromUpload = useCallback(async (blob: Blob, preview: string) => {
    setBaseBusy(true)
    try {
      const name = await uploadImageBlob(blob, 'base.png')
      setParams((p) => ({
        ...p,
        baseImage: name,
        editMode: p.editMode ?? 'img2img',
        denoise: p.denoise ?? 0.65,
        maskImage: undefined,
      }))
      if (baseObjectUrl.current) URL.revokeObjectURL(baseObjectUrl.current)
      baseObjectUrl.current = preview.startsWith('blob:') ? preview : null
      setBasePreview(preview)
    } catch (e) {
      toast.error(`Base image failed: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBaseBusy(false)
    }
  }, [])

  const onUploadBaseFile = useCallback((file: File) => {
    void setBaseFromUpload(file, URL.createObjectURL(file))
  }, [setBaseFromUpload])

  // ── Edit pictures (Qwen-Image 2.1 Edit) ─────────────────────────────────────
  // Filenames live on `params.qwenReferences`, gap-free; previews come straight
  // from ComfyUI's input dir, so nothing transient needs tracking.
  const addPicture = useCallback(async (upload: () => Promise<string>) => {
    setPictureBusy(true)
    try {
      const name = await upload()
      setParams((p) => ({ ...p, qwenReferences: [...(p.qwenReferences ?? []), name].slice(0, QWEN21_EDIT_SLOTS) }))
    } catch (e) {
      toast.error(`Picture failed: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setPictureBusy(false)
    }
  }, [])

  const onUseBaseUrl = useCallback(async (url: string) => {
    setBaseBusy(true)
    try {
      const res = await fetch(url)
      if (!res.ok) throw new Error(`Could not load image (${res.status})`)
      await setBaseFromUpload(await res.blob(), url)
    } catch (e) {
      toast.error(`Base image failed: ${e instanceof Error ? e.message : String(e)}`)
      setBaseBusy(false)
    }
  }, [setBaseFromUpload])

  const removeBase = useCallback(() => {
    if (baseObjectUrl.current) URL.revokeObjectURL(baseObjectUrl.current)
    baseObjectUrl.current = null
    setBasePreview(null)
    setParams((p) => ({ ...p, baseImage: undefined, maskImage: undefined, outpaint: undefined }))
  }, [])

  const workflow = workflows.find((w) => w.id === workflowId)!
  // What each loader can load. SDXL-family workflows swap *checkpoints*
  // (CheckpointLoaderSimple); the diffusion families (z-image/ernie/anima) swap
  // *diffusion models* (UNETLoader). The LoraLoader list is kept for the legacy
  // 'lora' kind.
  useEffect(() => {
    // Resolves true only when ComfyUI actually answered, so `ariaLoaded` below
    // never treats an offline install as "no Aria models". A booting engine
    // answers through the proxy as 502 `{error}`, which comboOptions would read
    // as an empty list — every preset "missing", Download offering a restart.
    const load = async (node: string, field: string, set: (v: string[]) => void) => {
      try {
        const res = await fetch(`/api/comfyui/object_info/${node}`)
        if (!res.ok) return null
        const names = comboOptions(await res.json(), node, field)
        set(names)
        return names
      } catch { /* ComfyUI offline — leave list empty */ return null }
    }
    const checkDetailer = async () => {
      try {
        const [fd, ud] = await Promise.all([
          fetch('/api/comfyui/object_info/FaceDetailer').then((r) => r.json()),
          fetch('/api/comfyui/object_info/UltralyticsDetectorProvider').then((r) => r.json()),
        ])
        setFaceDetailerAvailable(Boolean(fd?.FaceDetailer) && Boolean(ud?.UltralyticsDetectorProvider))
      } catch {
        setFaceDetailerAvailable(false)
      }
    }
    void Promise.all([
      load('CheckpointLoaderSimple', 'ckpt_name', setCkptNames),
      load('LoraLoader', 'lora_name', setLoraNames),
      load('UNETLoader', 'unet_name', setUnetNames),
    ]).then(([ckpt, lora, unet]) => {
      setAriaLoaded([ckpt, lora, unet].every(Boolean))
      // Same two answers: which base models this install actually has decides
      // which model presets are offered below.
      setInstalledBaseModels([...(ckpt ?? []), ...(unet ?? [])])
    })
    const loadBaseFamilies = async () => {
      const one = async (folder: 'checkpoints' | 'diffusion_models') => {
        try {
          const d = (await (await fetch(`/api/models/lora-arch?folder=${folder}`)).json()) as {
            families?: Record<string, LoraFamily | null>
          }
          return d.families ?? {}
        } catch {
          return {}
        }
      }
      const [checkpoints, diffusionModels] = await Promise.all([one('checkpoints'), one('diffusion_models')])
      setBaseFamilies({ checkpoints, diffusion_models: diffusionModels })
      setFamiliesLoaded(true)
    }
    void loadBaseFamilies()
    void checkDetailer()
    const checkFaceSwap = async () => {
      // Probed independently: ReActor failing and RaccoonSwapNodes failing are
      // different outcomes for the user. A pack whose import blew up is absent
      // from /object_info exactly like one that was never installed, which is
      // what makes this detectable at all.
      const probe = async (nodeClass: string) => {
        try {
          const d = (await (await fetch(`/api/comfyui/object_info/${nodeClass}`)).json()) as Record<string, unknown>
          return Boolean(d?.[nodeClass])
        } catch {
          return false
        }
      }
      const [swap, boost] = await Promise.all([probe(FACE_SWAP_NODE), probe(PIXEL_BOOST_NODE)])
      setFaceSwapAvailable(swap)
      setPixelBoostAvailable(boost)
    }
    void checkFaceSwap()
    const checkSdxlVae = async () => {
      try {
        const d = await (await fetch('/api/comfyui/object_info/VAELoader')).json()
        const names = d?.VAELoader?.input?.required?.vae_name?.[0] as string[] | undefined
        setSdxlVaeAvailable(Array.isArray(names) && names.some((n) => n === SDXL_FIX_VAE || n.endsWith('/' + SDXL_FIX_VAE)))
      } catch {
        setSdxlVaeAvailable(false)
      }
    }
    void checkSdxlVae()
    const checkQwen21Enhancer = async () => {
      try {
        const d = await (await fetch('/api/comfyui/object_info/CLIPLoader')).json()
        const clips = comboOptions(d, 'CLIPLoader', 'clip_name')
        setQwen21EnhancerInstalled(fileInstalled(QWEN21_PE_T2I, clips))
        setErnieEnhancerInstalled(fileInstalled(ERNIE_ENHANCER, clips))
      } catch {
        setQwen21EnhancerInstalled(false)
        setErnieEnhancerInstalled(false)
      }
    }
    void checkQwen21Enhancer()
    const checkKrea2Builtins = async () => {
      try {
        const d = await (await fetch('/api/comfyui/object_info/LoraLoader')).json()
        const names = comboOptions(d, 'LoraLoader', 'lora_name')
        // ComfyUI reports subfolders with OS separators; match on the leaf.
        const has = (file: string) =>
          names.some((n) => n === file || n.replace(/\\/g, '/').endsWith('/' + file))
        setKrea2Builtins({
          refusal: has(KREA2_REFUSAL_LORA),
          projector: has(KREA2_PROJECTOR_LORA),
          kroma: has(KREA2_KROMA_LORA),
        })
        // Same list, same call — the BFS head-swap LoRAs are just more optional LoRAs.
        setBfsInstalled({ alternative: has(QWEN21_BFS_LORAS.alternative), 'v1.1': has(QWEN21_BFS_LORAS['v1.1']) })
      } catch {
        setKrea2Builtins({ refusal: false, projector: false, kroma: false })
        setBfsInstalled({ alternative: false, 'v1.1': false })
      }
    }
    void checkKrea2Builtins()
    const checkReference = async () => {
      try {
        const [cn, ip, mp, qn] = await Promise.all([
          fetch('/api/comfyui/object_info/SetUnionControlNetType').then((r) => r.json()),
          fetch('/api/comfyui/object_info/IPAdapterUnifiedLoader').then((r) => r.json()),
          fetch('/api/comfyui/object_info/ModelPatchLoader').then((r) => r.json()),
          fetch('/api/comfyui/object_info/QwenImageDiffsynthControlnet').then((r) => r.json()),
        ])
        setControlNetAvailable(Boolean(cn?.SetUnionControlNetType))
        setIpAdapterAvailable(Boolean(ip?.IPAdapterUnifiedLoader))
        const patchNames = mp?.ModelPatchLoader?.input?.required?.name?.[0] as string[] | undefined
        setFunPatchNames(Boolean(qn?.QwenImageDiffsynthControlnet) && Array.isArray(patchNames) ? patchNames : [])
      } catch {
        setControlNetAvailable(false)
        setIpAdapterAvailable(false)
        setFunPatchNames([])
      }
    }
    void checkReference()
  }, [])

  // Sampler/scheduler lists, fetched when the Expert panel is actually opened
  // rather than at mount. ComfyUI is routinely still starting when this page
  // first loads, and a one-shot mount fetch would leave the dropdowns showing
  // nothing but the current value for the rest of the session — the control
  // would look broken rather than merely offline. Deferring also spares every
  // user who never opens the panel a request for a list they'll never see.
  // Empty lists re-trigger it, so toggling the panel retries.
  useEffect(() => {
    if (!params.expertMode || samplerNames.length > 0) return
    let cancelled = false
    void (async () => {
      try {
        const d = await (await fetch('/api/comfyui/object_info/KSampler')).json()
        if (cancelled) return
        setSamplerNames(comboOptions(d, 'KSampler', 'sampler_name'))
        setSchedulerNames(comboOptions(d, 'KSampler', 'scheduler'))
      } catch { /* ComfyUI offline — dropdowns keep the current value, retried on reopen */ }
    })()
    return () => { cancelled = true }
  }, [params.expertMode, samplerNames.length])

  // Prefill from history strip "Regenerate".
  // Only claim prefills naming an image workflow (or none: keep the model), and only clear what we claimed:
  // this form is mounted on /generate while "send to Generate Videos" sets a video
  // prefill, so clearing one we can't apply would destroy the video tab's seed
  // before that tab ever mounts.
  useEffect(() => {
    if (!prefill) return
    if (!prefill.workflowId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing form from the prefill store
      setParams((p) => ({ ...p, ...prefill.params }))
      setPrefill(null)
      return
    }
    const found = workflows.find((w) => w.id === prefill.workflowId)
    if (!found) return
    setWorkflowId(prefill.workflowId)
    setParams((p) => ({ ...p, ...found.defaultParams, ...prefill.params }))
    arriveAdvanced(advancedImageReasons(prefill.params, found))
    setPrefill(null)
  }, [prefill, setPrefill])

  // Prefill from gallery "Send to Generate"
  useEffect(() => {
    const prompt = searchParams.get('prompt')
    const negative = searchParams.get('negative')
    const seed = searchParams.get('seed')
    const wf = searchParams.get('workflow')
    const loras = parseGalleryLoras(searchParams.get('loras'))
    // The checkpoint the image used, or 'base' for the preset's own — either way
    // it replaces the pick left in the form, which is what "the wrong model" was.
    const model = searchParams.get('model')
    if (prompt || negative || seed || wf || loras) {
      if (wf) {
        const found = workflows.find((w) => w.id === wf || w.name.toLowerCase() === wf.toLowerCase())
        // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing form from URL params
        if (found) setWorkflowId(found.id)
      }
      setParams((p) => ({
        ...p,
        ...(prompt ? { prompt } : {}),
        ...(negative ? { negativePrompt: negative } : {}),
        ...(seed ? { seed: Number(seed) } : {}),
        ...(loras ? { loras } : {}),
        ...(model ? { ariaModel: model === 'base' ? undefined : model } : {}),
      }))
      // A link that needs Advanced (LoRAs, a custom negative) switches to it.
      const target = wf ? workflows.find((w) => w.id === wf || w.name.toLowerCase() === wf.toLowerCase()) : undefined
      arriveAdvanced(advancedImageReasons(
        { loras: loras ?? undefined, ...(target && negative ? { negativePrompt: negative } : {}) },
        target ?? workflows[0],
      ))
    }
  }, [searchParams])

  // Gallery "Send as base" → ?base=<image url>. Fetch that image and re-upload
  // it into ComfyUI's input dir as the img2img base. A plain ref guard (no
  // cancelled flag) makes this one-shot and StrictMode-safe.
  const baseParamHandled = useRef(false)
  useEffect(() => {
    const base = searchParams.get('base')
    if (!base || baseParamHandled.current) return
    baseParamHandled.current = true
    arriveAdvanced(['a starting picture'])
    void onUseBaseUrl(base)
  }, [searchParams, onUseBaseUrl])

  // Gallery "Edit with Qwen" / "Character sheet" → ?workflow=qwen21-edit&ref=<image
  // url>[&chip=sheet]. The workflow param is applied by the effect above; this
  // one uploads the picture as picture 1. A plain ref guard, like ?base=, keeps
  // it one-shot under StrictMode.
  const refParamHandled = useRef(false)
  useEffect(() => {
    const ref = searchParams.get('ref')
    if (!ref || refParamHandled.current) return
    refParamHandled.current = true
    const sheet = searchParams.get('chip') === 'sheet'
    void (async () => {
      setPictureBusy(true)
      try {
        const name = await uploadImageFromUrl(ref, editUploadName())
        setParams((p) => ({ ...p, ...qwen21EditLinkPatch(name, sheet) }))
      } catch (e) {
        toast.error(`Picture failed: ${e instanceof Error ? e.message : String(e)}`)
      } finally {
        setPictureBusy(false)
        // One-shot: a reload or Back must not re-apply the link over what the
        // user has built since.
        window.history.replaceState(null, '', '/generate')
      }
    })()
  }, [searchParams])

  // Restore the previous session's workflow + params on mount, unless the user
  // arrived via a gallery "Send to Generate" link (those URL params win). A link
  // that only names a preset (a gallery Edit link, Simple Models' "Make a
  // picture") is the exception: it restores the session and then switches to its
  // preset the way the preset button does — skipping the restore made the persist
  // effect overwrite the saved session with the first preset's defaults (LoRAs,
  // tiled VAE decode and job count gone).
  useEffect(() => {
    const linkId = presetOnlyLink(searchParams)
    const linkPreset = linkId ? workflows.find((w) => w.id === linkId) : undefined
    const hasQuery = !linkPreset && !!(
      searchParams.get('prompt') ||
      searchParams.get('negative') ||
      searchParams.get('seed') ||
      searchParams.get('workflow') ||
      searchParams.get('loras')
    )
    if (!hasQuery) {
      try {
        const raw = localStorage.getItem(FORM_STORAGE_KEY)
        if (raw) {
          const saved = JSON.parse(raw) as { workflowId?: string; params?: Partial<GenerationParams> }
          /* eslint-disable react-hooks/set-state-in-effect -- one-time restore from storage */
          const savedPreset = workflows.find((w) => w.id === saved.workflowId)
          if (linkPreset) {
            setWorkflowId(linkPreset.id)
            setParams((p) => switchPresetParams({ ...p, ...saved.params }, savedPreset ?? workflows[0], linkPreset, undefined))
          } else {
            if (savedPreset) setWorkflowId(savedPreset.id)
            if (saved.params) setParams((p) => ({ ...p, ...saved.params }))
            hadSession.current = !!savedPreset
          }
          /* eslint-enable react-hooks/set-state-in-effect */
        }
      } catch {
        /* ignore corrupt/unavailable storage */
      }
    }
    setRestored(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only restore
  }, [])

  // Persist on every change once restored. inputImage is dropped — the uploaded
  // face file can't be re-previewed across reloads, so the swap toggle restores
  // inert until a new photo is picked (buildPrompt needs both to act). baseImage
  // and maskImage are dropped for the same reason — no preview survives a reload,
  // so the base-image section restores empty rather than referencing an upload
  // the user can no longer see. LoRAs remain persisted so their row count,
  // selections and strengths survive route changes and reloads.
  useEffect(() => {
    if (!restored) return
    try {
      localStorage.setItem(
        FORM_STORAGE_KEY,
        JSON.stringify({ workflowId, params: { ...params, inputImage: undefined, baseImage: undefined, maskImage: undefined, controlNet: undefined, ipAdapter: undefined } }),
      )
    } catch {
      /* quota or unavailable — non-fatal */
    }
  }, [restored, workflowId, params])

  /**
   * Whether a model preset can be generated with right now. Takes the three
   * fields rather than the workflow object on purpose: handing a whole
   * `workflow` to a locally-declared function makes the React Compiler treat it
   * as possibly-mutated and bail out of memoizing this component.
   *
   * The list is narrowed to models whose header says they *are* this family.
   * All the UNET families share one list, so an unfiltered check let a single
   * Z-Image model light up Anima, Ernie and Krea2 as well — every preset
   * colourful on an install that could render two of them. Unrecognised files
   * are excluded here while the dropdown still offers them: an unknown file may
   * be selectable, but it must not advertise a preset as ready.
   */
  const presetOk = (baseModel: string, presetKind: WorkflowDefinition['ariaModelKind'], presetFamily?: LoraFamily) => {
    const families = presetKind === 'checkpoint' ? baseFamilies.checkpoints : baseFamilies.diffusion_models
    const names = presetKind === 'checkpoint' ? ckptNames : presetKind === 'unet' ? unetNames : loraNames
    return presetAvailable(
      baseModel,
      installedBaseModels,
      withoutPresetModels(
        names.filter((n) => Boolean(presetFamily) && families[n.replace(/\\/g, '/')] === presetFamily),
        PRESET_MODELS,
      ),
      ariaLoaded,
    )
  }

  // Open on a model this install has (spec §2.1): the saved pick if it can run,
  // else the first usable one in the setup's order, else the recommended
  // starter, whose Download button then stands in for Generate. "Usable" is the
  // preset buttons' own rule — its base file, or an installed model of its
  // family — so it waits for the family headers as well as ComfyUI's lists.
  // A string, not an array: a locally built array as an effect dep changes every render.
  const usablePresets = workflows.filter((w) => presetOk(w.baseModel, w.ariaModelKind, w.loraFamily)).map((w) => w.id).join(' ')
  const presetChecked = useRef(false)
  const linkedPreset = useRef(searchParams.get('workflow') !== null)
  useEffect(() => {
    if (presetChecked.current || !restored || !ariaLoaded || !familiesLoaded) return
    presetChecked.current = true
    if (linkedPreset.current || params.ariaModel) return
    const usable = (id: string) => usablePresets.split(' ').includes(id)
    // A fresh browser has no pick of its own: `workflows[0]` is only the built-in default.
    const next = preferredPreset(hadSession.current ? workflowId : '', PRESET_ORDER, usable, STARTER_PRESET)
    if (!next || next === workflowId) return
    const target = workflows.find((w) => w.id === next)!
    // One-time correction once ComfyUI has answered (no set-state-in-effect
    // directive: the linter already accepts a value read off a ref).
    setWorkflowId(next)
    setParams((p) => switchPresetParams(p, workflow, target, loraStash[next]))
  }, [restored, ariaLoaded, familiesLoaded, params.ariaModel, workflowId, usablePresets, workflow, loraStash])

  const set = (key: keyof GenerationParams, value: unknown) =>
    setParams((p) => ({ ...p, [key]: value }))

  // One pick for the preset buttons and Simple's model cards.
  const pickPreset = (w: WorkflowDefinition) => {
    if (w.id === workflowId) return
    // A pick made before ComfyUI answered is the user's: the opening check must not undo it.
    presetChecked.current = true
    setLoraStash((s) => ({ ...s, [workflowId]: params.loras }))
    setWorkflowId(w.id)
    setParams((p) => switchPresetParams(p, workflow, w, loraStash[w.id]))
  }

  // Slots past the free two are gated once per browser: stacked LoRAs compete for
  // the same weights, so the user acknowledges the quality cost before unlocking.
  const addLoraSlot = () =>
    setParams((p) => {
      const rows = p.loras ?? DEFAULT_LORA_PARAMS
      return rows.length >= MAX_LORAS ? p : { ...p, loras: [...rows, { name: '', strength: 1 }] }
    })
  const requestLoraSlot = () => {
    let acked = false
    try { acked = localStorage.getItem(LORA_STACK_ACK_KEY) === '1' } catch { /* unavailable */ }
    if ((params.loras?.length ?? FREE_LORA_SLOTS) >= FREE_LORA_SLOTS && !acked) setLoraWarnOpen(true)
    else addLoraSlot()
  }
  const confirmLoraSlots = () => {
    try { localStorage.setItem(LORA_STACK_ACK_KEY, '1') } catch { /* quota or unavailable */ }
    addLoraSlot()
  }

  // Expert Mode is gated the same way, and only on the way *on* — switching it
  // back off restores the model's own settings and needs no confirmation.
  const requestExpertMode = () => {
    if (params.expertMode) {
      set('expertMode', false)
      return
    }
    let acked = false
    try { acked = localStorage.getItem(EXPERT_ACK_KEY) === '1' } catch { /* unavailable */ }
    if (acked) set('expertMode', true)
    else setExpertWarnOpen(true)
  }
  const confirmExpertMode = () => {
    try { localStorage.setItem(EXPERT_ACK_KEY, '1') } catch { /* quota or unavailable */ }
    set('expertMode', true)
  }

  const showNegativePrompt = negativePromptApplies(params, workflow)

  // The Model picker swaps the generation model for another of the same family:
  // SDXL-family picks a checkpoint, the diffusion families (z-image/ernie/anima/
  // krea2) a diffusion model, the legacy lora kind a LoRA. Narrowed by each
  // file's own header exactly like the LoRA slots, so an unrecognised file stays
  // listed — a family we haven't fingerprinted shows too much rather than hiding
  // what the user imported.
  //
  // Both values come out of one useMemo because the React Compiler otherwise
  // stops memoizing this whole component: a locally-built array is still live
  // where the JSX reads it, below `handleGenerate`, so the selection derived
  // from it reads as "may be modified later" in that useCallback's deps.
  const kind = workflow.ariaModelKind
  const family = workflow.loraFamily
  const baseModelFile = workflow.baseModel
  const selected = params.ariaModel
  const baseModelInstalled = fileInstalled(baseModelFile, installedBaseModels)
  const { models: ariaModels, model: ariaModel } = useMemo(() => {
    const names = kind === 'checkpoint' ? ckptNames : kind === 'unet' ? unetNames : loraNames
    // No `selected` pass-through, unlike the LoRA slots: keeping the current
    // selection listed whatever its family would defeat `effectiveAriaModel`
    // below, which drops a pick the *new* family's loader cannot load. With one,
    // an Anima model chosen under Anima followed the user into Illustrious.
    const models = visibleForFamily(
      // The preset's own model is already the "Base X" entry below; twice is noise.
      names.filter((n) => !fileInstalled(baseModelFile, [n])),
      kind === 'checkpoint' ? baseFamilies.checkpoints : baseFamilies.diffusion_models,
      family,
    )
    // `selected` is persisted and shared across families, so it outlives both the
    // preset switch that makes it wrong and the install that made it exist; it is
    // resolved here rather than written back, so re-importing a model restores
    // the choice instead of losing it. And a preset whose own model is missing
    // falls back to the first of its family: leaving "Base X" selected sends
    // ComfyUI a filename it does not have, which returns as a bare "Generation
    // failed" (the picker disables that entry for the same reason).
    // Never a sibling preset's model (installed.ts, withoutPresetModels).
    const fallback = ariaLoaded && !baseModelInstalled ? withoutPresetModels(models, PRESET_MODELS)[0] : undefined
    return { models, model: effectiveAriaModel(selected, models, ariaLoaded) ?? fallback }
  }, [kind, family, baseModelFile, baseModelInstalled, selected, ariaLoaded,
      ckptNames, unetNames, loraNames, baseFamilies])

  // Qwen-Image 2.1's and Ernie's enhancers are separate models (9.5 GB / optional on
  // the Models page): without the file the switch is shown off and disabled, and a
  // toggle left on in a saved session is not sent — Ernie's graph would fail on it.
  const enhancerMissing = (workflow.loraFamily === 'qwen21' && !qwen21EnhancerInstalled)
    || (workflow.loraFamily === 'ernie' && !ernieEnhancerInstalled)

  const handleGenerate = useCallback(async () => {
    // Simple renders with defaults: hidden settings never reach the job, and the
    // stored form keeps them for Advanced (spec §4). Before the form's own
    // injections below, which stay as they are.
    const p: GenerationParams = simple ? { ...params, ...simpleImageValues(workflow) } : params
    if (!p.prompt.trim()) {
      toast.error(workflow.referenceSlots ? 'Say what to change first' : 'Please enter a prompt')
      return
    }
    setIsGenerating(true)
    cancelledRef.current = false
    const count = p.jobCount ?? 1
    const isKrea2 = workflow.loraFamily === 'krea2'
    let queued = 0
    try {
      // Reference-guidance modes need an uploaded reference: toggling the section
      // on leaves image '' until a file is picked, and a LoadImage with no file
      // fails ComfyUI validation. Guard up front (mirrors the inpaint-mask guard).
      if (p.controlNet && !p.controlNet.image) {
        toast.error('Upload a ControlNet reference image first')
        return
      }
      if (p.ipAdapter && !p.ipAdapter.image) {
        toast.error('Upload an IP-Adapter reference image first')
        return
      }
      // The Edit preset needs its pictures, and the head swap its LoRA.
      if (workflow.referenceSlots) {
        const problem = qwen21EditProblem(
          p.qwenReferences, p.editChip, bfsInstalled[bfsVariantFor(p.bfsVariant, bfsInstalled)],
        )
        if (problem) {
          toast.error(problem)
          return
        }
      }
      // Masked modes share one painted mask across the batch: render + upload it
      // once. Inpaint requires a painted area; outpaint derives its mask from the
      // pad node, so it needs none.
      // A base image left from another preset's session must not block the Edit
      // preset, which has no base-image modes.
      const usesBase = workflow.supportsImg2Img && !!p.baseImage
      let maskImage = p.maskImage
      const isMaskMode = usesBase && (p.editMode === 'inpaint' || p.editMode === 'outpaint')
      if (usesBase && p.editMode === 'inpaint') {
        const blob = await brushRef.current?.exportMask()
        if (!blob) {
          toast.error('Paint a mask area to inpaint first')
          return
        }
        maskImage = await uploadImageBlob(blob, 'mask.png')
      }
      for (let i = 0; i < count; i++) {
        // A Cancel mid-batch aborts the remaining submissions.
        if (cancelledRef.current) break
        // Resolve the seed to a concrete value up front so the exact seed used is
        // recorded on the job (each job gets its own when seed === -1). buildPrompt
        // then uses it verbatim instead of rolling its own, which would be lost.
        const seed = p.seed < 0 ? Math.floor(Math.random() * 9999999999999) : p.seed
        const jobParams = {
          ...p,
          seed,
          ...(maskImage ? { maskImage } : {}),
          // Hi-res fix defaults off for inpaint/outpaint (it works on the full
          // image and fights a localized edit), but stays user-overridable.
          upscale: p.upscale ?? (isMaskMode ? false : true),
          ...(faceDetailerAvailable !== true ? { detailer: false } : {}),
          // Drop swap stages whose node pack isn't loaded, rather than letting
          // ComfyUI reject the prompt with a bare "Generation failed". These are
          // separate on purpose: losing the pixel-boost node must still leave a
          // working ReActor swap, not silently cancel the swap as well.
          ...(faceSwapAvailable !== true ? { faceSwap: false } : {}),
          ...(pixelBoostAvailable !== true ? { faceSwapPixelBoost: false } : {}),
          // SDXL family: decode through the fp16-fix VAE when installed (fixes
          // washed-out colors). Gated on availability so it never references a
          // VAE that isn't there.
          ...(workflow.controlNetKind === 'sdxl-union' && sdxlVaeAvailable ? { sdxlVae: SDXL_FIX_VAE } : {}),
          // Krea2 family: patch in the built-in LoRAs, but only the ones ComfyUI
          // actually reports — an unknown lora_name is rejected with
          // value_not_in_list, which surfaces as a bare "Generation failed".
          // The uncensor slot holds one of two files or nothing; 'patch' is the
          // default so sessions saved before the picker existed keep behaving
          // exactly as they did.
          ...(isKrea2 && (p.krea2Nsfw ?? 'patch') === 'patch' && krea2Builtins.refusal
            ? { krea2RefusalLora: KREA2_REFUSAL_LORA } : {}),
          ...(isKrea2 && p.krea2Nsfw === 'kroma' && krea2Builtins.kroma
            ? { krea2KromaLora: KREA2_KROMA_LORA } : {}),
          ...(isKrea2 && krea2Builtins.projector ? { krea2ProjectorLora: KREA2_PROJECTOR_LORA } : {}),
          // Qwen-Image 2.1's enhancer is its own model: confirmed, then injected.
          ...(workflow.loraFamily === 'qwen21' && qwen21EnhancerInstalled ? { qwen21Enhancer: QWEN21_PE_T2I } : {}),
          ...(enhancerMissing ? { promptEnhancer: false } : {}),
          // Same guard, for the imported Aria model: every family injects this
          // into its own loader, so one that belongs to another family or whose
          // file is gone takes the whole prompt down with value_not_in_list.
          ariaModel,
          // An edit renders one picture per job; the head swap takes the
          // installed build when none was picked.
          batchSize: jobBatchSize(workflow, p),
          ...(workflow.referenceSlots ? { bfsVariant: bfsVariantFor(p.bfsVariant, bfsInstalled) } : {}),
        }
        // Expand wildcards per job so each job in a batch re-rolls independently,
        // and the resolved text (not the template) is what's built + recorded.
        jobParams.prompt = expandWildcards(jobParams.prompt, wildcardLists)
        if (jobParams.negativePrompt) jobParams.negativePrompt = expandWildcards(jobParams.negativePrompt, wildcardLists)
        const prompt = workflow.buildPrompt(jobParams)
        const prompt_id = await submitPrompt({ prompt, client_id: clientId, extra_data: presetStamp(workflowId) })
        addJob(prompt_id, workflowId, workflow.name, jobParams.prompt, jobParams)
        queued++
      }
      if (queued > 0) {
        toast.success(queued > 1 ? `Queued ${queued} jobs — generating...` : 'Queued — generating...')
      }
    } catch (e) {
      if (queued > 0) toast.error(`Queued ${queued}/${count} — then failed: ${e instanceof Error ? e.message : String(e)}`)
      else toast.error(`Generation failed: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setIsGenerating(false)
    }
  }, [params, simple, workflow, workflowId, clientId, addJob, faceDetailerAvailable, faceSwapAvailable,
      pixelBoostAvailable, sdxlVaeAvailable, krea2Builtins, qwen21EnhancerInstalled, enhancerMissing, wildcardLists, ariaModel,
      bfsInstalled])

  // Cancel the in-flight generation: stop the batch submit loop, interrupt the
  // running prompt, drop any still-queued prompts, and mark our active jobs
  // cancelled locally (the WS handlers then ignore the late interrupt frames).
  const handleCancel = useCallback(async () => {
    cancelledRef.current = true
    const active = useQueueStore
      .getState()
      .jobs.filter((j) => j.status === 'pending' || j.status === 'running')
    if (active.length === 0) return

    try {
      await fetch('/api/comfyui/interrupt', { method: 'POST' })
      const pendingIds = active.filter((j) => j.status === 'pending').map((j) => j.promptId)
      if (pendingIds.length > 0) {
        await fetch('/api/comfyui/queue', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ delete: pendingIds }),
        })
      }
    } catch (e) {
      toast.error(`Cancel failed: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      for (const j of active) {
        if (j.livePreview) URL.revokeObjectURL(j.livePreview)
        updateJob(j.id, { status: 'cancelled', endedAt: Date.now(), livePreview: undefined })
      }
      toast('Generation cancelled')
    }
  }, [updateJob])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && !isGenerating) {
        void handleGenerate()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [handleGenerate, isGenerating])

  const selectedRatio = workflow.aspectRatios.find(
    (r) => r.width === params.width && r.height === params.height
  )

  // A preset the setup offers gets a one-click download in Generate's place; others keep Generate (and its plain error).
  const missingStarter = ariaLoaded && !presetOk(workflow.baseModel, workflow.ariaModelKind, workflow.loraFamily)
    ? starterFor(workflowId)
    : null

  // The Fun ControlNet file this preset's kind needs, and whether ComfyUI has it.
  const funPatch = workflow.controlNetKind === 'qwen21-fun' ? QWEN21_FUN_MODEL : FUN_MODEL
  const funControlNetAvailable = funPatchNames !== null && fileInstalled(funPatch, funPatchNames)

  const enhancerOn = params.promptEnhancer === true && !enhancerMissing

  const showModelPicker =
    ariaModels.length > 0 &&
    (workflow.ariaModelKind === 'checkpoint' ||
      workflow.ariaModelKind === 'unet' ||
      workflow.supportsLoRA)

  // The Model dropdown (imported files of the picked family) — both views render it.
  const modelPicker = showModelPicker ? (
    <div className="flex items-center gap-3">
      <SectionLabel>Model</SectionLabel>
      <div className="min-w-0 flex-1">
        <Select
          value={ariaModel || 'base'}
          onValueChange={(v) => set('ariaModel', (v ?? 'base') === 'base' ? undefined : v)}
        >
          <SelectTrigger className="h-9 w-full text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="base" disabled={!baseModelInstalled}>
              Base {workflow.name}{baseModelInstalled ? '' : ' — not installed'}
            </SelectItem>
            {ariaModels.map((m) => (
              <SelectItem key={m} value={m}>{(m.split('/').pop() ?? m).replace('.safetensors', '')}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  ) : null

  // The quality switches, shared by Advanced's Options row and Simple's step 3.
  const hiresTile = (label: string, hint: string) => {
    if (!workflow.supportsUpscale) return null
    // Hi-res fix — final net-1.5× model upscale (on by default, but off by
    // default for inpaint/outpaint, where it fights a localized edit).
    const isMaskMode = workflow.supportsImg2Img && !!params.baseImage
      && (params.editMode === 'inpaint' || params.editMode === 'outpaint')
    const upscale = params.upscale ?? (isMaskMode ? false : true)
    return <SwitchTile label={label} icon={Maximize2} on={upscale} onToggle={() => set('upscale', !upscale)} hint={hint} />
  }
  // Face detailer — detect-crop-redraw-paste over faces (on by default). `simpleView`:
  // Simple turns face swap off (simple-values.ts), so a swap stored for Advanced must
  // not read as forcing the detailer there.
  const detailerTile = (label: string, hint: string, simpleView: boolean) => {
    if (!workflow.supportsDetailer) return null
    const detailer = params.detailer ?? true
    // `faceDetailerAvailable` is fetched from ComfyUI client-side, so the
    // server can't know it at SSR time. Gate it behind `restored` (flips true
    // in a mount-only effect) so the server HTML and the first client render
    // are identical — otherwise the toggle's `disabled` attribute mismatches
    // on hydration. Real availability takes effect after mount.
    const available = restored && faceDetailerAvailable === true
    // The builders force the detailer on for any render that also swaps a
    // face — without it, only the first swap of a ComfyUI session works and
    // the rest come back black (12/12 vs 3/12, 2026-09-05). Reflect that
    // here rather than letting the switch read "off" for a pass that runs.
    const swapForces = !simpleView && Boolean(
      params.faceSwap &&
        (params.faceSwapSource === 'model' ? params.faceModel : params.inputImage),
    )
    return (
      <SwitchTile
        label={label}
        icon={ScanFace}
        on={available && (detailer || swapForces)}
        disabled={!available || swapForces}
        onToggle={() => available && set('detailer', !detailer)}
        hint={hint}
        note={
          restored && faceDetailerAvailable === false
            ? 'Requires ComfyUI Impact Pack'
            : available && swapForces
              ? 'Always on with face swap — the swap needs it to render repeatedly'
              : undefined
        }
      />
    )
  }

  // The Edit preset's pictures: Advanced's panel holds the chips too; Simple's step 3 holds them instead.
  const editPictures = (simpleView: boolean) => workflow.referenceSlots ? (
    <EditPicturesInput
      pictures={params.qwenReferences ?? []}
      slots={workflow.referenceSlots}
      chip={params.editChip}
      bfsVariant={bfsVariantFor(params.bfsVariant, bfsInstalled)}
      bfsInstalled={bfsInstalled}
      busy={pictureBusy}
      lastResultUrl={activeImageUrl}
      onAddFile={(file) => void addPicture(() => uploadImageBlob(file, editUploadName()))}
      onAddUrl={(url) => void addPicture(() => uploadImageFromUrl(url, editUploadName()))}
      onRemove={(i) => setParams((p) => ({ ...p, qwenReferences: (p.qwenReferences ?? []).filter((_, j) => j !== i) }))}
      onChip={(chip) => setParams((p) => ({ ...p, ...toggleEditChip(p.editChip, p.prompt, chip) }))}
      onBfsVariant={(v) => set('bfsVariant', v)}
      simple={simpleView}
    />
  ) : null
  // Simple's "What to do": one task always lit; Character sheet and Head swap write their own instruction.
  const editTask = (task: EditChip | undefined, label: string, Icon: typeof Pencil, disabled = false, hint?: string) => (
    <Button
      key={label}
      variant={params.editChip === task ? 'default' : 'outline'}
      aria-pressed={params.editChip === task}
      disabled={disabled}
      title={hint}
      className="h-auto min-w-0 flex-col gap-1 px-1 py-1.5"
      onClick={() => setParams((p) => ({ ...p, ...pickEditTask(p.editChip, p.prompt, task) }))}
    >
      <Icon className="h-4 w-4" />
      <span className="whitespace-normal text-center text-xs font-semibold leading-tight">{label}</span>
    </Button>
  )
  const anyBfs = bfsInstalled.alternative || bfsInstalled['v1.1']

  // Simple's model cards (spec §2) and the shape the size reads as.
  const simpleIds = simplePresetIds(
    PRESET_ORDER,
    (id) => { const w = workflows.find((x) => x.id === id); return !!w && presetOk(w.baseModel, w.ariaModelKind, w.loraFamily) },
    workflowId,
  )
  const shape = shapeOf(params.width, params.height)

  return (
    <div className="space-y-3">
      {/* Panel header */}
      <div className="flex items-center gap-2.5">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/15 ring-1 ring-primary/25">
          <Sparkles className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h2 className="font-heading text-xl font-bold tracking-tight leading-none">Create</h2>
          <p className="text-xs text-muted-foreground mt-1">Set up your generation</p>
        </div>
        <GuideChip slug={simple ? 'generate-image' : 'better-pictures'} className="ml-auto" />
        <SimpleAdvancedSwitch />
      </div>

      {simple ? (
        <div className="space-y-5">
          <SimpleSteps
            steps={[
              {
                title: 'Model',
                body: (
                  <>
                    <SimpleModelCards
                      cards={simpleIds.map((id) => {
                        const w = workflows.find((x) => x.id === id)!
                        const starter = starterFor(id)
                        return { key: id, name: starter?.name ?? w.name, blurb: starter?.blurb ?? w.description, selected: id === workflowId, onPick: () => pickPreset(w) }
                      })}
                    />
                    {modelPicker}
                  </>
                ),
              },
              ...(workflow.referenceSlots
                ? [
                    { title: 'Pictures', body: editPictures(true) },
                    {
                      title: 'What to do',
                      body: (
                        <div className="space-y-2">
                          <div className="grid grid-cols-3 gap-1.5">
                            {editTask(undefined, 'Change something', Pencil)}
                            {editTask('sheet', 'Character sheet', LayoutGrid, false, 'Three full-body views of the person in picture 1')}
                            {editTask('bfs', 'Head swap', ScanFace, headSwapChipDisabled(bfsInstalled, params.editChip),
                              anyBfs ? 'The head from picture 2 onto picture 1' : 'Needs the BFS head-swap LoRA')}
                          </div>
                          {!anyBfs && (
                            <p className="text-xs text-muted-foreground">
                              Head swap needs the BFS head-swap LoRA: get it in Advanced on the Models page (Qwen-Image 2.1 extras).
                            </p>
                          )}
                        </div>
                      ),
                    },
                    {
                      title: params.editChip ? 'What you get' : 'What to change',
                      body: (
                        <div className="space-y-2">
                          {params.editChip === 'sheet' ? (
                            <p className="text-xs text-muted-foreground">
                              Three full-body views of the person in picture 1 (front, side and back) on a plain background. A good reference picture for a video.
                            </p>
                          ) : params.editChip === 'bfs' ? (
                            <p className="text-xs text-muted-foreground">
                              The head from picture 2, hair included, on the body, pose and light of picture 1. Only swap in a person who has agreed to it.
                            </p>
                          ) : (
                            <Textarea
                              placeholder={EDIT_INSTRUCTION_HINT}
                              className="min-h-[88px] resize-y leading-relaxed text-sm"
                              value={params.prompt}
                              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => set('prompt', e.target.value)}
                            />
                          )}
                          <div className="flex flex-wrap gap-2">
                            {hiresTile('Extra sharp', 'A second, finer pass — slower')}
                            {detailerTile('Fix faces', 'Redraws faces in detail', true)}
                          </div>
                        </div>
                      ),
                    },
                  ]
                : [
                    {
                      title: 'Describe your picture',
                      action: <PromptHelperButton onOpen={() => setHelperOpen(true)} />,
                      body: (
                        <Textarea
                          placeholder="Describe the image you want to create..."
                          className="min-h-[88px] resize-y leading-relaxed text-sm"
                          value={params.prompt}
                          onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => set('prompt', e.target.value)}
                        />
                      ),
                    },
                    {
                      title: 'Shape',
                      body: (
                        <div className="space-y-2">
                          <div className="grid grid-cols-3 gap-1.5">
                            {simpleShapes(workflow.aspectRatios).map(({ shape: s, ratio: r }) => {
                              const scale = 18 / Math.max(r.width, r.height)
                              return (
                                <Button
                                  key={s}
                                  variant={shape === s ? 'default' : 'outline'}
                                  className="h-auto min-w-0 flex-col gap-1 px-1 py-1.5"
                                  // same title format as Advanced: the wiki's `[title^="Portrait 2:3"]` works in both
                                  title={`${r.label} · ${r.width} × ${r.height}`}
                                  onClick={() => setParams((p) => ({ ...p, width: r.width, height: r.height }))}
                                >
                                  <span className="flex h-[18px] items-center">
                                    <span
                                      className="rounded-[3px] border-[1.5px] border-current"
                                      style={{ width: Math.round(r.width * scale), height: Math.round(r.height * scale) }}
                                    />
                                  </span>
                                  <span className="text-xs font-semibold leading-none">
                                    {s === 'portrait' ? 'Portrait' : s === 'square' ? 'Square' : 'Landscape'}
                                  </span>
                                </Button>
                              )
                            })}
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {hiresTile('Extra sharp', 'A second, finer pass — slower')}
                            {detailerTile('Fix faces', 'Redraws faces in detail', true)}
                          </div>
                        </div>
                      ),
                    },
                  ]),
            ]}
          />
          <SimpleMoreHint>
            {workflow.referenceSlots ? 'Face swap, LoRAs, the v1.1 head swap, a fixed seed and more' : 'Face swap, LoRAs, more shapes, a fixed seed and more'}
          </SimpleMoreHint>
        </div>
      ) : (
        <>
        {/* Model preset — one card per family (PRESET_GROUPS), two to a row, the
            family in use lit; its presets share the card's width. */}
        <div className="space-y-2">
          <SectionLabel>Model preset</SectionLabel>
          {/* data-tour: rung by the first-run tour's Generate step — picking a
              model is the first thing to do on this page. */}
          <div className="grid grid-cols-2 gap-2" data-tour="/generate">
            {PRESET_GROUPS.map((group) => {
              const current = group.presets.some(({ w }) => w.id === workflowId)
              return (
                <div
                  key={group.label}
                  className={`space-y-1.5 rounded-xl border p-2 transition-colors ${
                    current ? 'border-primary/50 bg-primary/[0.07]' : 'border-border bg-muted/20'
                  }`}
                >
                  <p className={`px-0.5 font-heading text-xs font-bold uppercase tracking-wider ${
                    current ? 'text-primary' : 'text-foreground/75'
                  }`}>
                    {group.label}
                  </p>
                  <div className="flex">
                    {group.presets.map(({ w, variant }, i) => {
                      const available = presetOk(w.baseModel, w.ariaModelKind, w.loraFamily)
                      return (
                        <Button
                          key={w.id}
                          variant={workflowId === w.id ? 'default' : 'outline'}
                          disabled={!available}
                          // Not-downloaded presets stay visible but read as inert — the point
                          // is to show what this install *could* run, not to hide it.
                          className={`h-8 min-w-0 flex-1 rounded-none px-2 text-sm first:rounded-l-lg last:rounded-r-lg${i > 0 ? ' -ml-px' : ''}${available ? '' : ' opacity-45'}`}
                          title={available ? w.name : `${w.name} isn't downloaded — get it on the Models page`}
                          onClick={() => pickPreset(w)}
                        >
                          <span className="truncate">{variant}</span>
                        </Button>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
          <p className="text-xs text-muted-foreground leading-snug line-clamp-2">{workflow.description}</p>
          {/* The selected preset can be one that isn't installed — it is restored
              from localStorage, which outlives any reinstall. Say so here, since a
              greyed-out button the user cannot click explains nothing on its own. */}
          {!presetOk(workflow.baseModel, workflow.ariaModelKind, workflow.loraFamily) && (
            <p className="text-xs text-muted-foreground leading-snug">
              Greyed-out presets aren&apos;t downloaded yet.{' '}
              <Link href="/setup" className="font-medium text-foreground underline">Start here</Link>{' '}
              picks models for your computer, or{' '}
              <Link href="/models" className="font-medium text-foreground underline">get models</Link>{' '}
              yourself.
            </p>
          )}
        </div>

        {/* Model — the preset's own, or an imported model of the same family */}
        {modelPicker}

        {/* Aspect ratio — one equal button each, the frame drawn to scale. The Edit
            preset's canvas follows picture 1 instead. */}
        {!workflow.referenceSlots && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <SectionLabel>Aspect ratio</SectionLabel>
              <span className="text-xs font-mono text-muted-foreground tabular-nums">
                {params.width} × {params.height}
              </span>
            </div>
            <div
              className="grid gap-1.5"
              style={{ gridTemplateColumns: `repeat(${workflow.aspectRatios.length}, minmax(0, 1fr))` }}
            >
              {workflow.aspectRatios.map((r) => {
                // "Portrait 2:3" → ratio on top, name under it.
                const cut = r.label.lastIndexOf(' ')
                const scale = 18 / Math.max(r.width, r.height)
                return (
                  <Button
                    key={r.label}
                    variant={selectedRatio?.label === r.label ? 'default' : 'outline'}
                    className="h-auto min-w-0 flex-col gap-1 px-1 py-1.5"
                    title={`${r.label} · ${r.width} × ${r.height}`}
                    onClick={() => setParams((p) => ({ ...p, width: r.width, height: r.height }))}
                  >
                    <span className="flex h-[18px] items-center">
                      <span
                        className="rounded-[3px] border-[1.5px] border-current"
                        style={{ width: Math.round(r.width * scale), height: Math.round(r.height * scale) }}
                      />
                    </span>
                    <span className="text-xs font-semibold leading-none">{r.label.slice(cut + 1)}</span>
                    <span className="text-[10px] font-normal leading-none opacity-70">{r.label.slice(0, cut)}</span>
                  </Button>
                )
              })}
            </div>
          </div>
        )}

        {/* Input — a base image (img2img / inpaint / outpaint) and the reference
            switches. The Edit preset's pictures are their own block below. */}
        {(workflow.supportsImg2Img || workflow.supportsControlNet || workflow.supportsIpAdapter) && (
          <div className="space-y-2">
            <SectionLabel>Input</SectionLabel>
            {workflow.supportsImg2Img && (
              <BaseImageInput
                params={params}
                set={set}
                preview={basePreview}
                busy={baseBusy}
                lastResultUrl={activeImageUrl}
                brushRef={brushRef}
                onUploadFile={onUploadBaseFile}
                onUseLastResult={() => activeImageUrl && void onUseBaseUrl(activeImageUrl)}
                onRemove={removeBase}
              />
            )}

            {/* Reference guidance — ControlNet (+ IP-Adapter on the SDXL family),
                sharing the row whichever of them a preset has */}
            {(workflow.supportsControlNet || workflow.supportsIpAdapter) && (
              <div className="flex flex-wrap gap-2">
                {workflow.supportsControlNet && (
                  <ControlNetInput
                    value={params.controlNet}
                    // null = still checking: disabled, without a "requires" note that
                    // would flash in and out while ComfyUI answers.
                    available={!restored ? null
                      : workflow.controlNetKind === 'sdxl-union' ? controlNetAvailable
                      : funPatchNames === null ? null : funControlNetAvailable}
                    unavailableHint={
                      workflow.controlNetKind === 'qwen21-fun'
                        ? 'Requires the Qwen-Image 2.1 Fun ControlNet (get it in Models)'
                        : workflow.controlNetKind === 'zimage-fun'
                          ? 'Requires Z-Image Fun ControlNet model (get it in Models)'
                          : 'Requires ControlNet Union model (get it in Models)'
                    }
                    onChange={(v) => set('controlNet', v)}
                  />
                )}
                {workflow.supportsIpAdapter && (
                  <IpAdapterInput
                    value={params.ipAdapter}
                    available={restored ? ipAdapterAvailable : null}
                    onChange={(v) => set('ipAdapter', v)}
                  />
                )}
              </div>
            )}
          </div>
        )}

        {/* Pictures — the Qwen-Image 2.1 Edit preset's picture to edit + references */}
        {editPictures(false)}

        {/* Prompt */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <SectionLabel>{workflow.referenceSlots ? 'Instruction' : 'Prompt'}</SectionLabel>
            <div className="flex items-center gap-1">
              <PromptPresets
                prompt={params.prompt}
                negative={params.negativePrompt}
                onApply={(p) => { set('prompt', p.prompt); set('negativePrompt', p.negative ?? '') }}
              />
              <WildcardManager
                lists={wildcardLists}
                onChange={setWildcardLists}
                onInsert={(token) => set('prompt', `${params.prompt}${params.prompt && !params.prompt.endsWith(' ') ? ' ' : ''}${token}`)}
              />
              {!workflow.referenceSlots && (
                <PromptHelperButton onOpen={() => setHelperOpen(true)} />
              )}
              {workflow.supportsPromptEnhancer && (
                <button
                  type="button"
                  role="switch"
                  aria-checked={enhancerOn}
                  disabled={enhancerMissing}
                  onClick={() => set('promptEnhancer', !params.promptEnhancer)}
                  title={enhancerMissing
                    ? `Needs the ${workflow.loraFamily === 'ernie' ? 'Ernie' : 'Qwen-Image 2.1'} prompt enhancer — get it on the Models page`
                    : 'Prompt enhancer: AI rewrites your prompt for better results'}
                  className="inline-flex h-6 items-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Knob on={enhancerOn} /> Enhance
                </button>
              )}
            </div>
          </div>
          <Textarea
            placeholder={workflow.referenceSlots ? EDIT_INSTRUCTION_HINT : 'Describe the image you want to create...'}
            className="min-h-[88px] resize-y leading-relaxed text-sm"
            value={params.prompt}
            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => set('prompt', e.target.value)}
          />
          {hasWildcards(params.prompt) && (
            <button type="button" onClick={() => setPreviewSeed((n) => n + 1)}
              className="block w-full text-left text-[11px] text-muted-foreground hover:text-foreground"
              title="Click to reroll a sample">
              <span className="text-muted-foreground/70">↳ sample: </span>
              {(() => { void previewSeed; return expandWildcards(params.prompt, wildcardLists) })()}
            </button>
          )}
          {/* Z-Image renders black past ~430 characters (z-image-turbo.ts). */}
          {(() => {
            const warn = promptLengthWarning(workflow.loraFamily, params.prompt)
            return warn ? <p className="text-[11px] font-medium text-destructive">{warn}</p> : null
          })()}
        </div>

        {/* Negative prompt — only where it does anything (see showNegativePrompt) */}
        {showNegativePrompt && (
          <div className="space-y-2">
            <SectionLabel>
              Negative prompt
              <Badge variant="outline" className="ml-2 text-[10px] font-normal">optional</Badge>
            </SectionLabel>
            <Textarea
              placeholder="What to avoid in the image..."
              className="min-h-[60px] resize-y leading-relaxed text-sm"
              value={params.negativePrompt ?? ''}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => set('negativePrompt', e.target.value)}
            />
          </div>
        )}

        {/* Options — two rows of compact switches sharing their row's width: the
            passes that change the picture (two or three, by preset), then sampler
            and memory. Whatever a switch opens, and any note on why one is locked,
            lands under its row (SwitchTile); FaceSwapInput renders its switch and
            settings as row siblings. */}
        <div className="space-y-2">
          <SectionLabel>Options</SectionLabel>
          <div className="flex flex-wrap gap-2">
            {hiresTile('Hi-res 1.5×', 'Hi-res fix: upscale + low-denoise detail pass at 1.5×')}

            {detailerTile('Face detailer', 'Re-draws detected faces for sharper detail', false)}

            {/* Face swap (ReActor) — only for workflows that take a source image */}
            {workflow.supportsInputImage && (
              <FaceSwapInput
                // Same hydration guard as the detailer: availability is fetched from
                // ComfyUI client-side, so gating on `restored` keeps the server HTML
                // and the first client render identical (a `disabled` attribute that
                // differs across the two is a hydration mismatch).
                available={restored ? faceSwapAvailable : null}
                pixelBoostAvailable={restored && pixelBoostAvailable === true}
                enabled={params.faceSwap ?? false}
                source={params.faceSwapSource ?? 'upload'}
                value={params.inputImage}
                faceModel={params.faceModel}
                model={params.faceSwapModel}
                pixelBoost={params.faceSwapPixelBoost}
                pixelBoostSize={params.faceSwapPixelBoostSize}
                identity={params.faceSwapIdentity}
                onToggle={(on) => set('faceSwap', on)}
                onSourceChange={(s) => set('faceSwapSource', s)}
                onChange={(filename) => set('inputImage', filename)}
                onFaceModelChange={(name) => set('faceModel', name)}
                onModelChange={(m) => set('faceSwapModel', m)}
                onPixelBoostChange={(on) => set('faceSwapPixelBoost', on)}
                onPixelBoostSizeChange={(s) => set('faceSwapPixelBoostSize', s)}
                onIdentityChange={(v) => set('faceSwapIdentity', v)}
              />
            )}

          </div>

          <div className="flex flex-wrap gap-2">
            {/* Expert Mode — hand the sampler knobs to the user. Every family offers it,
                including the distilled ones: nudging a turbo model to CFG 1.5-2 is a
                real technique, and the one-time warning covers the rest. Off, none of
                these four values reaches the graph at all (expert-sampler.ts). */}
            {(() => {
              const expert = params.expertMode ?? false
              const d = workflow.defaultParams
              // Fall back to the family's native value, so the panel opens showing what
              // this model actually runs rather than blank fields.
              const steps = params.steps ?? d.steps ?? 20
              const cfg = params.cfg ?? d.cfg ?? 1
              const sampler = params.sampler ?? d.sampler ?? ''
              const scheduler = params.scheduler ?? d.scheduler ?? ''
              const fixedSchedule = workflow.distilledSchedule === true
              // ComfyUI offline leaves the fetched lists empty; keep the current value
              // selectable so the dropdown never renders as blank-and-unrecoverable.
              const withCurrent = (list: string[], current: string) =>
                current && !list.includes(current) ? [current, ...list] : list
              return (
                <>
                  <SwitchTile
                    label="Expert mode"
                    icon={SlidersHorizontal}
                    on={expert}
                    onToggle={requestExpertMode}
                    hint="Set the sampler, scheduler, steps and CFG yourself"
                  />
                  {expert && (
                    <TileBody title="Expert mode">
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1.5">
                          <SectionLabel>Sampler</SectionLabel>
                          <Select value={sampler} onValueChange={(v) => { if (v) set('sampler', v) }}>
                            <SelectTrigger className="h-9 w-full text-sm">
                              <SelectValue placeholder="Sampler" />
                            </SelectTrigger>
                            <SelectContent>
                              {withCurrent(samplerNames, sampler).map((n) => (
                                <SelectItem key={n} value={n} className="font-mono text-xs">{n}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1.5">
                          <SectionLabel>Scheduler</SectionLabel>
                          <Select value={scheduler} disabled={fixedSchedule} onValueChange={(v) => { if (v) set('scheduler', v) }}>
                            <SelectTrigger className="h-9 w-full text-sm">
                              <SelectValue placeholder="Scheduler" />
                            </SelectTrigger>
                            <SelectContent>
                              {withCurrent(schedulerNames, scheduler).map((n) => (
                                <SelectItem key={n} value={n} className="font-mono text-xs">{n}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1.5">
                          <SectionLabel>Steps</SectionLabel>
                          <Input
                            type="number"
                            min={1}
                            max={150}
                            value={steps}
                            disabled={fixedSchedule}
                            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                              set('steps', Math.max(1, Math.min(150, Math.round(Number(e.target.value) || 1))))
                            }
                            className="h-9 font-mono text-sm"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <SectionLabel>CFG</SectionLabel>
                          <Input
                            type="number"
                            min={0}
                            max={30}
                            step={0.5}
                            value={cfg}
                            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                              set('cfg', Math.max(0, Math.min(30, Number(e.target.value) || 0)))
                            }
                            className="h-9 font-mono text-sm"
                          />
                        </div>
                      </div>

                      <p className="text-xs text-muted-foreground">
                        {workflow.name} runs at {d.steps} steps / CFG {d.cfg} on {d.sampler} + {d.scheduler}.
                        {(d.cfg ?? 1) <= 1 && ' It is a distilled model — trained for CFG 1, and it burns above roughly 2.'}
                        {fixedSchedule && ' Its step schedule is part of the distillation, so only the sampler and CFG apply here.'}
                      </p>
                    </TileBody>
                  )}
                </>
              )
            })()}

            {/* Tiled VAE decode — low-VRAM remedy for the peak-memory moment of a render.
                Needs no availability gate: VAEDecodeTiled is a core ComfyUI node, not a
                custom pack, so unlike the detailer it can never be missing. */}
            {(() => {
              const tiled = params.tiledVaeDecode ?? false
              const tileSize = params.tiledVaeTileSize ?? 512
              return (
                <>
                  <SwitchTile
                    label="Tiled VAE"
                    icon={LayoutGrid}
                    on={tiled}
                    onToggle={() => set('tiledVaeDecode', !tiled)}
                    hint="Tiled VAE decode: cuts peak VRAM on the final decode — try this if generation dies at the last step"
                  />
                  {tiled && (
                    <TileBody title="Tiled VAE decode">
                      <div className="flex items-center gap-1.5">
                        <span className="mr-2 text-sm font-medium">Tile size</span>
                        {([384, 512, 768] as const).map((n) => (
                          <Button
                            key={n}
                            variant={tileSize === n ? 'default' : 'outline'}
                            className="h-8 w-16 p-0 text-sm font-semibold"
                            onClick={() => set('tiledVaeTileSize', n)}
                          >
                            {n}
                          </Button>
                        ))}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Smaller saves more VRAM — 384 for ~6 GB cards, 512 for ~8 GB.
                      </p>
                    </TileBody>
                  )}
                </>
              )
            })()}
          </div>

          <ConfirmDialog
            open={expertWarnOpen}
            onOpenChange={setExpertWarnOpen}
            title="Take manual control of the sampler?"
            description="These four values are what each model was tuned for — the distilled ones especially, which are trained to run at CFG 1 and a handful of steps and burn out above that. Change them and renders may come out worse, slower, or both. Switch it back off to restore the model's own settings."
            confirmLabel="Enable anyway"
            onConfirm={confirmExpertMode}
          />
        </div>

        {/* Krea2 NSFW section — three independent things, deliberately grouped:
            an uncensor patch (small corrective LoRA *or* the Kroma retrain, never
            both — they rewrite the same text-fusion tower), Kroma's strength, and
            the projector-scale slider. That last one is mechanically a
            prompt-adherence knob on a different axis than CFG; it is surfaced as
            "filter bypass" because pushing the model back onto the literal prompt
            is what gets a censored or dodged render to come out.
            Every label here is written for someone who has never heard of a LoRA. */}
        {workflow.loraFamily === 'krea2' && (() => {
          const mode = params.krea2Nsfw ?? 'patch'
          const strength = params.krea2ProjectorStrength ?? KREA2_PROJECTOR_DEFAULT
          const kroma = params.krea2KromaStrength ?? KREA2_KROMA_DEFAULT
          const modes = [
            {
              id: 'off' as const,
              label: 'Off',
              hint: 'Stock model',
              installed: true,
              note: 'Krea2 exactly as it ships. It will often add clothing, crop away or quietly ignore an explicit prompt — the model was trained to. Pick this if you want the plain model back.',
            },
            {
              id: 'patch' as const,
              label: 'Uncensor patch',
              hint: '27 MB · recommended',
              installed: krea2Builtins.refusal,
              note: 'A tiny add-on that stops the model second-guessing what you asked for. It does not change the look, the speed or the quality of your images at all — it only removes the reflex to censor. Start here; this is what the app used before this choice existed.',
            },
            {
              id: 'kroma' as const,
              label: 'Kroma',
              hint: '1.9 GB · stronger',
              installed: krea2Builtins.kroma,
              note: 'A fully re-trained version of Krea2 (by lodestones) rather than a small patch. Much more willing, and generally better bodies and skin — but it also changes the overall look of every image, and it is a 1.9 GB download that makes the model slower to load. Use it when the patch above is not enough.',
            },
          ]
          const active = modes.find((m) => m.id === mode)!
          const bypassOn = strength > 0 && krea2Builtins.projector
          return (
            <div className="space-y-2">
              <div className="flex items-center gap-1">
                <SectionLabel>NSFW</SectionLabel>
                <InfoTip label="About the NSFW settings">
                  {modes.map((m) => (
                    <p key={m.id}><span className="font-semibold text-foreground">{m.label}.</span> {m.note}</p>
                  ))}
                  <p>
                    <span className="font-semibold text-foreground">Kroma strength.</span> How much of Kroma to
                    mix in. 1.00 is the full effect and what its author recommends. Drop to 0.70–0.90 if the
                    images start looking too different from normal Krea2.
                  </p>
                  <p>
                    <span className="font-semibold text-foreground">Filter bypass.</span> Forces the model to
                    take your words literally. Separate from the setting above, and works with any of them.
                    Off by default: if a render comes out censored, covered up or simply not what you asked
                    for, switch this on — the starting amount is usually enough. Raise it only if that did
                    not do it; push it too far and the image starts to overcook (burnt colors, crunchy detail).
                  </p>
                </InfoTip>
                {/* On/off switch, then the slider below — "make it stop censoring"
                    is one click, and the number is there for whoever wants it. */}
                <button
                  type="button"
                  role="switch"
                  aria-checked={bypassOn}
                  disabled={!krea2Builtins.projector}
                  onClick={() => set('krea2ProjectorStrength', strength > 0 ? 0 : KREA2_PROJECTOR_ON)}
                  title={krea2Builtins.projector
                    ? 'Forces the model to take your words literally'
                    : 'Install the Krea2 models on the Models page to unlock it'}
                  className="ml-auto inline-flex h-6 items-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Knob on={bypassOn} /> Filter bypass
                </button>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {modes.map((m) => {
                  const selected = mode === m.id
                  return (
                    <button
                      key={m.id}
                      type="button"
                      disabled={!m.installed}
                      onClick={() => set('krea2Nsfw', m.id)}
                      className={`min-w-0 rounded-lg border px-2.5 py-1.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                        selected ? 'border-primary/40 bg-primary/10' : 'border-border bg-muted/30 hover:bg-muted/50'
                      }`}
                    >
                      <span className="block truncate text-sm font-medium">{m.label}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {m.installed ? m.hint : 'not installed'}
                      </span>
                    </button>
                  )
                })}
              </div>
              {!active.installed && (
                <p className="text-xs text-muted-foreground">
                  {active.label} isn&apos;t installed — download it on the Models page first; until then renders use the plain model.
                </p>
              )}

              {/* Kroma replaces the model's own style, so how far it is blended in
                  is the one knob that actually matters for it. */}
              {mode === 'kroma' && krea2Builtins.kroma && (
                <label className="flex items-center gap-3 text-sm">
                  <span className="w-28 shrink-0 font-medium">Kroma strength</span>
                  <input
                    type="range"
                    min={0.1}
                    max={1}
                    step={0.05}
                    value={kroma}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                      set('krea2KromaStrength', Number(e.target.value))
                    }
                    className="min-w-0 flex-1 accent-primary"
                    aria-label="Kroma strength"
                  />
                  <span className="w-12 text-right font-mono tabular-nums text-muted-foreground">{kroma.toFixed(2)}</span>
                </label>
              )}

              {bypassOn && (
                <label className="flex items-center gap-3 text-sm">
                  <span className="w-28 shrink-0 font-medium">Bypass strength</span>
                  <input
                    type="range"
                    min={0.005}
                    max={0.3}
                    step={0.005}
                    value={strength}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                      set('krea2ProjectorStrength', Number(e.target.value))
                    }
                    className="min-w-0 flex-1 accent-primary"
                    aria-label="Krea2 NSFW filter bypass strength"
                  />
                  <span className="w-12 text-right font-mono tabular-nums text-muted-foreground">{strength.toFixed(3)}</span>
                </label>
              )}
            </div>
          )
        })()}

        {/* LoRA selectors — full-width stacked rows so long names never collide
            with the strength field */}
        {workflow.supportsLoRA && (
          <div className="space-y-2">
            <SectionLabel>LoRAs</SectionLabel>
            <div className="space-y-2">
              {(params.loras ?? DEFAULT_LORA_PARAMS).map((lora, i) => (
                <LoraSelector
                  key={i}
                  label={`LoRA ${i + 1}`}
                  family={workflow.loraFamily}
                  value={lora.name}
                  strength={lora.strength ?? 1}
                  onChange={(name, strength) => setParams((p) => ({
                    ...p,
                    loras: (p.loras ?? DEFAULT_LORA_PARAMS).map((item, index) =>
                      index === i ? { name, strength } : item,
                    ),
                  }))}
                  onRemove={() => setParams((p) => ({
                    ...p,
                    loras: (p.loras ?? DEFAULT_LORA_PARAMS).filter((_, index) => index !== i),
                  }))}
                />
              ))}
            </div>

            {(params.loras ?? DEFAULT_LORA_PARAMS).length < MAX_LORAS && (
              <Button
                variant="outline"
                onClick={requestLoraSlot}
                className="h-8 w-full gap-1.5 border-dashed text-xs text-muted-foreground hover:text-foreground"
              >
                <Plus className="h-3.5 w-3.5" />
                Add LoRA
              </Button>
            )}

            <ConfirmDialog
              open={loraWarnOpen}
              onOpenChange={setLoraWarnOpen}
              title="Stack more than 2 LoRAs?"
              description={`Every LoRA patches the same weights, so past two they start competing — expect weaker prompt adherence, muddier detail and drifting color. Lowering each one's strength usually helps. You can stack up to ${MAX_LORAS}.`}
              confirmLabel="Add anyway"
              onConfirm={confirmLoraSlots}
            />
          </div>
        )}
        </>
      )}

      <PromptHelperDialog open={helperOpen && !workflow.referenceSlots} onClose={() => setHelperOpen(false)}
        workflow={workflow} prompt={params.prompt} onUse={(t) => set('prompt', t)} />

      {/* Seed, jobs, batch and Generate stay pinned to the bottom of the panel's
          scroll area — page.tsx gives that area no bottom padding, so this sits
          flush and carries its own. */}
      <div className="sticky bottom-0 z-10 -mx-5 space-y-3 border-t border-border bg-card px-5 pb-5 pt-3">
        <div className="flex items-end gap-3">
          {!simple && (<div className="min-w-0 flex-1 space-y-1.5">
            <SectionLabel title="-1 = random each time">Seed</SectionLabel>
            <div className="flex gap-1.5">
              <Input
                type="number"
                value={params.seed}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => set('seed', Number(e.target.value))}
                title="-1 = random each time"
                className="h-8 min-w-0 flex-1 font-mono text-sm"
              />
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8 shrink-0"
                title="Random each time (-1)"
                onClick={() => set('seed', -1)}
              >
                <Shuffle className="h-4 w-4" />
              </Button>
              {lastJobSeed !== null && lastJobSeed >= 0 && (
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8 shrink-0"
                  onClick={() => set('seed', lastJobSeed)}
                  title={`Use last image's seed (${lastJobSeed})`}
                >
                  <RotateCcw className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>)}

          {/* Job count — how many separate jobs to queue */}
          {!simple && (<div className="space-y-1.5">
            <SectionLabel title="Separate jobs, queued in turn">Jobs</SectionLabel>
            <div className="flex gap-1">
              {[1, 2, 3, 4, 5, 6].map((n) => (
                <Button
                  key={n}
                  variant={(params.jobCount ?? 1) === n ? 'default' : 'outline'}
                  className="h-8 w-7 p-0 text-xs font-semibold"
                  onClick={() => set('jobCount', n)}
                >
                  {n}
                </Button>
              ))}
            </div>
          </div>)}

          {/* Batch — images generated in parallel within one job. Not on the Edit
              preset: an edit renders one picture per job. */}
          {!workflow.referenceSlots && (
            <div className="space-y-1.5">
              <SectionLabel title="Images per job, in parallel">{simple ? 'How many' : 'Batch'}</SectionLabel>
              <div className="flex gap-1">
                {[1, 2, 3, 4].map((n) => (
                  <Button
                    key={n}
                    variant={(params.batchSize ?? 1) === n ? 'default' : 'outline'}
                    className="h-8 w-7 p-0 text-xs font-semibold"
                    onClick={() => set('batchSize', n)}
                  >
                    {n}
                  </Button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Generate button — flips to Cancel while a job is queued or running so
            slow-GPU users can bail out after seeing the live preview. */}
        {hasActiveJob ? (
          <Button
            variant="destructive"
            className="w-full h-11 text-base font-bold shadow-lg"
            onClick={handleCancel}
          >
            <Square className="h-4 w-4 mr-2 fill-current" /> Cancel
          </Button>
        ) : missingStarter ? (
          <DownloadModelButton model={missingStarter} className="w-full h-11 text-base font-bold shadow-lg shadow-primary/25" />
        ) : (
          <Button
            className="w-full h-11 text-base font-bold shadow-lg shadow-primary/25 transition-shadow hover:shadow-primary/40"
            onClick={handleGenerate}
            disabled={isGenerating}
          >
            {isGenerating ? (
              <><Loader2 className="h-5 w-5 mr-2 animate-spin" /> Queuing...</>
            ) : (
              <><Wand2 className="h-5 w-5 mr-2" /> Generate {(() => { const total = (simple ? 1 : params.jobCount ?? 1) * jobBatchSize(workflow, params); return total > 1 ? `× ${total}` : '' })()}</>
            )}
          </Button>
        )}
      </div>
    </div>
  )
}

function SectionLabel({ children, title }: { children: React.ReactNode; title?: string }) {
  return (
    <label title={title} className="flex items-center text-sm font-semibold tracking-tight">
      <span className="mr-2 h-3.5 w-1 rounded-full bg-primary/70" />
      {children}
    </label>
  )
}
