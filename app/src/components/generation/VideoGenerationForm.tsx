'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { Shuffle, RotateCcw, Clapperboard, Loader2, Upload, X, ImageIcon, Square, ChevronDown, SlidersHorizontal } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { videoWorkflows } from '@/lib/workflows/video-index'
import LoraSelector from './LoraSelector'
import { useQueueStore } from '@/lib/comfyui/queue'
import { useStudioStore } from '@/lib/generation/studio-store'
import { useCinematicEnhance } from '@/lib/comfyui/useCinematicEnhance'
import { submitPrompt } from '@/lib/comfyui/submit'
import {
  fetchVideoPromptOptions,
  FALLBACK_OPTIONS,
  type VideoPromptOptions,
} from '@/lib/comfyui/video-prompt-options'
import EnhanceSettings, { type EnhanceSettingsValues } from './EnhanceSettings'
import PromptReview from './PromptReview'
import type { VideoGenerationParams } from '@/types/video-workflow'
import { downscaleFileToB64 } from '@/lib/generation/image-b64'
import { useFileDrop } from '@/lib/generation/useFileDrop'
import { ltxAssetInstalled } from '@/lib/models/ltx23-assets'

/** Optional 2.4 GB download; the Face identity control stays disabled without it. */
const FACE_ID_LORA = 'Best_FaceID_v1.0_LoRA.safetensors'
/** Optional 554 MB download; on by default once it is installed. */
const MOTION_LORA = 'VBVR-I2V-390K-R32.safetensors'

// v2: the RaccoonVideoNodes control set — old saved shapes are ignored.
const FORM_STORAGE_KEY = 'raccoon-studio:generate-videos-form:v2'

/** Pixel-budget tiers — dims live in `lib/workflows/ltx23.ts` (they vary by orientation). */
const RESOLUTION_TIERS = [
  { id: 'high', label: 'Full HD', hint: '~2 MP — full-size render. Slowest setting; wants 24 GB+.' },
  { id: 'medium', label: '900p', hint: '~1.4 MP — a third fewer pixels than Full HD, most of the detail.' },
  { id: 'low', label: '720p', hint: '~0.9 MP — less than half the pixels. Much faster, and keeps 16 GB cards out of shared GPU memory.' },
] as const

/** Enhance settings that also feed the render graph (same key on both shapes). */
const RENDER_SETTING_KEYS = new Set<keyof EnhanceSettingsValues>([
  'pov', 'povGender', 'music', 'environment', 'scenario', 'camera', 'dialogueTier', 'energy',
])

