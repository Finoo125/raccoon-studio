'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { videoWorkflows, supportsSeedHunt, isLtxWorkflow } from '@/lib/workflows/video-index'
import { useQueueStore } from '@/lib/comfyui/queue'
import { useStudioStore } from '@/lib/generation/studio-store'
import { unloadWriter, type EnhanceArgs } from '@/lib/comfyui/useCinematicEnhance'
import { submitPrompt } from '@/lib/comfyui/submit'
import { cancelVideoJobs } from '@/lib/comfyui/cancel-video'
import {
  fetchVideoPromptOptions,
  FALLBACK_OPTIONS,
  type VideoPromptOptions,
} from '@/lib/comfyui/video-prompt-options'
import type { EnhanceSettingsValues } from '@/lib/comfyui/enhance-settings'
import type { H3CheckpointId, H3KeyframeSlot, VideoGenerationParams } from '@/types/video-workflow'
import { inputViewUrl } from '@/lib/generation/upload'
import { downscaleFileToB64 } from '@/lib/generation/image-b64'
import { useOnDisk } from '@/components/setup/hooks'
import { H3_STOCK_CKPT, videoFilesFor, videoStarterFor, type StarterModel } from '@/lib/models/starter'
import { assetInstalled } from '@/lib/models/ltx23-assets'
import {
  H3_TURBO,
  H3_REF2V_TURBO_LORA,
  H3_REALISM_LORA,
  H3_REF2VA_CKPT,
  H3_EROS,
  H3_HYBRID,
  H3_SPARSEREF,
  H3_EDIT,
  H3_EDIT_FFP_LORA,
  H3_KEYFRAME_SLOTS,
  h3RefCheckpointReady,
  h3RefCount,
  h3TurboTier,
  type H3TurboTier,
  type H3EditKind,
} from '@/lib/workflows/minimax-h3'
import { useAddonLock, LTX_DIRECTOR_ADDON, PROMPT_HELPER_ADDON } from '@/lib/addons/useAddonLock'
import { migrateWriterId, simpleLtxSettings } from '@/lib/prompt-builder/video-picks'
import { editBlockReason, editInstallReason, refCheckpointReason, editHasInstruction } from '@/lib/video/edit-source'
import { visionShots } from '@/lib/workflows/director-timeline'
import { lastFrameB64, shotVisionB64 } from './director/lane-media'
import { clipViewUrl } from '@/lib/generation/useContinueVideo'
import { buildEnhanceArgs, missingFrame } from '@/lib/comfyui/enhance-args'
import { useUiMode, arriveAdvanced } from '@/lib/ui-mode'
import { simpleVideoMode, simpleVideoValues, advancedVideoReasons } from '@/lib/workflows/simple-values'

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
 * restore/persist pair and the prefill effect move across untouched, and no
 * consumer has to memoise a selector.
 */
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
    model: '',
    environment: FALLBACK_OPTIONS.environments[0],
    scenario: FALLBACK_OPTIONS.scenarios[0],
    camera: FALLBACK_OPTIONS.cameras[0],
    music: FALLBACK_OPTIONS.music[0],
    dialogueTier: 'standard',
    energy: 5,
    pov: false,
    povGender: 'female',
  })
  const [options, setOptions] = useState<VideoPromptOptions>(FALLBACK_OPTIONS)
  const [faceIdReady, setFaceIdReady] = useState(false)
  const [motionReady, setMotionReady] = useState(false)
  const [turboReady, setTurboReady] = useState<Record<H3TurboTier, boolean>>({
    draft: false,
    fast: false,
  })
  const [ref2vReady, setRef2vReady] = useState(false)
  const [erosReady, setErosReady] = useState(false)
  const [hybridReady, setHybridReady] = useState(false)
  const [sparserefReady, setSparserefReady] = useState(false)
  const [realismReady, setRealismReady] = useState(false)
  const { locked: directorLocked, loaded: addonsLoaded } = useAddonLock(LTX_DIRECTOR_ADDON)
  const [editReady, setEditReady] = useState<Record<H3EditKind | 'ffp', boolean>>({ vfx: false, style: false, head: false, ffp: false })
  const { locked: promptHelperLocked, loaded: promptHelperLoaded } = useAddonLock(PROMPT_HELPER_ADDON)
  const [imageB64, setImageB64] = useState('')
  /** The end frame's base64, for the vision pass. Same lifetime as `imageB64`. */
  const [endImageB64, setEndImageB64] = useState('')
  const [seedPreview, setSeedPreview] = useState<string | null>(null)
  const [isGenerating, setIsGenerating] = useState(false)
  // Seed hunt batch size; 0 = off. Form-local on purpose: `seedHunt` is a per-job
  // flag, so it must never reach the persisted `params` or a rerun.
  const [huntCount, setHuntCount] = useState(0)
  const [restored, setRestored] = useState(false)
  // The restore found a saved session — only then is the opening pick someone's choice to keep.
  const hadSession = useRef(false)
  // The UNETLoader check below has settled (answered or failed).
  const [unetAnswered, setUnetAnswered] = useState(false)

  // Director mode is a separate workflow definition, not a flag on the ltx23 one:
  // it drives a different graph with a different front-end. Every other mode
  // picks by `videoModel`, falling back to the default when that names a
  // workflow this build does not have (stale localStorage from an older install).
  // Simple renders Edit/Director sessions as t2v (spec §3): the stored mode stays for Advanced.
  const simple = useUiMode() === 'simple'
  const effectiveMode = simple ? simpleVideoMode(params.mode) : params.mode
  const workflow =
    effectiveMode === 'director'
      ? (videoWorkflows.find((w) => w.id === 'ltx23-director') ?? defaults)
      : (videoWorkflows.find((w) => w.id === params.videoModel && w.id !== 'ltx23-director') ??
        defaults)

  // Which files this pick cannot render without, read off the disk (ComfyUI is
  // restarted after every setup download, so disk and engine agree). Before
  // this, LTX 2.3 had no install check at all and failed as raw ComfyUI JSON.
  const { onDisk } = useOnDisk()
  const h3Ckpt = params.h3Checkpoint
  const neededFiles = videoFilesFor(workflow.id, h3Ckpt, effectiveMode)
  const missingNames = onDisk ? neededFiles.filter((f) => !onDisk.has(f)) : []
  const videoMissing: { files: string[]; model: StarterModel | null } | null =
    missingNames.length ? { files: missingNames, model: videoStarterFor(workflow.id, h3Ckpt) } : null
  // Unknown disk (null) counts as installed: a folder we cannot see must not grey a pick out.
  const h3BaseReady = !onDisk || onDisk.has(H3_STOCK_CKPT)

  // Open on a model this install has (spec §2.1): the saved pick if it can run,
  // else H3 Hybrid, then 10Eros Max, then stock H3, then LTX; with none of them
  // installed, Hybrid — the setup's recommendation — whose Download button then
  // stands in for Generate. Waits for the UNETLoader answer so its "file gone →
  // base" reset cannot land after this and undo the pick.
  const videoChecked = useRef(false)
  useEffect(() => {
    if (videoChecked.current || !restored || !onDisk || !unetAnswered || params.mode === 'director') return
    videoChecked.current = true
    const has = (id: string, ckpt?: H3CheckpointId) =>
      videoFilesFor(id, ckpt, params.mode).every((f) => onDisk.has(f))
    // A fresh browser has no pick of its own: LTX is only the built-in default.
    if (hadSession.current && has(workflow.id, h3Ckpt)) return
    const picks: { id: string; ckpt?: H3CheckpointId }[] = [
      { id: 'minimax-h3', ckpt: 'hybrid' }, { id: 'minimax-h3', ckpt: 'eros' }, { id: 'minimax-h3', ckpt: 'base' }, { id: 'ltx23' },
    ]
    const next = picks.find((p) => has(p.id, p.ckpt)) ?? picks[0]
    const w = videoWorkflows.find((x) => x.id === next.id)!
    // One-time correction once the disk has answered (no set-state-in-effect
    // directive: the linter already accepts a value read off a ref).
    setParams((p) => ({
      ...p,
      ...(w.id === p.videoModel ? {} : { ...w.defaultParams, videoModel: w.id, mode: p.mode }),
      ...(next.ckpt ? { h3Checkpoint: next.ckpt } : {}),
    }))
  }, [restored, onDisk, unetAnswered, params.mode, workflow.id, h3Ckpt])

  // Keep the timeline's clock matching the form's — duration and fps are form
  // controls, but the timeline ruler and the serializer's frame maths both read
  // them off the timeline.
  useEffect(() => {
    const { directorTimeline: t, setDirectorTimeline } = useStudioStore.getState()
    if (t.durationSeconds !== params.durationSeconds || t.fps !== params.fps) {
      setDirectorTimeline({ ...t, durationSeconds: params.durationSeconds, fps: params.fps })
    }
  }, [params.durationSeconds, params.fps])

  // Load the node's preset lists once.
  useEffect(() => {
    let alive = true
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

        // Realism adapter — default-ON whenever its file is installed, the same
        // "turn on when undefined" rule as the motion LoRA above (2026-10-14: the
        // skin test made it the one lever against oily, plastic H3 skin — matte
        // skin and the best face match on both checkpoints, no aging in daylight).
        // An explicit `false` the user chose is left alone. The reset guard stays:
        // the flag is persisted, so a session saved on a machine that had the file
        // would otherwise restore it behind a disabled checkbox and 400 the render.
        const realism = Array.isArray(names) && assetInstalled(H3_REALISM_LORA, installed)
        setRealismReady(realism)
        setParams((p) =>
          realism
            ? (p.realismLora === undefined ? { ...p, realismLora: true } : p)
            : (p.realismLora ? { ...p, realismLora: false } : p),
        )

        // Edit mode's LoRAs: one per kind, plus the first-frame one. A persisted
        // pick of a kind whose file is gone would 400 at validation behind a
        // disabled button, so it moves to the first installed one.
        const has = (name: string) => Array.isArray(names) && assetInstalled(name, installed)
        const edit: Record<H3EditKind | 'ffp', boolean> = {
          vfx: has(H3_EDIT.vfx.lora),
          style: has(H3_EDIT.style.lora),
          head: has(H3_EDIT.head.lora),
          ffp: has(H3_EDIT_FFP_LORA),
        }
        setEditReady(edit)
        // An unset kind is settled here too: the builder defaults to vfx, which
        // is the wrong file on a machine without it.
        const kinds: H3EditKind[] = ['vfx', 'style', 'head']
        setParams((p) =>
          (!p.editKind || !edit[p.editKind]) && kinds.some((k) => edit[k])
            ? { ...p, editKind: kinds.find((k) => edit[k]) }
            : p,
        )
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

        // The Eros finetune is a third optional checkpoint on the same loader.
        // Same persisted-flag reset the Turbo tiers need: a session saved where
        // the file existed would otherwise reopen naming a checkpoint ComfyUI
        // rejects at validation, behind a button that is now disabled.
        const eros = Array.isArray(names) && assetInstalled(H3_EROS.ckpt, installed)
        setErosReady(eros)
        // Only on a real answer: an offline or booting engine must never undo the pick.
        if (Array.isArray(names) && !eros) {
          setParams((p) => (p.h3Checkpoint === 'eros' ? { ...p, h3Checkpoint: 'base' } : p))
        }
        // The Hybrid (Plaguekind's recipe) is a fourth file on the same loader,
        // with the same persisted-pick reset.
        const hybrid = Array.isArray(names) && assetInstalled(H3_HYBRID.ckpt, installed)
        setHybridReady(hybrid)
        if (Array.isArray(names) && !hybrid) {
          setParams((p) => (p.h3Checkpoint === 'hybrid' ? { ...p, h3Checkpoint: 'base' } : p))
        }
        // SparseRef15 (the video helper's default) is a fifth, same reset.
        const sparseref = Array.isArray(names) && assetInstalled(H3_SPARSEREF.ckpt, installed)
        setSparserefReady(sparseref)
        if (Array.isArray(names) && !sparseref) {
          setParams((p) => (p.h3Checkpoint === 'sparseref' ? { ...p, h3Checkpoint: 'base' } : p))
        }
        // `mode` is persisted, so a session saved where reference mode could run
        // would restore into a mode whose button is now disabled, with no way
        // back to it in the UI. Same reasoning as the Director add-on guard below.
        // After the checkpoint resets above, so it judges the pick that remains:
        // Eros and the Hybrid serve reference mode without the stock ref2va file.
        if (Array.isArray(names)) setParams((p) => (p.mode === 'ref2v' &&
          !h3RefCheckpointReady(p.h3Checkpoint, { ref2v: ready, eros, hybrid, sparseref }) ? { ...p, mode: 't2v' } : p))
      })
      .catch(() => {})
      .finally(() => { if (alive) setUnetAnswered(true) })
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
          // Same reason as refImages: input/ filenames that may be gone.
          keyframes: undefined,
          refVideos: undefined, refAudios: undefined, editSource: undefined, editSourceWidth: undefined,
          editSourceHeight: undefined, editSourceFrames: undefined, editSourceHasAudio: undefined,
          editPictures: undefined, editPictureRoles: undefined, editFirstFrame: undefined, editFaceChecked: undefined,
          editPictureNotes: undefined }))
        // A form saved before the writer picker holds "None" or a bare Ollama name.
        if (saved.settings) setSettings((s) => ({ ...s, ...saved.settings, model: migrateWriterId(saved.settings?.model ?? '') }))
        hadSession.current = !!saved.params
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
    // A send that needs Advanced (Edit, an end frame, LoRAs, several takes) switches to it.
    arriveAdvanced(advancedVideoReasons(prefill.params, prefill.huntCount))
    // A send that names its model is a pick, like the image form's ?workflow= link: the opening check leaves it alone.
    if (named || prefill.params.videoModel) videoChecked.current = true
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

  // Edit is H3's: on LTX there is no button for it, so the mode must not
  // survive a model switch.
  useEffect(() => {
    if (params.mode === 'edit' && isLtxWorkflow(workflow.id)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- mode follows the model
      setParams((p) => ({ ...p, mode: 't2v' }))
    }
  }, [params.mode, workflow.id])

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
          keyframes: undefined,
          // Same reason again, and one more: continuing is a deliberate act
          // aimed at a specific clip. Restoring it a week later would silently
          // chain onto something the user has forgotten about — or, once that
          // clip is deleted, 400 every render with no visible cause.
          continueFrom: undefined,
          // An input/ or output/ clip that is gone 400s every render.
          editSource: undefined,
          editSourceWidth: undefined,
          editSourceHeight: undefined,
          editSourceFrames: undefined,
          editSourceHasAudio: undefined,
          // Same reason: input/ pictures that may be gone.
          editPictures: undefined,
          editPictureRoles: undefined,
          editPictureNotes: undefined,
          editFirstFrame: undefined,
          editFaceChecked: undefined,
          lora1: undefined, lora1Strength: undefined,
          lora2: undefined, lora2Strength: undefined,
          lora3: undefined, lora3Strength: undefined,
          lora4: undefined, lora4Strength: undefined,
        },
        settings,
      }))
    } catch { /* quota — non-fatal */ }
  }, [restored, params, settings])

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

  /** Every setting at once (the Prompt Helper's Use), mirrored into params exactly like `onSettingChange`. */
  const applySettings = useCallback((next: EnhanceSettingsValues) => {
    setSettings(next)
    setParams((p) => ({ ...p, ...Object.fromEntries([...RENDER_SETTING_KEYS].map((k) => [k, next[k]])) }))
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

  /** The keyframe pictures for the writer's vision pass; a slot that fails to read is dropped. */
  const keyframeVisionImages = useCallback(async (kf: VideoGenerationParams['keyframes']) => {
    const read = await Promise.all(H3_KEYFRAME_SLOTS.map(async (slot) => {
      const image = kf?.[slot]?.image
      if (!image) return null
      try {
        const b64 = await downscaleFileToB64(await (await fetch(inputViewUrl(image))).blob())
        return b64 ? { slot, b64 } : null
      } catch {
        return null
      }
    }))
    const ok = read.filter((r): r is { slot: H3KeyframeSlot; b64: string } => r !== null)
    const failed = H3_KEYFRAME_SLOTS.filter((s) => kf?.[s]?.image).length - ok.length
    if (failed > 0) {
      toast.warning(`${failed} keyframe picture${failed > 1 ? 's' : ''} could not be read — the writer works without ${failed > 1 ? 'them' : 'it'}; the render still lands on every keyframe.`)
    }
    return ok
  }, [])

  // What a Generate would render — in Simple, the overlay. The summary chips, the time
  // estimate, the length row and the Edit block read this, so a session saved in Edit
  // renders and reads as Words in Simple.
  // Memoised because enhanceArgsFor (a useCallback, like every handler here) depends on it.
  const renderParams: VideoGenerationParams = useMemo(
    () => (simple ? { ...params, ...simpleVideoValues(params, { motionReady, realismReady }) } : params),
    [simple, params, motionReady, realismReady],
  )

  /**
   * The enhance call's arguments for these settings. Everything it decides lives
   * in `buildEnhanceArgs`, which is pure and tested; all this adds is the one part
   * that cannot be — fetching the shot pictures, and only when Director asks
   * for them. In Simple the writer is told what Simple renders (`renderParams`),
   * not the Advanced values behind the overlay. `over.singleShot` is the
   * Prompt Helper's own copy of the switch.
   *
   * The reference arrays are dependencies, not incidental reads: without them
   * an enhance fires with the counts from before the last upload, and the
   * doctrine then names references that are no longer attached.
   */
  const enhanceArgsFor = useCallback(async (s: EnhanceSettingsValues, over?: { singleShot?: boolean }): Promise<EnhanceArgs> => {
    const p = over?.singleShot === undefined ? renderParams : { ...renderParams, singleShot: over.singleShot }
    return buildEnhanceArgs({
      // Simple on LTX hides Music, Talking and POV: the writer is told what its render uses.
      settings: simple && isLtxWorkflow(workflow.id) ? simpleLtxSettings(s, options) : s,
      params: p,
      workflowId: workflow.id,
      imageB64,
      endImageB64,
      directorImages: p.mode === 'director' ? await directorVisionImages() : [],
      // Lifted at the instant Enhance is pressed, like the Director pictures.
      // A failed grab sends '' and the node refuses to write ("CONTINUE needs an
      // image") rather than writing blind — blind is how it invented a new
      // outfit and room for a continuation once.
      continueFrameB64:
        p.continueFrom ? (await lastFrameB64(clipViewUrl(p.continueFrom))) ?? '' : '',
      // Lifted at the instant Enhance is pressed, like the Director pictures, so a
      // restored or prefilled form is shown them too. A failed read drops that
      // slot; buildEnhanceArgs then names only what was shown.
      keyframeImages: p.mode === 'ref2v' ? await keyframeVisionImages(p.keyframes) : [],
    })
  }, [renderParams, simple, options, imageB64, endImageB64, workflow.id, directorVisionImages, keyframeVisionImages])

  // The Prompt Helper (supporter add-on); Director owners keep their writer in Director mode
  // (the server's stream gate reads the same rule off the body's video_mode).
  const helperLock = {
    loaded: promptHelperLoaded,
    locked: promptHelperLocked && !(renderParams.mode === 'director' && !directorLocked),
  }

  // Every path into Edit lands here before Generate: the button, the toast.
  const editBlock = editBlockReason(renderParams) ?? editInstallReason(renderParams, { editReady, erosReady, ref2vReady, hybridReady, sparserefReady })

  const handleGenerate = useCallback(async () => {
    // Simple renders with defaults (spec §4); the stored form keeps its values.
    const p: VideoGenerationParams = simple ? { ...params, ...simpleVideoValues(params, { motionReady, realismReady }) } : params
    if (!editHasInstruction(p)) {
      toast.error('Write a prompt first')
      return
    }
    if (missingFrame(p)) {
      toast.error('Upload a start or end frame for image-to-video')
      return
    }
    const blocked = editBlockReason(p) ?? editInstallReason(p, { editReady, erosReady, ref2vReady, hybridReady, sparserefReady })
    if (blocked) {
      toast.error(blocked)
      return
    }
    if (p.mode === 'ref2v' && !h3RefCount(p)) {
      toast.error('Add at least one reference — image, clip or sound')
      return
    }
    // The mode button greys out on a pick that cannot serve reference mode, but
    // switching the checkpoint while IN reference mode leaves the mode set —
    // say what to install instead of letting ComfyUI 400 on a missing file.
    const refBlocked = p.mode === 'ref2v' ? refCheckpointReason(p, { erosReady, ref2vReady, hybridReady, sparserefReady }) : null
    if (refBlocked) {
      toast.error(refBlocked)
      return
    }
    setIsGenerating(true)
    try {
      // Free the Ollama model's VRAM before the render so the LTX model always
      // has headroom. Best-effort: a failed/slow unload must not block the render.
      try {
        toast('Freeing VRAM…')
        await unloadWriter()
      } catch { /* best-effort unload */ }

      const seed = p.seed < 0 ? Math.floor(Math.random() * 9999999999999) : p.seed
      // `huntCount` is form-local state that survives a model switch, so a graph
      // whose builder ignores `seedHunt` would render N clips at full price while
      // the UI promised cheap previews. Allowlist, not truthiness.
      const n = !simple && supportsSeedHunt(workflow.id) && p.mode !== 'edit' ? huntCount || 1 : 1
      for (let i = 0; i < n; i++) {
        // Candidates differ by seed alone — same graph, same LoRAs, same dims —
        // which is what lets the winner's seed reproduce the clip that was picked.
        const jobParams: VideoGenerationParams = {
          ...p,
          seed: seed + i,
          seedHunt: n > 1,
          // The timeline is edited in its own panel, so it is read from the store
          // at submit rather than mirrored into form state. The prompt box IS the
          // global prompt here; per-segment prompts are on the timeline, and
          // duration/fps stay owned by this form.
          ...(p.mode === 'director'
            ? {
                timeline: {
                  ...useStudioStore.getState().directorTimeline,
                  globalPrompt: p.prompt,
                  durationSeconds: p.durationSeconds,
                  fps: p.fps,
                },
              }
            : {}),
        }
        const prompt = workflow.buildPrompt(jobParams)
        // preview_method:'auto' tells ComfyUI to emit live latent (noise) preview
        // frames during sampling — same as the image tab.
        const prompt_id = await submitPrompt({ prompt, client_id: clientId, extra_data: { preview_method: 'auto' } })
        addJob(prompt_id, workflow.id, workflow.name, p.prompt, jobParams, 'video')
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
  }, [params, simple, motionReady, realismReady, workflow, clientId, addJob, huntCount, editReady, erosReady, ref2vReady, hybridReady, sparserefReady])

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
    settings, onSettingChange, applySettings, options,
    faceIdReady, motionReady, turboReady, ref2vReady, erosReady, hybridReady, sparserefReady, realismReady, editReady,
    videoMissing, h3BaseReady, onDisk, simple, renderParams,
    editBlock, seedPreview, setSeedPreview,
    setImageB64, setEndImageB64,
    isGenerating, huntCount, setHuntCount, hasActiveJob, lastJobSeed,
    handleGenerate, handleCancel,
    enhanceArgsFor, helperLock,
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
