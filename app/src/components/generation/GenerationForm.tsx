'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { useSearchParams } from 'next/navigation'
import { Shuffle, RotateCcw, Wand2, Loader2, Sparkles, Maximize2, Square, ScanFace, Plus, LayoutGrid, SlidersHorizontal } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { workflows } from '@/lib/workflows'
import { FUN_MODEL } from '@/lib/workflows/zimage-controlnet'
import { SDXL_FIX_VAE } from '@/lib/workflows/sdxl'
import { KREA2_REFUSAL_LORA, KREA2_PROJECTOR_LORA, KREA2_PROJECTOR_DEFAULT } from '@/lib/workflows/krea2'
import { FACE_SWAP_NODE, PIXEL_BOOST_NODE } from '@/lib/workflows/face-swap'
import { comboOptions } from '@/lib/models/installed'
import { isAriaModel, effectiveAriaModel } from '@/lib/models/patreon'
import { DEFAULT_LORA_PARAMS, MAX_LORAS, FREE_LORA_SLOTS, EMPTY_LORA_PARAMS } from '@/lib/workflows/lora-chain'
import { negativePromptApplies } from '@/lib/workflows/expert-sampler'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import { useQueueStore } from '@/lib/comfyui/queue'
import { submitPrompt } from '@/lib/comfyui/submit'
import { useStudioStore } from '@/lib/generation/studio-store'
import LoraSelector from './LoraSelector'
import FaceSwapInput from './FaceSwapInput'
import BaseImageInput from './BaseImageInput'
import ControlNetInput from './ControlNetInput'
import IpAdapterInput from './IpAdapterInput'
import type { MaskBrushHandle } from './MaskBrush'
import PromptPresets from './PromptPresets'
import WildcardManager from './WildcardManager'
import { expandWildcards, hasWildcards } from '@/lib/prompts/wildcards-expand'
import { uploadImageBlob } from '@/lib/generation/upload'
import type { WildcardLists } from '@/lib/prompts/store'
import type { GenerationParams } from '@/types/workflow'
import { parseGalleryLoras } from '@/lib/gallery/lora-transfer'