export default function VideoGenerationForm() {
  const { clientId, addJob } = useQueueStore()
  const updateJob = useQueueStore((s) => s.updateJob)
  // Whether a video job is in flight (queued or running). A boolean keeps the
  // zustand v5 selector reference-stable across renders.
  const hasActiveJob = useQueueStore((s) =>
    s.jobs.some((j) => j.kind === 'video' && (j.status === 'pending' || j.status === 'running')),
  )
  const lastJobSeed = useQueueStore((s) => {
    const j = s.jobs.find((job) => job.kind === 'video')
    return j ? j.generationParams.seed : null
  })
  const prefill = useStudioStore((s) => s.prefill)
  const setPrefill = useStudioStore((s) => s.setPrefill)

  const workflow = videoWorkflows[0]
  const [params, setParams] = useState<VideoGenerationParams>({
    prompt: '',
    mode: 't2v',
    orientation: workflow.defaultParams.orientation,
    durationSeconds: workflow.defaultParams.durationSeconds ?? 15,
    fps: workflow.defaultParams.fps ?? 30,
    seed: workflow.defaultParams.seed ?? -1,
    pov: false,
    povGender: 'female',
    music: FALLBACK_OPTIONS.music[0],
    environment: FALLBACK_OPTIONS.environments[0],
    scenario: FALLBACK_OPTIONS.scenarios[0],
    camera: FALLBACK_OPTIONS.cameras[0],
    dialogueTier: 'standard',
    energy: 5,
    // LoRA slots always start empty — a stale selection breaks ComfyUI validation.
    lora1: '', lora1Strength: 1,
    lora2: '', lora2Strength: 1,
    lora3: '', lora3Strength: 1,
    lora4: '', lora4Strength: 1,
  })
  const [settings, setSettings] = useState<EnhanceSettingsValues>({
    userIntent: '',
    model: 'None',
    environment: FALLBACK_OPTIONS.environments[0],
    scenario: FALLBACK_OPTIONS.scenarios[0],
    camera: FALLBACK_OPTIONS.cameras[0],
    music: FALLBACK_OPTIONS.music[0],
    dialogueTier: 'standard',
    energy: 5,
    pov: false,
    povGender: 'female',
  })
  const [models, setModels] = useState<string[]>(['None'])
  const [options, setOptions] = useState<VideoPromptOptions>(FALLBACK_OPTIONS)
  const [collapsed, setCollapsed] = useState(true)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [faceIdReady, setFaceIdReady] = useState(false)
  const [motionReady, setMotionReady] = useState(false)
  const [imageB64, setImageB64] = useState('')
  const [seedPreview, setSeedPreview] = useState<string | null>(null)
  const [isGenerating, setIsGenerating] = useState(false)
  const [restored, setRestored] = useState(false)

  const enh = useCinematicEnhance()

  // Load the Ollama model list + the node's preset lists once.
  useEffect(() => {
    let alive = true
    fetch('/api/generate-videos/ollama-models')
      .then((r) => r.json())
      .then((j: { models?: string[] }) => {
        if (!alive) return
        const list = j.models?.length ? j.models : ['None']
        setModels(list)
        setSettings((s) => (list.includes(s.model) ? s : { ...s, model: list[0] }))
      })
      .catch(() => {})
    fetchVideoPromptOptions().then((o) => {
      if (!alive) return
      setOptions(o)
      // Drop any saved preset the node no longer offers (also mirrored to params).
      setSettings((s) => {
        const next = { ...s }
        if (!o.environments.includes(s.environment)) next.environment = o.environments[0]
        if (!o.scenarios.includes(s.scenario)) next.scenario = o.scenarios[0]
        if (!o.cameras.includes(s.camera)) next.camera = o.cameras[0]
        if (!o.music.includes(s.music)) next.music = o.music[0]
        setParams((p) => ({
          ...p,
          environment: next.environment,
          scenario: next.scenario,
          camera: next.camera,
          music: next.music,
        }))
        return next
      })
    })
    // Both the FaceID and the motion LoRA are optional downloads. The stack skips
    // a missing LoRA silently, so nothing would break outright — but FaceID's
    // reinforcer would then inject reference tokens the model was never patched to
    // read, and the motion toggle would claim an effect it is not having. Gate
    // both controls on the files actually being there.
    fetch('/api/comfyui/object_info/LoraLoader')
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return
        const names = d?.LoraLoader?.input?.required?.lora_name?.[0] as string[] | undefined
        const installed = new Set(names ?? [])
        const ready = Array.isArray(names) && ltxAssetInstalled(FACE_ID_LORA, installed)
        setFaceIdReady(ready)
        // `faceId` is persisted with the rest of the form, so a session that had
        // the LoRA installed would restore it on a machine that no longer does —
        // leaving the control disabled while the param quietly stayed on.
        if (!ready) setParams((p) => (p.faceId ? { ...p, faceId: false } : p))

        // Motion LoRA is default-ON, which is only safe once the file is known to
        // exist — hence "turn on when undefined" rather than an initial `true`.
        // `undefined` means the user has never touched the toggle; an explicit
        // `false` they chose earlier is restored before this resolves and is left
        // alone. Restoring from localStorage is synchronous on mount, so it always
        // wins the race against this fetch.
        const motion = Array.isArray(names) && ltxAssetInstalled(MOTION_LORA, installed)
        setMotionReady(motion)
        setParams((p) =>
          motion
            ? (p.motionLora === undefined ? { ...p, motionLora: true } : p)
            : (p.motionLora ? { ...p, motionLora: false } : p),
        )
      })
      .catch(() => {})
    return () => { alive = false }
  }, [])

  // Restore saved params + settings on mount.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(FORM_STORAGE_KEY)
      if (raw) {
        const saved = JSON.parse(raw) as { params?: Partial<VideoGenerationParams>; settings?: Partial<EnhanceSettingsValues> }
        // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time restore
        if (saved.params) setParams((p) => ({ ...p, ...saved.params, inputImage: undefined }))
        if (saved.settings) setSettings((s) => ({ ...s, ...saved.settings }))
      }
    } catch { /* ignore */ }
    setRestored(true)
  }, [])

  // Director (or any caller) prefill: override prompt/params and lock an i2v seed.
  useEffect(() => {
    if (!prefill) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing form from prefill store
    setParams((p) => ({ ...p, ...prefill.params }))
    if (prefill.videoSeed) {
      setParams((p) => ({ ...p, mode: 'i2v', inputImage: prefill.videoSeed!.filename }))
      setImageB64(prefill.videoSeed.b64)
      setSeedPreview(prefill.videoSeed.previewUrl)
    }
    setPrefill(null)
  }, [prefill, setPrefill])

  // Persist params + settings (never the uploaded image, never the LoRA slots —
  // a restored stale LoRA that was uninstalled breaks ComfyUI validation).
  useEffect(() => {
    if (!restored) return
    try {
      localStorage.setItem(FORM_STORAGE_KEY, JSON.stringify({
        params: {
          ...params,
          inputImage: undefined,
          inputImageWidth: undefined,
          inputImageHeight: undefined,
          lora1: undefined, lora1Strength: undefined,
          lora2: undefined, lora2Strength: undefined,
          lora3: undefined, lora3Strength: undefined,
          lora4: undefined, lora4Strength: undefined,
        },
        settings,
      }))
    } catch { /* quota — non-fatal */ }
  }, [restored, params, settings])

  // Stream the enhanced/refined prompt into the editable confirmed box.
  useEffect(() => {
    if (enh.isStreaming || enh.promptText) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- mirror live stream into the form
      setParams((p) => ({ ...p, prompt: enh.promptText }))
    }
  }, [enh.promptText, enh.isStreaming])

  // Surface enhance errors as a toast.
  useEffect(() => {
    if (enh.error) toast.error(enh.error)
  }, [enh.error])

  const set = <K extends keyof VideoGenerationParams>(key: K, value: VideoGenerationParams[K]) =>
    setParams((p) => ({ ...p, [key]: value }))

  const onSettingChange = useCallback(<K extends keyof EnhanceSettingsValues>(key: K, value: EnhanceSettingsValues[K]) => {
    setSettings((s) => ({ ...s, [key]: value }))
    // POV/music/presets also drive the render graph (negative prompt et al.).
    if (RENDER_SETTING_KEYS.has(key)) {
      setParams((p) => ({ ...p, [key]: value }))
    }
  }, [])

  const enhanceArgs = useCallback(() => ({
    model: settings.model,
    videoMode: params.mode,
    imageB64,
    environment: settings.environment,
    scenario: settings.scenario,
    camera: settings.camera,
    music: settings.music,
    pov: settings.pov,
    povGender: settings.povGender,
    dialogueTier: settings.dialogueTier,
    energy: settings.energy,
    userIntent: settings.userIntent,
    durationS: params.durationSeconds,
  }), [settings, params.durationSeconds, params.mode, imageB64])

  const enhanceDisabledReason = (() => {
    if (settings.model === 'None') return 'Select an Ollama model to enhance.'
    if (params.mode === 'i2v' && !params.inputImage) return 'Upload a source image first.'
    if (!settings.userIntent.trim()) return 'Describe your idea above first.'
    return null
  })()

  const handleEnhance = useCallback(() => {
    setCollapsed(true)
    enh.enhance(enhanceArgs())
  }, [enh, enhanceArgs])

  const handleRefine = useCallback((instruction: string) => {
    enh.refine(enhanceArgs(), instruction, params.prompt)
  }, [enh, enhanceArgs, params.prompt])

  const handleGenerate = useCallback(async () => {
    if (!params.prompt.trim()) {
      toast.error('Enter or enhance a prompt first')
      return
    }
    if (params.mode === 'i2v' && !params.inputImage) {
      toast.error('Upload a source image for image-to-video')
      return
    }
    setIsGenerating(true)
    try {
      // Free the Ollama model's VRAM before the render so the LTX model always
      // has headroom. Best-effort: a failed/slow unload must not block the render.
      try {
        toast('Freeing VRAM…')
        await enh.kill()
      } catch { /* best-effort unload */ }

      const seed = params.seed < 0 ? Math.floor(Math.random() * 9999999999999) : params.seed
      const jobParams = { ...params, seed }
      const prompt = workflow.buildPrompt(jobParams)
      // preview_method:'auto' tells ComfyUI to emit live latent (noise) preview
      // frames during sampling — same as the image tab.
      const prompt_id = await submitPrompt({ prompt, client_id: clientId, extra_data: { preview_method: 'auto' } })
      addJob(prompt_id, workflow.id, workflow.name, params.prompt, jobParams, 'video')
      toast.success('Queued — rendering video (this takes a few minutes)…')
    } catch (e) {
      toast.error(`Generation failed: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setIsGenerating(false)
    }
  }, [params, workflow, clientId, addJob, enh])

  // Cancel the in-flight render: interrupt the running prompt, drop any still-
  // queued video prompts, and mark our active video jobs cancelled locally (the
  // WS handlers then ignore the late interrupt frames).
  const handleCancel = useCallback(async () => {
    const active = useQueueStore
      .getState()
      .jobs.filter((j) => j.kind === 'video' && (j.status === 'pending' || j.status === 'running'))
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
        updateJob(j.id, {
          status: 'cancelled',
          endedAt: Date.now(),
          livePreview: undefined,
          previewVideo: undefined,
        })
      }
      toast('Render cancelled')
    }
  }, [updateJob])

  return (
    <div className="space-y-4">
      {/* Panel header */}
      <div className="flex items-center gap-2.5">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/15 ring-1 ring-primary/25">
          <Clapperboard className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h2 className="font-heading text-xl font-bold tracking-tight leading-none">Create video</h2>
          <p className="text-xs text-muted-foreground mt-1">{workflow.name}</p>
        </div>
      </div>

      {/* Mode toggle */}
      <div className="space-y-2">
        <SectionLabel>Mode</SectionLabel>
        <div className="grid grid-cols-2 gap-2">
          {(['t2v', 'i2v'] as const).map((m) => (
            <Button
              key={m}
              variant={params.mode === m ? 'default' : 'outline'}
              className="h-9 text-sm"
              onClick={() => set('mode', m)}
            >
              {m === 't2v' ? 'Text → Video' : 'Image → Video'}
            </Button>
          ))}
        </div>
      </div>

      {/* Orientation (t2v) or source image (i2v) */}
      {params.mode === 't2v' ? (
        <div className="space-y-2">
          <SectionLabel>Orientation</SectionLabel>
          <div className="flex gap-2 flex-wrap">
            {workflow.orientations.map((o) => (
              <Button
                key={o.value}
                variant={params.orientation === o.value ? 'default' : 'outline'}
                className="h-9 px-3 text-sm"
                onClick={() => set('orientation', o.value)}
              >
                {o.label}
              </Button>
            ))}
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <SectionLabel>Source image</SectionLabel>
          <SourceImageInput
            value={params.inputImage}
            onChange={(filename) => { set('inputImage', filename); setSeedPreview(null) }}
            onB64={setImageB64}
            onDims={(d) => setParams((p) => ({ ...p, inputImageWidth: d?.w, inputImageHeight: d?.h }))}
            previewUrl={seedPreview}
          />
        </div>
      )}

      <GroupHeader>Prompt</GroupHeader>

      {/* Enhance settings (collapsible) */}
      <EnhanceSettings
        collapsed={collapsed}
        onExpand={() => setCollapsed(false)}
        values={settings}
        onChange={onSettingChange}
        models={models}
        options={options}
        onEnhance={handleEnhance}
        isStreaming={enh.isStreaming}
        disabledReason={enhanceDisabledReason}
      />

      {/* Prompt review */}
      <PromptReview
        status={enh.status}
        isStreaming={enh.isStreaming}
        error={enh.error}
        prompt={params.prompt}
        onPromptChange={(v) => set('prompt', v)}
        onRefine={handleRefine}
        onStop={enh.stop}
      />

      <GroupHeader>Render</GroupHeader>

      {/* Dropping the pixel budget is the biggest speed lever there is; the low
          tier also keeps 16 GB cards on-card. Labelled by resolution, not by
          VRAM — the speed is why most people reach for it. */}
      <div className="space-y-2">
        <SectionLabel>Resolution</SectionLabel>
        <div className="grid grid-cols-3 gap-2">
          {RESOLUTION_TIERS.map((t) => (
            <Button
              key={t.id}
              variant={(params.vramMode ?? 'high') === t.id ? 'default' : 'outline'}
              className="h-9 text-sm"
              onClick={() => set('vramMode', t.id)}
            >
              {t.label}
            </Button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          {RESOLUTION_TIERS.find((t) => t.id === (params.vramMode ?? 'high'))?.hint}
        </p>
      </div>

      {/* Duration */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <SectionLabel>Duration</SectionLabel>
          <span className="text-xs font-mono text-muted-foreground tabular-nums">
            {params.durationSeconds}s · {params.fps}fps
          </span>
        </div>
        <input
          type="range"
          min={2}
          max={30}
          step={1}
          value={params.durationSeconds}
          onChange={(e) => set('durationSeconds', Number(e.target.value))}
          className="w-full accent-primary"
        />
        <p className="text-xs text-muted-foreground">Longer clips take proportionally longer to render.</p>
      </div>

      {/* Stabilised motion — deliberately outside Advanced: it is on by default, so
          it has to be visible enough that someone can find it and turn it off. A
          plain LoRA row, hence offered in both modes. */}
      <div className={`rounded-xl border border-border bg-muted/20 p-3 space-y-2 ${motionReady ? '' : 'opacity-60'}`}>
        <label className={`flex items-center gap-2 text-sm ${motionReady ? '' : 'cursor-not-allowed'}`}>
          <input
            type="checkbox"
            checked={params.motionLora === true}
            disabled={!motionReady}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => set('motionLora', e.target.checked)}
            className="h-4 w-4 accent-primary disabled:cursor-not-allowed"
          />
          <span className="font-medium">Stabilised motion</span>
          <span className="text-xs text-muted-foreground">
            {motionReady ? 'VBVR LoRA' : 'unavailable — not installed'}
          </span>
        </label>
        <p className="text-xs text-muted-foreground">
          {motionReady
            ? 'Holds the camera to whatever the prompt asks for — static when you ask for static, moving when you ask for a move — and steadies motion between frames. Measured on image-to-video: 92% less camera drift and 17% less flicker, at no extra render time. Uncheck it to let the model move the camera on its own.'
            : 'Adds the VBVR motion LoRA (554 MB) for a steadier camera and less flicker — install it on the Models page to enable this.'}
        </p>
      </div>

      {/* Advanced — LoRAs + Seed + RIFE, collapsed by default to keep the panel calm. */}
      <div className="rounded-xl border border-border bg-muted/20">
        <button
          type="button"
          onClick={() => setAdvancedOpen((v) => !v)}
          aria-expanded={advancedOpen}
          className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm font-semibold hover:bg-muted/40 rounded-xl"
        >
          <SlidersHorizontal className="h-4 w-4 shrink-0 text-primary" />
          <span className="flex-1">Advanced</span>
          <span className="text-xs font-normal text-muted-foreground">LoRAs · Seed · Interpolation</span>
          <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${advancedOpen ? 'rotate-180' : ''}`} />
        </button>

        {advancedOpen && (
          <div className="space-y-4 border-t border-border/60 p-3">
            {/* LoRAs — up to 4 stack slots on top of the built-in distillation LoRA.
                Always start at None; selections are per-session only. */}
            <div className="space-y-2">
              <SectionLabel>LoRAs</SectionLabel>
              <div className="space-y-1.5">
                <LoraSelector
                  label="LoRA 1"
                  family="ltx"
                  value={params.lora1 ?? ''}
                  strength={params.lora1Strength ?? 1}
                  onChange={(lora, strength) => setParams((p) => ({ ...p, lora1: lora, lora1Strength: strength }))}
                />
                <LoraSelector
                  label="LoRA 2"
                  family="ltx"
                  value={params.lora2 ?? ''}
                  strength={params.lora2Strength ?? 1}
                  onChange={(lora, strength) => setParams((p) => ({ ...p, lora2: lora, lora2Strength: strength }))}
                />
                <LoraSelector
                  label="LoRA 3"
                  family="ltx"
                  value={params.lora3 ?? ''}
                  strength={params.lora3Strength ?? 1}
                  onChange={(lora, strength) => setParams((p) => ({ ...p, lora3: lora, lora3Strength: strength }))}
                />
                <LoraSelector
                  label="LoRA 4"
                  family="ltx"
                  value={params.lora4 ?? ''}
                  strength={params.lora4Strength ?? 1}
                  onChange={(lora, strength) => setParams((p) => ({ ...p, lora4: lora, lora4Strength: strength }))}
                />
              </div>
            </div>

            {/* Seed */}
            <div className="space-y-2">
              <SectionLabel>Seed</SectionLabel>
              <div className="flex gap-2">
                <Input
                  type="number"
                  value={params.seed}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => set('seed', Number(e.target.value))}
                  className="h-9 flex-1 min-w-0 font-mono text-sm"
                />
                <Button variant="outline" size="icon" className="h-9 w-9 shrink-0" title="Randomize" onClick={() => set('seed', -1)}>
                  <Shuffle className="h-4 w-4" />
                </Button>
                {lastJobSeed !== null && lastJobSeed >= 0 && (
                  <Button variant="outline" size="icon" className="h-9 w-9 shrink-0" onClick={() => set('seed', lastJobSeed)} title={`Use last clip's seed (${lastJobSeed})`}>
                    <RotateCcw className="h-4 w-4" />
                  </Button>
                )}
              </div>
              <p className="text-xs text-muted-foreground">-1 = random each time</p>
            </div>

            {/* Face identity — i2v only: t2v has no source face to lock onto, and
                the builder strips the whole conditioning path there anyway. */}
            {params.mode === 'i2v' && (
              <div className="space-y-2">
                <SectionLabel>Face identity</SectionLabel>
                <Button
                  variant={params.faceId ? 'default' : 'outline'}
                  className="h-9 w-full text-sm"
                  disabled={!faceIdReady}
                  onClick={() => set('faceId', !params.faceId)}
                >
                  {params.faceId ? 'Identity lock on' : 'Identity lock off'}
                </Button>
                {!faceIdReady ? (
                  // Without the LoRA the reinforcer would inject reference tokens
                  // the model was never trained to read — worse than leaving it off.
                  <p className="text-xs text-muted-foreground">
                    Needs the Best-FaceID LoRA (2.4 GB) — install it on the Models page.
                  </p>
                ) : params.faceId ? (
                  <>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground shrink-0">Strength</span>
                      <Input
                        type="number"
                        min={0}
                        max={2}
                        step={0.1}
                        value={params.faceIdStrength ?? 1}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                          set('faceIdStrength', Number(e.target.value))
                        }
                        className="h-8 flex-1 min-w-0 font-mono text-sm"
                      />
                    </div>
                    <Button
                      variant={params.faceIdWholeSubject ? 'default' : 'outline'}
                      className="h-8 w-full text-xs"
                      onClick={() => set('faceIdWholeSubject', !params.faceIdWholeSubject)}
                    >
                      {params.faceIdWholeSubject ? 'Whole subject' : 'Face only'}
                    </Button>
                    <p className="text-xs text-muted-foreground">
                      Best when the subject is <strong>far from camera</strong> — measured
                      +12% identity hold on a wide shot, and it prevents the face drifting
                      away by the end. On a tight close-up it adds nothing, and “Face only”
                      makes it slightly worse; use “Whole subject” there. 1.0 is what the
                      LoRA was trained for.
                    </p>
                  </>
                ) : null}
              </div>
            )}

            {/* RIFE frame interpolation */}
            <div className="space-y-2">
              <SectionLabel>Frame interpolation</SectionLabel>
              <Button
                variant={params.rife !== false ? 'default' : 'outline'}
                className="h-9 w-full text-sm"
                onClick={() => set('rife', params.rife === false)}
              >
                {params.rife !== false ? 'RIFE on — smooth 60fps output' : 'RIFE off — native fps output'}
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Generate button — flips to Cancel while a render is queued or running so
          the user can bail out of a multi-minute clip. */}
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
          disabled={isGenerating || !params.prompt.trim()}
        >
          {isGenerating ? (
            <><Loader2 className="h-5 w-5 mr-2 animate-spin" /> Queuing…</>
          ) : (
            <><Clapperboard className="h-5 w-5 mr-2" /> Generate video</>
          )}
        </Button>
      )}
    </div>
  )
}

