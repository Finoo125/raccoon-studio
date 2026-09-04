'use client'

import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { videoWorkflows, supportsSeedHunt } from '@/lib/workflows/video-index'
import { useQueueStore } from '@/lib/comfyui/queue'
import { useStudioStore } from '@/lib/generation/studio-store'
import { useCinematicEnhance } from '@/lib/comfyui/useCinematicEnhance'
import { submitPrompt } from '@/lib/comfyui/submit'
import { cancelVideoJobs } from '@/lib/comfyui/cancel-video'
import {
  fetchVideoPromptOptions,
  FALLBACK_OPTIONS,
  type VideoPromptOptions,
} from '@/lib/comfyui/video-prompt-options'
import type { EnhanceSettingsValues } from './EnhanceSettings'
import type { VideoGenerationParams } from '@/types/video-workflow'
import { assetInstalled } from '@/lib/models/ltx23-assets'
import {
  H3_TURBO,
  H3_REF2V_TURBO_LORA,
  H3_REALISM_LORA,
  H3_REF2VA_CKPT,
  H3_EROS,
  h3RefCount,
  h3TurboTier,
  type H3TurboTier,
} from '@/lib/workflows/minimax-h3'
import { useAddonLock, LTX_DIRECTOR_ADDON } from '@/lib/addons/useAddonLock'
import { visionShots } from '@/lib/workflows/director-timeline'
import { shotVisionB64 } from './director/lane-media'
import { buildEnhanceArgs } from '@/lib/comfyui/enhance-args'

/** Optional 2.4 GB download; the Face identity control stays disabled without it. */
const FACE_ID_LORA = 'Best_FaceID_v1.0_LoRA.safetensors'
/** Optional 554 MB download; on by default once it is installed. */
const MOTION_LORA = 'VBVR-I2V-390K-R32.safetensors'

// v2: the RaccoonVideoNodes control set — old saved shapes are ignored.
const FORM_STORAGE_KEY = 'raccoon-studio:generate-videos-form:v2'

/** Enhance settings that also feed the render graph (same key on both shapes). */
const RENDER_SETTING_KEYS = new Set<keyof EnhanceSettingsValues>([
  'pov', 'povGender', 'music', 'environment', 'scenario', 'camera', 'dialogueTier', 'energy',
])

/**
 * Every piece of video-form state, hoisted one level out of the form component.
 *
 * Director mode lays the same controls out across four zones — top bar, brief,
 * inspector, timeline — which are siblings, not ancestors, so the state can no
 * longer live inside the form's own tree. Deliberately a React context and not
 * a zustand slice: this keeps `useState` as `useState`, so the localStorage
 * restore/persist pair, the prefill effect and the enhance-stream mirror all
 * move across untouched, and no consumer has to memoise a selector.
 */
/**
 * Whether an image-anchored render is missing the image it needs.
 *
 * i2v is satisfied by EITHER frame: with only the end frame filled the task is
 * H3's l2v — open somewhere plausible and converge on that image — which is a
 * render, not a missing input. Module-level and pure so the callback that reads
 * it derives from `params` rather than closing over a value computed a render
 * ago.
 */
const missingFrame = (p: VideoGenerationParams) =>
  p.mode === 'i2v' && !p.inputImage && !p.endImage