// Persists the workflow choice and all form params across reloads (localStorage).
const FORM_STORAGE_KEY = 'raccoon-studio:generate-form'
// Remembers that the user accepted the >2-LoRA quality warning, so the dialog is
// a one-time gate rather than a nag on every reload. The slot count itself is
// not persisted — sessions start at two, same as the selections.
const LORA_ACK_KEY = 'raccoon-studio:lora-stack-ack'
// Same one-time-gate treatment for Expert Mode: the sampler settings a family
// ships are what it was tuned for, so the first unlock asks once per browser.
const EXPERT_ACK_KEY = 'raccoon-studio:expert-mode-ack'

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
  // Per-model prompt memory: each model preset keeps its own last-used
  // prompt/negative for this session, so switching presets restores that
  // model's text (or its defaults on first visit) instead of leaking one
  // family's quality-tag convention into another.
  // ponytail: in-memory only (resets on reload); persist per-model if users ask.
  const [promptStash, setPromptStash] = useState<Record<string, { prompt: string; negativePrompt: string }>>({})
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
  // Aria models come from three ComfyUI loaders; which one the active workflow
  // uses is decided by workflow.ariaModelKind: 'checkpoint' (SDXL family →
  // CheckpointLoaderSimple), 'unet' (z-image/ernie/anima → UNETLoader), or
  // 'lora' (legacy LoraLoader).
  const [ariaCheckpoints, setAriaCheckpoints] = useState<string[]>([])
  const [ariaLoras, setAriaLoras] = useState<string[]>([])
  const [ariaUnets, setAriaUnets] = useState<string[]>([])
  // True once all three lists above reflect a real answer from ComfyUI. Until
  // then they are indistinguishable from "this install has no Aria models", and
  // a stale `params.ariaModel` must not be cleared on that basis.
  const [ariaLoaded, setAriaLoaded] = useState(false)
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
  const [zControlNetAvailable, setZControlNetAvailable] = useState<boolean | null>(null)
  // Whether the dedicated SDXL fp16-fix VAE is installed (cures washed-out
  // colors on SDXL checkpoints with a bad baked VAE, e.g. Illustrious). When
  // present, SDXL-family jobs decode through it instead of the checkpoint VAE.
  const [sdxlVaeAvailable, setSdxlVaeAvailable] = useState(false)
  // Which of Krea2's two built-in LoRAs are actually on disk. They are patched
  // in outside the user's LoRA slots — refusal reduction at a fixed strength 1,
  // projector scale on the slider below — and ComfyUI rejects an unknown
  // lora_name outright, so neither is ever passed until it has been seen here.
  const [krea2Builtins, setKrea2Builtins] = useState({ refusal: false, projector: false })
  // Gate persistence until the saved session has been restored, so the first
  // render's defaults don't overwrite what we're about to load.
  const [restored, setRestored] = useState(false)

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

  // Detect imported Aria models. SDXL-family workflows use Aria *checkpoints*
  // (CheckpointLoaderSimple); the diffusion families (z-image/ernie/anima) use
  // Aria *diffusion models* (UNETLoader). The LoraLoader list is kept for the
  // legacy 'lora' kind.
  useEffect(() => {
    // Resolves true only when ComfyUI actually answered, so `ariaLoaded` below
    // never treats an offline install as "no Aria models".
    const load = async (node: string, field: string, set: (v: string[]) => void) => {
      try {
        const d = await (await fetch(`/api/comfyui/object_info/${node}`)).json()
        const names = comboOptions(d, node, field)
        set(names.filter(isAriaModel))
        return true
      } catch { /* ComfyUI offline — leave list empty */ return false }
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
      load('CheckpointLoaderSimple', 'ckpt_name', setAriaCheckpoints),
      load('LoraLoader', 'lora_name', setAriaLoras),
      load('UNETLoader', 'unet_name', setAriaUnets),
    ]).then((ok) => setAriaLoaded(ok.every(Boolean)))
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
    const checkKrea2Builtins = async () => {
      try {
        const d = await (await fetch('/api/comfyui/object_info/LoraLoader')).json()
        const names = comboOptions(d, 'LoraLoader', 'lora_name')
        // ComfyUI reports subfolders with OS separators; match on the leaf.
        const has = (file: string) =>
          names.some((n) => n === file || n.replace(/\\/g, '/').endsWith('/' + file))
        setKrea2Builtins({ refusal: has(KREA2_REFUSAL_LORA), projector: has(KREA2_PROJECTOR_LORA) })
      } catch {
        setKrea2Builtins({ refusal: false, projector: false })
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
        setZControlNetAvailable(
          Boolean(qn?.QwenImageDiffsynthControlnet) &&
            Array.isArray(patchNames) && patchNames.includes(FUN_MODEL),
        )
      } catch {
        setControlNetAvailable(false)
        setIpAdapterAvailable(false)
        setZControlNetAvailable(false)
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
  // Only claim prefills naming an image workflow, and only clear what we claimed:
  // this form is mounted on /generate while "send to Generate Videos" sets a video
  // prefill, so clearing one we can't apply would destroy the video tab's seed
  // before that tab ever mounts.
  useEffect(() => {
    if (!prefill) return
    const found = workflows.find((w) => w.id === prefill.workflowId)
    if (!found) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing form from the prefill store
    setWorkflowId(prefill.workflowId)
    setParams((p) => ({ ...p, ...found.defaultParams, ...prefill.params }))
    setPrefill(null)
  }, [prefill, setPrefill])

  // Prefill from gallery "Send to Generate"
  useEffect(() => {
    const prompt = searchParams.get('prompt')
    const negative = searchParams.get('negative')
    const seed = searchParams.get('seed')
    const wf = searchParams.get('workflow')
    const loras = parseGalleryLoras(searchParams.get('loras'))
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
      }))
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
    void onUseBaseUrl(base)
  }, [searchParams, onUseBaseUrl])

  // Restore the previous session's workflow + params on mount, unless the user
  // arrived via a gallery "Send to Generate" link (those URL params win).
  useEffect(() => {
    const hasQuery = !!(
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
          if (saved.workflowId && workflows.some((w) => w.id === saved.workflowId)) {
            setWorkflowId(saved.workflowId)
          }
          if (saved.params) {
            setParams((p) => ({ ...p, ...saved.params }))
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

  const set = (key: keyof GenerationParams, value: unknown) =>
    setParams((p) => ({ ...p, [key]: value }))

  // Slots past the free two are gated once per browser: stacked LoRAs compete for
  // the same weights, so the user acknowledges the quality cost before unlocking.
  const addLoraSlot = () =>
    setParams((p) => {
      const rows = p.loras ?? DEFAULT_LORA_PARAMS
      return rows.length >= MAX_LORAS ? p : { ...p, loras: [...rows, { name: '', strength: 1 }] }
    })
  const requestLoraSlot = () => {
    let acked = false
    try { acked = localStorage.getItem(LORA_ACK_KEY) === '1' } catch { /* unavailable */ }
    if ((params.loras?.length ?? FREE_LORA_SLOTS) >= FREE_LORA_SLOTS && !acked) setLoraWarnOpen(true)
    else addLoraSlot()
  }
  const confirmLoraSlots = () => {
    try { localStorage.setItem(LORA_ACK_KEY, '1') } catch { /* quota or unavailable */ }
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

  // The Aria/Patreon model picker swaps the generation model once an Aria model
  // has been imported (muscgi/muscgro are excluded upstream by isAriaModel).
  // SDXL-family picks an Aria checkpoint; diffusion families (z-image/ernie/
  // anima) pick an Aria diffusion model (UNET); the legacy lora kind picks an
  // Aria LoRA.
  const ariaModels =
    workflow.ariaModelKind === 'checkpoint'
      ? ariaCheckpoints
      : workflow.ariaModelKind === 'unet'
        ? ariaUnets
        : ariaLoras
  // `ariaModel` is persisted and shared across families, so it outlives both the
  // preset switch that makes it wrong and the install that made it exist.
  // Derived rather than written back to state: leaving the raw value in storage
  // means re-importing the model restores the choice instead of losing it.
  const ariaModel = effectiveAriaModel(params.ariaModel, ariaModels, ariaLoaded)

  const handleGenerate = useCallback(async () => {
    if (!params.prompt.trim()) {
      toast.error('Please enter a prompt')
      return
    }
    setIsGenerating(true)
    cancelledRef.current = false
    const count = params.jobCount ?? 1
    const isKrea2 = workflow.loraFamily === 'krea2'
    let queued = 0
    try {
      // Reference-guidance modes need an uploaded reference: toggling the section
      // on leaves image '' until a file is picked, and a LoadImage with no file
      // fails ComfyUI validation. Guard up front (mirrors the inpaint-mask guard).
      if (params.controlNet && !params.controlNet.image) {
        toast.error('Upload a ControlNet reference image first')
        return
      }
      if (params.ipAdapter && !params.ipAdapter.image) {
        toast.error('Upload an IP-Adapter reference image first')
        return
      }
      // Masked modes share one painted mask across the batch: render + upload it
      // once. Inpaint requires a painted area; outpaint derives its mask from the
      // pad node, so it needs none.
      let maskImage = params.maskImage
      const isMaskMode = !!params.baseImage && (params.editMode === 'inpaint' || params.editMode === 'outpaint')
      if (params.baseImage && params.editMode === 'inpaint') {
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
        const seed = params.seed < 0 ? Math.floor(Math.random() * 9999999999999) : params.seed
        const jobParams = {
          ...params,
          seed,
          ...(maskImage ? { maskImage } : {}),
          // Hi-res fix defaults off for inpaint/outpaint (it works on the full
          // image and fights a localized edit), but stays user-overridable.
          upscale: params.upscale ?? (isMaskMode ? false : true),
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
          // Krea2 family: patch in the two built-in LoRAs, but only the ones
          // ComfyUI actually reports — an unknown lora_name is rejected with
          // value_not_in_list, which surfaces as a bare "Generation failed".
          ...(isKrea2 && krea2Builtins.refusal ? { krea2RefusalLora: KREA2_REFUSAL_LORA } : {}),
          ...(isKrea2 && krea2Builtins.projector ? { krea2ProjectorLora: KREA2_PROJECTOR_LORA } : {}),
          // Same guard, for the imported Aria model: every family injects this
          // into its own loader, so one that belongs to another family or whose
          // file is gone takes the whole prompt down with value_not_in_list.
          ariaModel,
        }
        // Expand wildcards per job so each job in a batch re-rolls independently,
        // and the resolved text (not the template) is what's built + recorded.
        jobParams.prompt = expandWildcards(jobParams.prompt, wildcardLists)
        if (jobParams.negativePrompt) jobParams.negativePrompt = expandWildcards(jobParams.negativePrompt, wildcardLists)
        const prompt = workflow.buildPrompt(jobParams)
        const prompt_id = await submitPrompt({ prompt, client_id: clientId, extra_data: { preview_method: 'auto' } })
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
  }, [params, workflow, workflowId, clientId, addJob, faceDetailerAvailable, faceSwapAvailable,
      pixelBoostAvailable, sdxlVaeAvailable, krea2Builtins, wildcardLists, ariaModel])

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

  const showModelPicker =
    ariaModels.length > 0 &&
    (workflow.ariaModelKind === 'checkpoint' ||
      workflow.ariaModelKind === 'unet' ||
      workflow.supportsLoRA)

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
      </div>

      {/* Workflow selector */}
      <div className="space-y-2">
        <SectionLabel>Model preset</SectionLabel>
        <div className="flex gap-2 flex-wrap">
          {workflows.map((w) => (
            <Button
              key={w.id}
              variant={workflowId === w.id ? 'default' : 'outline'}
              className="h-9 px-3.5 text-sm"
              onClick={() => {
                if (w.id === workflowId) return
                // Stash the outgoing model's prompt boxes, then restore the
                // incoming model's last-used text — or its own defaults (e.g.
                // Anima's quality tags) on first visit, else empty.
                setPromptStash((s) => ({ ...s, [workflowId]: { prompt: params.prompt, negativePrompt: params.negativePrompt ?? '' } }))
                setWorkflowId(w.id)
                const stashed = promptStash[w.id]
                // LoRAs are model-family-specific (an SDXL LoRA won't load on
                // Z-Image, etc.), so a switch always resets both slots to None
                // rather than carrying a now-invalid selection into the new model.
                setParams((p) => ({
                  ...p,
                  ...EMPTY_LORA_PARAMS,
                  ...w.defaultParams,
                  prompt: stashed?.prompt ?? w.defaultParams.prompt ?? '',
                  negativePrompt: stashed?.negativePrompt ?? w.defaultParams.negativePrompt ?? '',
                }))
              }}
            >
              {w.name}
            </Button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground leading-snug line-clamp-2">{workflow.description}</p>
      </div>

      {/* Model picker + aspect ratio — two columns so the panel stays one page.
          When no Aria model is available, aspect ratio spans the full width. */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-3">
        {showModelPicker && (
          <div className="space-y-2">
            <SectionLabel>
              Model
              <Badge variant="outline" className="ml-2 text-[10px] font-normal">Aria</Badge>
            </SectionLabel>
            <Select
              value={ariaModel || 'base'}
              onValueChange={(v) => set('ariaModel', (v ?? 'base') === 'base' ? undefined : v)}
            >
              <SelectTrigger className="h-9 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="base">Base {workflow.name}</SelectItem>
                {ariaModels.map((m) => (
                  <SelectItem key={m} value={m}>{(m.split('/').pop() ?? m).replace('.safetensors', '')}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <div className={`space-y-2 ${showModelPicker ? '' : 'col-span-2'}`}>
          <div className="flex items-center justify-between">
            <SectionLabel>Aspect ratio</SectionLabel>
            <span className="text-xs font-mono text-muted-foreground tabular-nums">
              {params.width} × {params.height}
            </span>
          </div>
          <div className="flex gap-2 flex-wrap">
            {workflow.aspectRatios.map((r) => (
              <Button
                key={r.label}
                variant={selectedRatio?.label === r.label ? 'default' : 'outline'}
                className="h-9 px-3 text-sm"
                onClick={() => setParams((p) => ({ ...p, width: r.width, height: r.height }))}
              >
                {r.label}
              </Button>
            ))}
          </div>
        </div>
      </div>

      {/* Base image — img2img / inpaint / outpaint */}
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

      {/* Reference guidance — ControlNet + IP-Adapter (SDXL family only) */}
      {(workflow.supportsControlNet || workflow.supportsIpAdapter) && (
        <div className="space-y-2">
          {workflow.supportsControlNet && (
            <ControlNetInput
              value={params.controlNet}
              available={restored && (
                workflow.controlNetKind === 'zimage-fun'
                  ? zControlNetAvailable === true
                  : controlNetAvailable === true
              )}
              unavailableHint={
                workflow.controlNetKind === 'zimage-fun'
                  ? 'Requires Z-Image Fun ControlNet model (get it in Models)'
                  : 'Requires ControlNet Union model (get it in Models)'
              }
              onChange={(v) => set('controlNet', v)}
            />
          )}
          {workflow.supportsIpAdapter && (
            <IpAdapterInput
              value={params.ipAdapter}
              available={restored && ipAdapterAvailable === true}
              onChange={(v) => set('ipAdapter', v)}
            />
          )}
        </div>
      )}

      {/* Prompt */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <SectionLabel>Prompt</SectionLabel>
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
          </div>
        </div>
        <Textarea
          placeholder="Describe the image you want to create..."
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

      {/* Prompt enhancer toggle */}
      {workflow.supportsPromptEnhancer && (
        <button
          type="button"
          role="switch"
          aria-checked={params.promptEnhancer}
          onClick={() => set('promptEnhancer', !params.promptEnhancer)}
          className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left transition-colors ${
            params.promptEnhancer
              ? 'border-primary/40 bg-primary/10'
              : 'border-border bg-muted/30 hover:bg-muted/50'
          }`}
        >
          <span
            className={`relative inline-flex h-6 w-11 shrink-0 rounded-full transition-colors ${
              params.promptEnhancer ? 'bg-primary' : 'bg-input'
            }`}
          >
            <span
              className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-background shadow-sm transition-transform mt-0.5 ${
                params.promptEnhancer ? 'translate-x-[1.375rem]' : 'translate-x-0.5'
              }`}
            />
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-semibold">Prompt enhancer</span>
            <span className="block text-xs text-muted-foreground">AI rewrites your prompt for better results</span>
          </span>
        </button>
      )}

      {/* Face swap (ReActor) — only for workflows that take a source image */}
      {workflow.supportsInputImage && (
        <FaceSwapInput
          // Same hydration guard as the detailer: availability is fetched from
          // ComfyUI client-side, so gating on `restored` keeps the server HTML
          // and the first client render identical (a `disabled` attribute that
          // differs across the two is a hydration mismatch).
          available={restored && faceSwapAvailable === true}
          pixelBoostAvailable={restored && pixelBoostAvailable === true}
          enabled={params.faceSwap ?? false}
          source={params.faceSwapSource ?? 'upload'}
          value={params.inputImage}
          faceModel={params.faceModel}
          model={params.faceSwapModel}
          pixelBoost={params.faceSwapPixelBoost}
          pixelBoostSize={params.faceSwapPixelBoostSize}
          onToggle={(on) => set('faceSwap', on)}
          onSourceChange={(s) => set('faceSwapSource', s)}
          onChange={(filename) => set('inputImage', filename)}
          onFaceModelChange={(name) => set('faceModel', name)}
          onModelChange={(m) => set('faceSwapModel', m)}
          onPixelBoostChange={(on) => set('faceSwapPixelBoost', on)}
          onPixelBoostSizeChange={(s) => set('faceSwapPixelBoostSize', s)}
        />
      )}

      {/* Upscale toggle — final net-1.5× model upscale (on by default, but off by
          default for inpaint/outpaint, where it fights a localized edit). */}
      {workflow.supportsUpscale && (() => {
        const isMaskMode = !!params.baseImage && (params.editMode === 'inpaint' || params.editMode === 'outpaint')
        const upscale = params.upscale ?? (isMaskMode ? false : true)
        return (
          <button
            type="button"
            role="switch"
            aria-checked={upscale}
            onClick={() => set('upscale', !upscale)}
            className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left transition-colors ${
              upscale ? 'border-primary/40 bg-primary/10' : 'border-border bg-muted/30 hover:bg-muted/50'
            }`}
          >
            <span
              className={`relative inline-flex h-6 w-11 shrink-0 rounded-full transition-colors ${
                upscale ? 'bg-primary' : 'bg-input'
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-background shadow-sm transition-transform mt-0.5 ${
                  upscale ? 'translate-x-[1.375rem]' : 'translate-x-0.5'
                }`}
              />
            </span>
            <span className="min-w-0 flex items-center gap-2">
              <Maximize2 className="h-4 w-4 shrink-0 text-primary" />
              <span>
                <span className="block text-sm font-semibold">Hi-res fix 1.5×</span>
                <span className="block text-xs text-muted-foreground">Upscale + low-denoise detail pass at 1.5×</span>
              </span>
            </span>
          </button>
        )
      })()}

      {/* Tiled VAE decode — low-VRAM remedy for the peak-memory moment of a render.
          Needs no availability gate: VAEDecodeTiled is a core ComfyUI node, not a
          custom pack, so unlike the detailer it can never be missing. */}
      {(() => {
        const tiled = params.tiledVaeDecode ?? false
        const tileSize = params.tiledVaeTileSize ?? 512
        return (
          <div className="space-y-2">
            <button
              type="button"
              role="switch"
              aria-checked={tiled}
              onClick={() => set('tiledVaeDecode', !tiled)}
              className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left transition-colors ${
                tiled ? 'border-primary/40 bg-primary/10' : 'border-border bg-muted/30 hover:bg-muted/50'
              }`}
            >
              <span
                className={`relative inline-flex h-6 w-11 shrink-0 rounded-full transition-colors ${
                  tiled ? 'bg-primary' : 'bg-input'
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-background shadow-sm transition-transform mt-0.5 ${
                    tiled ? 'translate-x-[1.375rem]' : 'translate-x-0.5'
                  }`}
                />
              </span>
              <span className="min-w-0 flex items-center gap-2">
                <LayoutGrid className="h-4 w-4 shrink-0 text-primary" />
                <span>
                  <span className="block text-sm font-semibold">Tiled VAE decode</span>
                  <span className="block text-xs text-muted-foreground">
                    Cuts peak VRAM on the final decode — try this if generation dies at the last step
                  </span>
                </span>
              </span>
            </button>
            {tiled && (
              <div className="space-y-2 pl-3">
                <div className="flex gap-1.5">
                  {([384, 512, 768] as const).map((n) => (
                    <Button
                      key={n}
                      variant={tileSize === n ? 'default' : 'outline'}
                      className="h-9 flex-1 min-w-0 p-0 text-sm font-semibold"
                      onClick={() => set('tiledVaeTileSize', n)}
                    >
                      {n}
                    </Button>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  Tile size — smaller saves more VRAM. 384 for ~6 GB cards, 512 for ~8 GB.
                </p>
              </div>
            )}
          </div>
        )
      })()}

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
        // ComfyUI offline leaves the fetched lists empty; keep the current value
        // selectable so the dropdown never renders as blank-and-unrecoverable.
        const withCurrent = (list: string[], current: string) =>
          current && !list.includes(current) ? [current, ...list] : list
        return (
          <div className="space-y-2">
            <button
              type="button"
              role="switch"
              aria-checked={expert}
              onClick={requestExpertMode}
              className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left transition-colors ${
                expert ? 'border-primary/40 bg-primary/10' : 'border-border bg-muted/30 hover:bg-muted/50'
              }`}
            >
              <span
                className={`relative inline-flex h-6 w-11 shrink-0 rounded-full transition-colors ${
                  expert ? 'bg-primary' : 'bg-input'
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-background shadow-sm transition-transform mt-0.5 ${
                    expert ? 'translate-x-[1.375rem]' : 'translate-x-0.5'
                  }`}
                />
              </span>
              <span className="min-w-0 flex items-center gap-2">
                <SlidersHorizontal className="h-4 w-4 shrink-0 text-primary" />
                <span>
                  <span className="block text-sm font-semibold">Expert mode</span>
                  <span className="block text-xs text-muted-foreground">
                    Set the sampler, scheduler, steps and CFG yourself
                  </span>
                </span>
              </span>
            </button>

            {expert && (
              <div className="space-y-3 pl-3">
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
                    <Select value={scheduler} onValueChange={(v) => { if (v) set('scheduler', v) }}>
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
                  {' '}Switch expert mode off to restore all four.
                </p>
              </div>
            )}

            <ConfirmDialog
              open={expertWarnOpen}
              onOpenChange={setExpertWarnOpen}
              title="Take manual control of the sampler?"
              description="These four values are what each model was tuned for — the distilled ones especially, which are trained to run at CFG 1 and a handful of steps and burn out above that. Change them and renders may come out worse, slower, or both. Switch it back off to restore the model's own settings."
              confirmLabel="Enable anyway"
              onConfirm={confirmExpertMode}
            />
          </div>
        )
      })()}

      {/* Face detailer toggle — detect-crop-redraw-paste over faces (on by default) */}
      {workflow.supportsDetailer && (() => {
        const detailer = params.detailer ?? true
        // `faceDetailerAvailable` is fetched from ComfyUI client-side, so the
        // server can't know it at SSR time. Gate it behind `restored` (flips true
        // in a mount-only effect) so the server HTML and the first client render
        // are identical — otherwise the toggle's `disabled` attribute mismatches
        // on hydration. Real availability takes effect after mount.
        const available = restored && faceDetailerAvailable === true
        const disabled = !available
        const active = available && detailer
        return (
          <button
            type="button"
            role="switch"
            aria-checked={active}
            disabled={disabled}
            onClick={() => available && set('detailer', !detailer)}
            className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left transition-colors ${
              !available
                ? 'border-border bg-muted/20 opacity-60 cursor-not-allowed'
                : active
                ? 'border-primary/40 bg-primary/10'
                : 'border-border bg-muted/30 hover:bg-muted/50'
            }`}
          >
            <span
              className={`relative inline-flex h-6 w-11 shrink-0 rounded-full transition-colors ${
                active ? 'bg-primary' : 'bg-input'
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-background shadow-sm transition-transform mt-0.5 ${
                  active ? 'translate-x-[1.375rem]' : 'translate-x-0.5'
                }`}
              />
            </span>
            <span className="min-w-0 flex items-center gap-2">
              <ScanFace className="h-4 w-4 shrink-0 text-primary" />
              <span>
                <span className="block text-sm font-semibold">Face detailer</span>
                <span className="block text-xs text-muted-foreground">
                  {available
                    ? 'Re-draws detected faces for sharper detail'
                    : 'Requires ComfyUI Impact Pack'}
                </span>
              </span>
            </span>
          </button>
        )
      })()}

      {/* Krea2 built-ins: the refusal-reduction patch is fixed at strength 1 and
          has no control; the projector-scale patch gets a slider. Mechanically
          it is a prompt-adherence knob on a different axis than CFG — it is
          surfaced as "NSFW filter" because pushing the model back onto the
          literal prompt is what gets a censored or dodged render to come out. */}
      {workflow.loraFamily === 'krea2' && (() => {
        const strength = params.krea2ProjectorStrength ?? KREA2_PROJECTOR_DEFAULT
        return (
          <div className="space-y-2">
            <SectionLabel>NSFW filter</SectionLabel>
            {krea2Builtins.projector ? (
              <div className="space-y-1.5 rounded-xl border border-border bg-muted/30 p-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium">Filter bypass</span>
                  <span className="font-mono tabular-nums text-muted-foreground">
                    {strength === 0 ? 'off' : strength.toFixed(3)}
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={0.3}
                  step={0.005}
                  value={strength}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    set('krea2ProjectorStrength', Number(e.target.value))
                  }
                  className="w-full accent-primary"
                  aria-label="Krea2 NSFW filter bypass"
                />
                <p className="text-xs text-muted-foreground">
                  Off by default. If a render comes out censored, covered up or simply not what you
                  asked for, raise this a little — a nudge is usually enough. Push it too far and the
                  image starts to overcook.
                </p>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                Install the Krea2 models on the Models page to unlock the NSFW filter and
                refusal-reduction patches.
              </p>
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

      {/* Seed — full width so the input + controls have room */}
      <div className="space-y-2">
        <SectionLabel>Seed</SectionLabel>
        <div className="flex gap-2">
          <Input
            type="number"
            value={params.seed}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => set('seed', Number(e.target.value))}
            className="h-9 flex-1 min-w-0 font-mono text-sm"
          />
          <Button
            variant="outline"
            size="icon"
            className="h-9 w-9 shrink-0"
            title="Randomize"
            onClick={() => set('seed', -1)}
          >
            <Shuffle className="h-4 w-4" />
          </Button>
          {lastJobSeed !== null && lastJobSeed >= 0 && (
            <Button
              variant="outline"
              size="icon"
              className="h-9 w-9 shrink-0"
              onClick={() => set('seed', lastJobSeed)}
              title={`Use last image's seed (${lastJobSeed})`}
            >
              <RotateCcw className="h-4 w-4" />
            </Button>
          )}
        </div>
        <p className="text-xs text-muted-foreground">-1 = random each time</p>
      </div>

      {/* Job count + parallel batch */}
      <div className="grid grid-cols-2 gap-4">
        {/* Job count — how many separate jobs to queue */}
        <div className="space-y-2">
          <SectionLabel>Job Count</SectionLabel>
          <div className="flex gap-1.5">
            {[1, 2, 3, 4, 5, 6].map((n) => (
              <Button
                key={n}
                variant={(params.jobCount ?? 1) === n ? 'default' : 'outline'}
                className="h-9 flex-1 min-w-0 p-0 text-sm font-semibold"
                onClick={() => set('jobCount', n)}
              >
                {n}
              </Button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">Separate jobs, queued in turn</p>
        </div>

        {/* Batch — images generated in parallel within one job */}
        <div className="space-y-2">
          <SectionLabel>Batch</SectionLabel>
          <div className="flex gap-1.5">
            {[1, 2, 3, 4].map((n) => (
              <Button
                key={n}
                variant={(params.batchSize ?? 1) === n ? 'default' : 'outline'}
                className="h-9 flex-1 min-w-0 p-0 text-sm font-semibold"
                onClick={() => set('batchSize', n)}
              >
                {n}
              </Button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">Images per job, in parallel</p>
        </div>
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
      ) : (
        <Button
          className="w-full h-11 text-base font-bold shadow-lg shadow-primary/25 transition-shadow hover:shadow-primary/40"
          onClick={handleGenerate}
          disabled={isGenerating}
        >
          {isGenerating ? (
            <><Loader2 className="h-5 w-5 mr-2 animate-spin" /> Queuing...</>
          ) : (
            <><Wand2 className="h-5 w-5 mr-2" /> Generate {(() => { const total = (params.jobCount ?? 1) * (params.batchSize ?? 1); return total > 1 ? `× ${total}` : '' })()}</>
          )}
        </Button>
      )}
    </div>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <label className="flex items-center text-sm font-semibold tracking-tight">
      <span className="mr-2 h-3.5 w-1 rounded-full bg-primary/70" />
      {children}
    </label>
  )
}
