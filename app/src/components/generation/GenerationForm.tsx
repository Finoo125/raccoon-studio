'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { useSearchParams } from 'next/navigation'
import { Shuffle, RotateCcw, Wand2, Loader2, Sparkles, Maximize2, Square, ScanFace } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { workflows } from '@/lib/workflows'
import { FUN_MODEL } from '@/lib/workflows/zimage-controlnet'
import { SDXL_FIX_VAE } from '@/lib/workflows/sdxl'
import { isAriaModel } from '@/lib/models/patreon'
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

// Persists the workflow choice and all form params across reloads (localStorage).
const FORM_STORAGE_KEY = 'raccoon-studio:generate-form'

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
    ...workflows[0].defaultParams,
  })
  // Per-model prompt memory: each model preset keeps its own last-used
  // prompt/negative for this session, so switching presets restores that
  // model's text (or its defaults on first visit) instead of leaking one
  // family's quality-tag convention into another.
  // ponytail: in-memory only (resets on reload); persist per-model if users ask.
  const [promptStash, setPromptStash] = useState<Record<string, { prompt: string; negativePrompt: string }>>({})
  const [isGenerating, setIsGenerating] = useState(false)
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
  // Whether ComfyUI has the FaceDetailer node (Impact Pack installed).
  // null = still loading; false = unavailable; true = available.
  const [faceDetailerAvailable, setFaceDetailerAvailable] = useState<boolean | null>(null)
  // Whether ComfyUI has the ControlNet Aux + IP-Adapter Plus nodes installed.
  const [controlNetAvailable, setControlNetAvailable] = useState<boolean | null>(null)
  const [ipAdapterAvailable, setIpAdapterAvailable] = useState<boolean | null>(null)
  const [zControlNetAvailable, setZControlNetAvailable] = useState<boolean | null>(null)
  // Whether the dedicated SDXL fp16-fix VAE is installed (cures washed-out
  // colors on SDXL checkpoints with a bad baked VAE, e.g. Illustrious). When
  // present, SDXL-family jobs decode through it instead of the checkpoint VAE.
  const [sdxlVaeAvailable, setSdxlVaeAvailable] = useState(false)
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
    const load = async (node: string, field: string, set: (v: string[]) => void) => {
      try {
        const d = await (await fetch(`/api/comfyui/object_info/${node}`)).json()
        const names = d?.[node]?.input?.required?.[field]?.[0] as string[] | undefined
        if (Array.isArray(names)) set(names.filter(isAriaModel))
      } catch { /* ComfyUI offline — leave list empty */ }
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
    void load('CheckpointLoaderSimple', 'ckpt_name', setAriaCheckpoints)
    void load('LoraLoader', 'lora_name', setAriaLoras)
    void load('UNETLoader', 'unet_name', setAriaUnets)
    void checkDetailer()
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

  // Prefill from history strip "Regenerate"
  useEffect(() => {
    if (!prefill) return
    const found = workflows.find((w) => w.id === prefill.workflowId)
    if (found) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing form from the prefill store
      setWorkflowId(prefill.workflowId)
      setParams((p) => ({ ...p, ...found.defaultParams, ...prefill.params }))
    }
    setPrefill(null)
  }, [prefill, setPrefill])

  // Prefill from gallery "Send to Generate"
  useEffect(() => {
    const prompt = searchParams.get('prompt')
    const negative = searchParams.get('negative')
    const seed = searchParams.get('seed')
    const wf = searchParams.get('workflow')
    if (prompt || negative || seed || wf) {
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
      searchParams.get('workflow')
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
          // LoRA slots always restore to None (matching the new-session default
          // for every model): a persisted selection may have been uninstalled
          // since, and forwarding a missing LoRA name fails ComfyUI validation.
          // Overriding here — not just when re-persisting — guarantees the live
          // form never carries a stale LoRA, even from a blob written by an
          // older build.
          if (saved.params) {
            setParams((p) => ({ ...p, ...saved.params, lora1: '', lora2: '', lora1Strength: 1, lora2Strength: 1 }))
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
  // the user can no longer see. LoRA slots are dropped too: they default to None
  // every session so a selection that was since uninstalled (or belongs to a
  // different model family) can't silently persist and fail ComfyUI validation.
  useEffect(() => {
    if (!restored) return
    try {
      localStorage.setItem(
        FORM_STORAGE_KEY,
        JSON.stringify({ workflowId, params: { ...params, inputImage: undefined, baseImage: undefined, maskImage: undefined, controlNet: undefined, ipAdapter: undefined, lora1: '', lora2: '', lora1Strength: 1, lora2Strength: 1 } }),
      )
    } catch {
      /* quota or unavailable — non-fatal */
    }
  }, [restored, workflowId, params])

  const set = (key: keyof GenerationParams, value: unknown) =>
    setParams((p) => ({ ...p, [key]: value }))

  const handleGenerate = useCallback(async () => {
    if (!params.prompt.trim()) {
      toast.error('Please enter a prompt')
      return
    }
    setIsGenerating(true)
    cancelledRef.current = false
    const count = params.jobCount ?? 1
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
          // SDXL family: decode through the fp16-fix VAE when installed (fixes
          // washed-out colors). Gated on availability so it never references a
          // VAE that isn't there.
          ...(workflow.controlNetKind === 'sdxl-union' && sdxlVaeAvailable ? { sdxlVae: SDXL_FIX_VAE } : {}),
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
  }, [params, workflow, workflowId, clientId, addJob, faceDetailerAvailable, sdxlVaeAvailable, wildcardLists])

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
                  lora1: '', lora2: '', lora1Strength: 1, lora2Strength: 1,
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
              value={params.ariaModel || 'base'}
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

      {/* Negative prompt — only for workflows that support it */}
      {workflow.supportsNegativePrompt && (
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

      {/* LoRA selectors — full-width stacked rows so long names never collide
          with the strength field */}
      {workflow.supportsLoRA && (
        <div className="space-y-2">
          <SectionLabel>LoRAs</SectionLabel>
          <div className="space-y-2">
            <LoraSelector
              label="LoRA 1"
              value={params.lora1 ?? ''}
              strength={params.lora1Strength ?? 1}
              onChange={(lora, strength) => setParams((p) => ({ ...p, lora1: lora, lora1Strength: strength }))}
            />
            <LoraSelector
              label="LoRA 2"
              value={params.lora2 ?? ''}
              strength={params.lora2Strength ?? 1}
              onChange={(lora, strength) => setParams((p) => ({ ...p, lora2: lora, lora2Strength: strength }))}
            />
          </div>
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