/**
 * Source-image picker for image-to-video. Uploads the full-res file to ComfyUI's
 * input folder (drives the render), produces a downscaled base64 JPEG for the
 * LLM's vision pass (onB64), and reports the image's pixel size (onDims) so the
 * clip resolution can follow the image's aspect.
 */
function SourceImageInput({
  value, onChange, onB64, onDims, previewUrl,
}: {
  value?: string
  onChange: (filename: string | undefined) => void
  onB64: (b64: string) => void
  onDims: (dims: { w: number; h: number } | null) => void
  previewUrl?: string | null
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)

  const { isDragging, dragProps } = useFileDrop((file) => void handleFile(file))

  async function handleFile(file: File) {
    setUploading(true)
    try {
      const form = new FormData()
      form.append('image', file)
      form.append('overwrite', 'true')
      form.append('type', 'input')
      const res = await fetch('/api/comfyui/upload/image', { method: 'POST', body: form })
      if (!res.ok) throw new Error(await res.text())
      const data = (await res.json()) as { name: string; subfolder?: string }
      const name = data.subfolder ? `${data.subfolder}/${data.name}` : data.name
      const url = URL.createObjectURL(file)
      const img = new Image()
      img.onload = () => onDims({ w: img.naturalWidth, h: img.naturalHeight })
      img.src = url
      setPreview(url)
      onChange(name)
      onB64(await downscaleFileToB64(file))
    } catch (e) {
      toast.error(`Image upload failed: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setUploading(false)
    }
  }

  function clear() {
    if (preview) URL.revokeObjectURL(preview)
    setPreview(null)
    onChange(undefined)
    onB64('')
    onDims(null)
    if (inputRef.current) inputRef.current.value = ''
  }

  return (
    <div
      {...dragProps}
      className={`flex items-center gap-3 rounded-xl border bg-muted/20 p-3 transition-colors ${
        isDragging ? 'border-primary ring-2 ring-primary/30' : 'border-border'
      }`}
    >
      {value && (preview ?? previewUrl) ? (
        // eslint-disable-next-line @next/next/no-img-element -- local object-URL / ComfyUI input preview
        <img src={(preview ?? previewUrl) as string} alt="Source" className="h-16 w-16 rounded-lg object-cover ring-1 ring-border" />
      ) : (
        <div className="flex h-16 w-16 items-center justify-center rounded-lg bg-muted text-muted-foreground ring-1 ring-border">
          <ImageIcon className="h-6 w-6" />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) void handleFile(f)
          }}
        />
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="inline-flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-1.5 text-sm font-medium hover:bg-muted disabled:opacity-60"
        >
          {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
          {value ? 'Replace image' : 'Upload image'}
        </button>
        {value && (
          <button type="button" onClick={clear} className="ml-2 inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm text-muted-foreground hover:text-foreground">
            <X className="h-3.5 w-3.5" /> Clear
          </button>
        )}
        {!value && !uploading && (
          <p className="mt-1 text-xs text-muted-foreground">The clip&apos;s resolution follows this image — drag &amp; drop supported.</p>
        )}
      </div>
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

/** Uppercase group divider separating the Prompt and Render halves of the form. */
function GroupHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 pt-1">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {children}
      </span>
      <span className="h-px flex-1 bg-border" />
    </div>
  )
}