function useVideoFormState() {
  const { clientId, addJob } = useQueueStore()
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

  const defaults = videoWorkflows[0]
  const [params, setParams] = useState<VideoGenerationParams>({
    prompt: '',
    mode: 't2v',
    videoModel: defaults.id,
    orientation: defaults.defaultParams.orientation,
    durationSeconds: defaults.defaultParams.durationSeconds ?? 15,
    fps: defaults.defaultParams.fps ?? 30,
    seed: defaults.defaultParams.seed ?? -1,
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
  const [turboReady, setTurboReady] = useState<Record<H3TurboTier, boolean>>({
    draft: false,
    fast: false,
  })
  const [ref2vReady, setRef2vReady] = useState(false)
  const [erosReady, setErosReady] = useState(false)
  const [realismReady, setRealismReady] = useState(false)
  const { locked: directorLocked, loaded: addonsLoaded } = useAddonLock(LTX_DIRECTOR_ADDON)
  const [imageB64, setImageB64] = useState('')
  /** The end frame's base64, for the vision pass. Same lifetime as `imageB64`. */
  const [endImageB64, setEndImageB64] = useState('')
  const [seedPreview, setSeedPreview] = useState<string | null>(null)
  const [isGenerating, setIsGenerating] = useState(false)
  // Seed hunt batch size; 0 = off. Form-local on purpose: `seedHunt` is a per-job
  // flag, so it must never reach the persisted `params` or a rerun.
  const [huntCount, setHuntCount] = useState(0)
  const [restored, setRestored] = useState(false)

  // Director mode is a separate workflow definition, not a flag on the ltx23 one:
  // it drives a different graph with a different front-end. Every other mode
  // picks by `videoModel`, falling back to the default when that names a
  // workflow this build does not have (stale localStorage from an older install).
  const workflow =
    params.mode === 'director'
      ? (videoWorkflows.find((w) => w.id === 'ltx23-director') ?? defaults)
      : (videoWorkflows.find((w) => w.id === params.videoModel && w.id !== 'ltx23-director') ??
        defaults)

  // Keep the timeline's clock matching the form's — duration and fps are form
  // controls, but the timeline ruler and the serializer's frame maths both read
  // them off the timeline.
  useEffect(() => {
    const { directorTimeline: t, setDirectorTimeline } = useStudioStore.getState()
    if (t.durationSeconds !== params.durationSeconds || t.fps !== params.fps) {
      setDirectorTimeline({ ...t, durationSeconds: params.durationSeconds, fps: params.fps })
    }
  }, [params.durationSeconds, params.fps])

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
        const ready = Array.isArray(names) && assetInstalled(FACE_ID_LORA, installed)
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
        const motion = Array.isArray(names) && assetInstalled(MOTION_LORA, installed)
        setMotionReady(motion)
        setParams((p) =>
          motion
            ? (p.motionLora === undefined ? { ...p, motionLora: true } : p)
            : (p.motionLora ? { ...p, motionLora: false } : p),
        )

        // H3 Turbo, per tier — each is its own optional download, so a machine
        // can have either, both or neither. Default-OFF, so unlike the motion
        // LoRA there is no "turn on when undefined" half; the guard below is for
        // a session saved where a tier's file existed and reopened where it
        // doesn't, which would otherwise leave the param on behind a dead button.
        const turbo: Record<H3TurboTier, boolean> = {
          draft: Array.isArray(names) && assetInstalled(H3_TURBO.draft.lora, installed),
          fast: Array.isArray(names) && assetInstalled(H3_TURBO.fast.lora, installed),
        }
        setTurboReady(turbo)
        setParams((p) => {
          const tier = h3TurboTier(p.turbo)
          // Normalise the legacy `true` on the way through, so exactly one
          // spelling of "draft" survives past first load.
          const next = tier && turbo[tier] ? tier : false
          // ref2va's own Turbo LoRA rides on the same fetch; it is a machine
          // fact rather than a choice, so it is written straight to params for
          // the builder to read.
          const ref2v = Array.isArray(names) && assetInstalled(H3_REF2V_TURBO_LORA, installed)
          return p.turbo === next && p.ref2vTurbo === ref2v
            ? p
            : { ...p, turbo: next, ref2vTurbo: ref2v }
        })

        // Realism adapter — default-OFF like the Turbo tiers, so no "turn on
        // when undefined" half. The reset guard is the same one they need: the
        // flag is persisted, so a session saved on a machine that had the file
        // would otherwise restore it here behind a disabled checkbox and 400 the
        // render at ComfyUI's validation step.
        const realism = Array.isArray(names) && assetInstalled(H3_REALISM_LORA, installed)
        setRealismReady(realism)
        if (!realism) setParams((p) => (p.realismLora ? { ...p, realismLora: false } : p))
      })
      .catch(() => {})

    // Reference mode needs its own 21 GB checkpoint — separate weights, not a
    // flag on the model t2v/i2v use. Same shape as the Turbo gate above, but
    // read off UNETLoader rather than LoraLoader.
    fetch('/api/comfyui/object_info/UNETLoader')
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return
        const names = d?.UNETLoader?.input?.required?.unet_name?.[0] as string[] | undefined
        const installed = new Set(names ?? [])
        const ready = Array.isArray(names) && assetInstalled(H3_REF2VA_CKPT, installed)
        setRef2vReady(ready)
        // `mode` is persisted, so a session saved where the checkpoint existed
        // would restore into a mode whose button is now disabled, with no way
        // back to it in the UI. Same reasoning as the Director add-on guard below.
        if (!ready) setParams((p) => (p.mode === 'ref2v' ? { ...p, mode: 't2v' } : p))

        // The Eros finetune is a third optional checkpoint on the same loader.
        // Same persisted-flag reset the Turbo tiers need: a session saved where
        // the file existed would otherwise reopen naming a checkpoint ComfyUI
        // rejects at validation, behind a button that is now disabled.
        const eros = Array.isArray(names) && assetInstalled(H3_EROS.ckpt, installed)
        setErosReady(eros)
        if (!eros) {
          setParams((p) => (p.h3Checkpoint === 'eros' ? { ...p, h3Checkpoint: 'base' } : p))
        }
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
        if (saved.params) setParams((p) => ({ ...p, ...saved.params, inputImage: undefined, refImages: undefined,
          refVideos: undefined, refAudios: undefined }))
        if (saved.settings) setSettings((s) => ({ ...s, ...saved.settings }))
      }
    } catch { /* ignore */ }
    setRestored(true)
  }, [])

  // Director (or any caller) prefill: override prompt/params and lock an i2v seed.
  useEffect(() => {
    if (!prefill) return
    /**
     * Honour `prefill.workflowId` by switching the model it names.
     *
     * This form selects its workflow from `params.videoModel`, so a prefill
     * that only set `workflowId` used to be ignored entirely — the form stayed
     * on whatever was chosen before, and the default is LTX. "Send as video
     * reference" was landing on LTX with `mode: 'ref2v'`, a mode LTX does not
     * offer and whose reference the LTX builder discards, so the render
     * succeeded and silently ignored the reference. Confirmed in a browser:
     * "LTX 2.3 Video" before the click and after it.
     *
     * Matched against the video list on purpose. `StudioPrefill` is shared with
     * the *image* form, so `workflowId` is often an image workflow id; writing
     * that into `videoModel` would be meaningless. Director is excluded for the
     * same reason the selector below excludes it — it is reached through
     * `mode`, not through the model picker.
     */
    const named = videoWorkflows.find(
      (w) => w.id === prefill.workflowId && w.id !== 'ltx23-director',
    )
    // `prefill.params` last so a caller that sets `videoModel` explicitly still wins.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing form from prefill store
    setParams((p) => ({ ...p, ...(named ? { videoModel: named.id } : {}), ...prefill.params }))
    if (prefill.videoSeed) {
      // Only an unqualified seed means i2v. A prefill that names its own mode has
      // already put the filename in the slot that mode reads — H3's reference
      // sends land in `refImages`, and forcing i2v here would both bounce the
      // mode back and re-file the image as a start frame.
      if (!prefill.params.mode) {
        setParams((p) => ({ ...p, mode: 'i2v', inputImage: prefill.videoSeed!.filename }))
      }
      /**
       * An end-frame send fills `endImage`, and its thumbnail belongs to the
       * end slot: `buildEnhanceArgs` reads `endImageB64` for fl2v and l2v.
       * Putting it in `imageB64` would tell the writer "this is the opening
       * frame" about the picture the clip has to *land* on — and l2v would then
       * be described an image it was never shown. `seedPreview` is the start
       * slot's preview and stays untouched; the end slot derives its own.
       */
      if (prefill.params.endImage && !prefill.params.inputImage) {
        setEndImageB64(prefill.videoSeed.b64)
      } else {
        setImageB64(prefill.videoSeed.b64)
        setSeedPreview(prefill.videoSeed.previewUrl)
      }
    }
    // The Continue dialog picks the batch size before this form exists, so it
    // arrives on the prefill rather than in params (`huntCount` is form-local
    // by design — see its declaration). Applied unconditionally when present:
    // a same-route Continue keeps the previous hunt's size otherwise.
    if (prefill.huntCount !== undefined) setHuntCount(prefill.huntCount)
    setPrefill(null)
  }, [prefill, setPrefill])

  // Director is a supporter add-on, and `mode` is persisted — so a session that
  // had it unlocked (or predates the gate) would restore straight into a mode
  // whose button is now locked, with no way back to it in the UI. Drop to t2v
  // once entitlements have actually loaded; before that `unlocked` is empty and
  // this would evict a legitimate owner on every page load.
  useEffect(() => {
    if (!addonsLoaded || !directorLocked) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing form state to an async entitlement fetch
    setParams((p) => (p.mode === 'director' ? { ...p, mode: 't2v' } : p))
  }, [addonsLoaded, directorLocked])

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
          // Same reason as inputImage: a restored end-frame filename whose file
          // is gone 400s the job at ComfyUI's validation step.
          endImage: undefined,
          endImageWidth: undefined,
          endImageHeight: undefined,
          // Same reason as inputImage: these are ComfyUI input-dir filenames, and
          // a restored one that no longer exists 400s the job at validation.
          refImages: undefined,
          refVideos: undefined,
          refAudios: undefined,
          // Same reason again, and one more: continuing is a deliberate act
          // aimed at a specific clip. Restoring it a week later would silently
          // chain onto something the user has forgotten about — or, once that
          // clip is deleted, 400 every render with no visible cause.
          continueFrom: undefined,
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

  const set = useCallback(
    <K extends keyof VideoGenerationParams>(key: K, value: VideoGenerationParams[K]) =>
      setParams((p) => ({ ...p, [key]: value })),
    [],
  )

  const onSettingChange = useCallback(<K extends keyof EnhanceSettingsValues>(key: K, value: EnhanceSettingsValues[K]) => {
    setSettings((s) => ({ ...s, [key]: value }))
    // POV/music/presets also drive the render graph (negative prompt et al.).
    if (RENDER_SETTING_KEYS.has(key)) {
      setParams((p) => ({ ...p, [key]: value }))
    }
  }, [])

  /**
   * Every shot's picture, in play order, for the Director vision pass.
   *
   * Read straight off the store rather than through a subscription: the pictures
   * are wanted at the instant Enhance is pressed, and depending on the timeline
   * here would rebuild `enhanceArgs` on every drag of a block.
   */
  const directorVisionImages = useCallback(async () => {
    const shots = visionShots(useStudioStore.getState().directorTimeline)
    const b64s = await Promise.all(shots.map(shotVisionB64))
    return b64s.filter((b): b is string => Boolean(b))
  }, [])

  /**
   * The enhance call's arguments. Everything it decides lives in
   * `buildEnhanceArgs`, which is pure and tested; all this adds is the one part
   * that cannot be — fetching the shot pictures, and only when Director asks
   * for them.
   *
   * The reference arrays are dependencies, not incidental reads: without them
   * an enhance fires with the counts from before the last upload, and the
   * doctrine then names references that are no longer attached.
   */
  const enhanceArgs = useCallback(async () => buildEnhanceArgs({
    settings,
    params,
    workflowId: workflow.id,
    imageB64,
    endImageB64,
    directorImages: params.mode === 'director' ? await directorVisionImages() : [],
  }), [settings, params, imageB64, endImageB64, workflow.id, directorVisionImages])

  const enhanceDisabledReason = (() => {
    if (settings.model === 'None') return 'Select an Ollama model to enhance.'
    if (missingFrame(params)) return 'Upload a start or end frame first.'
    if (params.mode === 'ref2v' && !h3RefCount(params))
      return 'Add at least one reference first.'
    if (!settings.userIntent.trim()) return 'Describe your idea above first.'
    return null
  })()

  // Both are async now: Director's shot pictures are fetched and downscaled in
  // the browser, so the args are only complete once that settles.
  const handleEnhance = useCallback(async () => {
    setCollapsed(true)
    enh.enhance(await enhanceArgs())
  }, [enh, enhanceArgs])

  const handleRefine = useCallback(async (instruction: string) => {
    enh.refine(await enhanceArgs(), instruction, params.prompt)
  }, [enh, enhanceArgs, params.prompt])

  const handleGenerate = useCallback(async () => {
    if (!params.prompt.trim()) {
      toast.error('Enter or enhance a prompt first')
      return
    }
    if (missingFrame(params)) {
      toast.error('Upload a start or end frame for image-to-video')
      return
    }
    if (params.mode === 'ref2v' && !h3RefCount(params)) {
      toast.error('Add at least one reference — image, clip or sound')
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
      // `huntCount` is form-local state that survives a model switch, so a graph
      // whose builder ignores `seedHunt` would render N clips at full price while
      // the UI promised cheap previews. Allowlist, not truthiness.
      const n = supportsSeedHunt(workflow.id) ? huntCount || 1 : 1
      for (let i = 0; i < n; i++) {
        // Candidates differ by seed alone — same graph, same LoRAs, same dims —
        // which is what lets the winner's seed reproduce the clip that was picked.
        const jobParams: VideoGenerationParams = {
          ...params,
          seed: seed + i,
          seedHunt: n > 1,
          // The timeline is edited in its own panel, so it is read from the store
          // at submit rather than mirrored into form state. The prompt box IS the
          // global prompt here; per-segment prompts are on the timeline, and
          // duration/fps stay owned by this form.
          ...(params.mode === 'director'
            ? {
                timeline: {
                  ...useStudioStore.getState().directorTimeline,
                  globalPrompt: params.prompt,
                  durationSeconds: params.durationSeconds,
                  fps: params.fps,
                },
              }
            : {}),
        }
        const prompt = workflow.buildPrompt(jobParams)
        // preview_method:'auto' tells ComfyUI to emit live latent (noise) preview
        // frames during sampling — same as the image tab.
        const prompt_id = await submitPrompt({ prompt, client_id: clientId, extra_data: { preview_method: 'auto' } })
        addJob(prompt_id, workflow.id, workflow.name, params.prompt, jobParams, 'video')
      }
      toast.success(
        huntCount > 0
          ? `Queued ${n} candidates — pick one when they land.`
          : 'Queued — rendering video (this takes a few minutes)…',
      )
    } catch (e) {
      toast.error(`Generation failed: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setIsGenerating(false)
    }
  }, [params, workflow, clientId, addJob, enh, huntCount])

  // Cancel the in-flight render, or the whole candidate batch during a seed hunt.
  const handleCancel = useCallback(async () => {
    const active = useQueueStore
      .getState()
      .jobs.filter((j) => j.kind === 'video' && (j.status === 'pending' || j.status === 'running'))
    if (active.length === 0) return
    try {
      await cancelVideoJobs(active)
      toast('Render cancelled')
    } catch (e) {
      toast.error(`Cancel failed: ${e instanceof Error ? e.message : String(e)}`)
    }
  }, [])

  return {
    workflow, params, set, setParams,
    settings, onSettingChange, models, options,
    collapsed, setCollapsed, advancedOpen, setAdvancedOpen,
    faceIdReady, motionReady, turboReady, ref2vReady, erosReady, realismReady, seedPreview, setSeedPreview,
    setImageB64, setEndImageB64,
    isGenerating, huntCount, setHuntCount, hasActiveJob, lastJobSeed,
    enh, enhanceDisabledReason, handleEnhance, handleRefine, handleGenerate, handleCancel,
  }
}

export type VideoFormApi = ReturnType<typeof useVideoFormState>

const VideoFormContext = createContext<VideoFormApi | null>(null)

export function VideoFormProvider({ children }: { children: React.ReactNode }) {
  const api = useVideoFormState()
  return <VideoFormContext.Provider value={api}>{children}</VideoFormContext.Provider>
}

export function useVideoForm(): VideoFormApi {
  const ctx = useContext(VideoFormContext)
  if (!ctx) throw new Error('useVideoForm must be used inside <VideoFormProvider>')
  return ctx
}
