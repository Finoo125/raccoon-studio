'use client'

import { Fragment, useEffect, useRef, useState } from 'react'
import { Shuffle, RotateCcw, Clapperboard, Loader2, Upload, X, ImageIcon, Square, ChevronDown, Plus, Lock } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import DownloadModelButton from '@/components/setup/DownloadModelButton'
import LoraSelector from './LoraSelector'
import PromptReview from './PromptReview'
import VideoPromptHelperDialog, { VideoPromptHelperButton } from './VideoPromptHelper'
import { useImagePicker } from './PickImageDialog'
import { downscaleToB64AndDims } from '@/lib/generation/image-b64'
import { uploadImageBlob, inputViewUrl } from '@/lib/generation/upload'
import { useFileDrop } from '@/lib/generation/useFileDrop'
import { useVideoForm } from './video-form-context'
import { InfoTip, Knob } from './SwitchTile'
import { useVideoFaceSwap } from '@/lib/generation/useVideoFaceSwap'
import { useDescribePicture } from '@/lib/generation/useDescribePicture'
import { KREA2_TEXT_ENCODER } from '@/lib/video/describe'
import { videoWorkflows, isLtxWorkflow, supportsSeedHunt } from '@/lib/workflows/video-index'
import { LTX_FPS, ltxRifeFps } from '@/lib/workflows/ltx23'
import {
  H3_RIFE_FPS,
  H3_REF_BUDGET,
  H3_REF_MAX,
  H3_REF_ROLES,
  H3_MIN_DURATION_S,
  H3_MAX_DURATION_S,
  h3ClampDuration,
  h3DeliveredSeconds,
  h3RefCount,
  h3TurboTier,
  h3UsesEros,
  h3Profile,
  H3_HYBRID,
  H3_SPARSEREF,
  compactRefs,
  refPictureNumber,
  H3_EROS,
  H3_UPSCALE_SCALE,
  type H3TurboTier,
  H3_KEYFRAME_SLOTS,
  h3FrameCount,
  h3KeyframeFrames,
  h3RefCheckpointReady,
  h3KeyframeClipSeconds,
  h3EditPlan,
  h3EditPictures,
  h3EditKind,
  H3_EDIT_PICTURE_MAX,
  orderedRefImages,
} from '@/lib/workflows/minimax-h3'
import type { H3CheckpointId, H3Keyframe, H3KeyframeSlot, VideoGenerationParams, VideoWorkflowDefinition } from '@/types/video-workflow'
import { useQueueStore } from '@/lib/comfyui/queue'
import { estimateSeconds, huntMultiplier } from '@/lib/generation/video-cost'
import { formatSeconds } from '@/lib/generation/eta'
import { FREE_LORA_SLOTS, LORA_STACK_ACK_KEY } from '@/lib/workflows/lora-chain'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import { useAddonLock, LTX_DIRECTOR_ADDON } from '@/lib/addons/useAddonLock'
import { SUBSCRIBE_PAGES } from '@/lib/addons/membership'
import { editSourceRef, editBlockReason, editHasInstruction, withEditKindChange } from '@/lib/video/edit-source'
import { summaryLine } from '@/lib/prompt-builder/video-picks'
import type { EnhanceSettingsValues } from '@/lib/comfyui/enhance-settings'
import { EDIT_JOIN_OVERLAP } from '@/lib/workflows/h3-edit-chunks'
import Link from 'next/link'

/** Pixel-budget tiers — dims live in `lib/workflows/ltx23.ts` (they vary by orientation). */
export const RESOLUTION_TIERS = [
  { id: 'high', label: 'Full HD', short: '~2 MP · slowest', hint: '~2 MP — full-size render. Slowest setting; wants 24 GB+.' },
  { id: 'medium', label: '900p', short: '~1.4 MP · a third fewer pixels', hint: '~1.4 MP — a third fewer pixels than Full HD, most of the detail.' },
  { id: 'low', label: '720p', short: '~0.9 MP · much faster', hint: '~0.9 MP — less than half the pixels. Much faster, and keeps 16 GB cards out of shared GPU memory.' },
] as const

/**
 * MiniMax H3 speed tiers, slowest first so the list reads as a dial. `id` is
 * the `turbo` param value; step counts and strengths live in `H3_TURBO`.
 *
 * The two Turbo tiers are separate optional downloads, so `download` is the
 * copy shown when the tier's LoRA is not on disk — a tier stays visible and
 * disabled rather than hidden, since someone who cannot see it cannot decide
 * they want the file.
 */
const H3_SPEED_TIERS: { id: false | H3TurboTier; label: string; short: string; hint: string; download: string }[] = [
  {
    id: false,
    label: 'Full',
    short: '20 steps · best quality',
    hint: '20 steps, no distillation — the best this model renders, and the slowest.',
    download: '',
  },
  {
    id: 'draft',
    label: 'Draft',
    short: '6 steps · ~3× faster, testing only',
    hint: 'For testing prompts and finding seeds only — roughly 3× faster, and visibly worse than a Full render (plastic-looking skin, over-sharp grain). Once a prompt and seed look right, switch back to Full and render the real clip.',
    download: 'Adds the 4-step Turbo LoRA (620 MB)',
  },
  {
    id: 'fast',
    label: 'Fast',
    short: '8 steps · ~2× faster, keepable',
    hint: 'lightx2v 8-step distillation — roughly 2× faster than Full and close enough in quality to keep. Start here if Full is too slow; drop to Draft only while you are still hunting for a prompt.',
    download: 'Adds the lightx2v 8-step Turbo LoRA (2 GB)',
  },
]

/**
 * Which H3 checkpoint renders the clip. Both run the same graph through the same
 * builder, so this is a second row under Model rather than a third Model button
 * — every H3 mode, doctrine and feature still applies either way.
 *
 * `download` is the copy shown when the file is not on disk; like the Speed
 * tiers, an uninstalled option stays visible and disabled, since someone who
 * cannot see it cannot decide they want it.
 */
const H3_CHECKPOINTS: { id: H3CheckpointId; label: string; short: string; hint: string; download: string }[] = [
  {
    id: 'base',
    label: 'Standard',
    short: 'as it ships',
    hint: 'MiniMax H3 as it ships — 20 steps by default, with the Speed row below to trade quality for time.',
    download: 'Adds the standard H3 checkpoint (21 GB)',
  },
  {
    id: 'eros',
    label: '10Eros Max',
    short: `uncensored finetune · always ${H3_EROS.steps} steps`,
    hint: `An uncensored community finetune (TenStrip, beta6) with adult character grafted in from Wan 2.2, Krea 2 and LTX 2.3. Its own Turbo is already merged into the weights, so it always renders at ${H3_EROS.steps} steps and the Speed row does not apply. Works in every mode, reference included.`,
    download: 'Adds the 10Eros Max checkpoint (21 GB)',
  },
  {
    id: 'hybrid',
    label: 'Hybrid',
    short: `Plaguekind recipe · ${H3_HYBRID.steps} steps`,
    hint: `Plaguekind's V11 recipe: the stock checkpoint merged with its reference model, rendered at ${H3_HYBRID.steps} steps without Turbo. In our test against 10Eros it moved more steadily and had wider stereo, at about a third more render time. Works in every mode, reference included.`,
    download: 'Adds the Hybrid checkpoint (21 GB)',
  },
  {
    id: 'sparseref',
    label: 'SparseRef15',
    short: `steadiest face · ${H3_SPARSEREF.steps} steps`,
    hint: `Aki7777777's SparseRef15 hybrid (fl2va with a sparse reference effect) with lightx2v's turbo LoRA at ${H3_SPARSEREF.steps} steps. In the helper's 2026-10-16 round it held her face best and moved most steadily of four checkpoints. Works in every mode, reference included.`,
    download: 'Needs the SparseRef15 checkpoint (21 GB, from Civitai — sign in there and put it in models/diffusion_models) and its turbo LoRA (2 GB)',
  },
]

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <label className="flex items-center text-sm font-semibold tracking-tight">
      <span className="mr-2 h-3.5 w-1 rounded-full bg-primary/70" />
      {children}
    </label>
  )
}

/** Uppercase group divider separating the Prompt and Render halves of the form. */
export function GroupHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 pt-1">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {children}
      </span>
      <span className="h-px flex-1 bg-border" />
    </div>
  )
}

/**
 * Rank 2: a field inside a group.
 *
 * `SectionLabel`'s orange bar is the panel's loudest mark and there were twenty
 * of them, which made "Resolution" — changed every render — look exactly like
 * "Sharpen", set once and forgotten. The bar is now reserved for a group's
 * headline control; everything paired or nested under one uses this.
 */
export function FieldLabel({ children }: { children: React.ReactNode }) {
  return <span className="text-xs font-semibold tracking-tight text-muted-foreground">{children}</span>
}

/**
 * Two controls side by side.
 *
 * The panel is 37.5rem wide and was laid out as one column of full-width
 * controls, so a 600px button could read "Sharpen off". Flex rather than a
 * fixed grid for two reasons: half of these pairs have a model-conditional
 * second half, which then fills the row instead of leaving a hole, and the
 * whole thing folds back to one column inside Director's 20rem inspector.
 */
function Pair({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap gap-2.5 [&>*]:min-w-[12.5rem] [&>*]:flex-1">{children}</div>
}

/**
 * Rank 3: an on/off setting, in the one spelling all of them now use.
 *
 * It replaces three older idioms — a checkbox in a bordered card, a segmented
 * pair, and a full-width button whose own *label changed* to report its state
 * ("Grain on — softer, film-like" / "Grain off — model output as-is"). That
 * last one is why a column of toggles could not be scanned: every row said
 * something different depending on what it was set to, so you had to read all
 * of them to learn what was on. Here the label never moves and the switch
 * carries the state.
 */
function ToggleRow({
  label, on, onChange, disabled = false, note, title,
}: {
  label: string
  on: boolean
  onChange: (next: boolean) => void
  disabled?: boolean
  /** Small trailing text — an install state, a unit, a fixed value. */
  note?: string
  title?: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      title={title}
      onClick={() => onChange(!on)}
      // Full width, so a switch on its own fills the row; inside a Pair the
      // flex basis wins and two share it. Drawn like the image page's switches.
      className={`flex w-full min-w-0 items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-sm font-medium transition-colors ${
        on ? 'border-primary/40 bg-primary/10' : 'border-border bg-muted/30 hover:bg-muted/50'
      } disabled:cursor-not-allowed disabled:opacity-55`}
    >
      <Knob on={on} />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {note && <span className="shrink-0 text-[11px] font-normal text-muted-foreground">{note}</span>}
    </button>
  )
}

/**
 * The measured long-form copy, one click away instead of always on.
 *
 * Every one of these paragraphs earns its place — they are field measurements,
 * not filler — but 862 words of them stacked between the controls is what made
 * this panel unreadable. The summary line keeps the half you need while
 * choosing (it is often live state, so it stays a plain visible line); the rest
 * is verbatim behind an ⓘ, the same idiom as the image page.
 */
function Why({ summary, children }: { summary: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1 text-xs text-muted-foreground">
      <span className="min-w-0">{summary}</span>
      <InfoTip>{children}</InfoTip>
    </div>
  )
}

/**
 * Orientation as equal buttons, each with its frame drawn to scale — the image
 * page's aspect-ratio row. Labels are "Name W:H"; `compact` drops the name for
 * Director's narrow brief zone.
 */
export function OrientationPicker({ compact = false }: { compact?: boolean }) {
  const { workflow, params, set } = useVideoForm()
  return (
    <div
      className="grid gap-1.5"
      style={{ gridTemplateColumns: `repeat(${workflow.orientations.length}, minmax(0, 1fr))` }}
    >
      {workflow.orientations.map((o) => {
        const cut = o.label.lastIndexOf(' ')
        const ratio = o.label.slice(cut + 1)
        const [rw, rh] = ratio.split(':').map(Number)
        const scale = 16 / Math.max(rw || 1, rh || 1)
        return (
          <Button
            key={o.value}
            variant={params.orientation === o.value ? 'default' : 'outline'}
            className={`h-auto min-w-0 flex-col gap-1 px-1 ${compact ? 'py-1' : 'py-1.5'}`}
            title={o.label}
            onClick={() => set('orientation', o.value)}
          >
            {rw > 0 && rh > 0 && (
              <span className="flex h-4 items-center">
                <span
                  className="rounded-[2px] border-[1.5px] border-current"
                  style={{ width: Math.round(rw * scale), height: Math.round(rh * scale) }}
                />
              </span>
            )}
            <span className="text-xs font-semibold leading-none">{ratio}</span>
            {!compact && cut > 0 && (
              <span className="text-[10px] font-normal leading-none opacity-70">{o.label.slice(0, cut)}</span>
            )}
          </Button>
        )
      })}
    </div>
  )
}

/**
 * The four flat LoRA slots the video params carry (`lora1`..`lora4`). Flat
 * rather than an array because that is the shape every builder already reads;
 * only the *rows* are dynamic.
 */
const LORA_SLOTS = [1, 2, 3, 4] as const

/** Models the picker offers — Director is a mode, not a choice in that list. */
const MODEL_CHOICES = videoWorkflows.filter((w) => w.id !== 'ltx23-director')

/** T2V / I2V / Director. A page-level mode in Director's layout, a field otherwise. */
export function ModeSwitch({ compact = false }: { compact?: boolean }) {
  const { params, set, workflow, ref2vReady, erosReady, hybridReady, sparserefReady } = useVideoForm()
  const { locked: directorLocked, loaded: addonsLoaded } = useAddonLock(LTX_DIRECTOR_ADDON)
  // Two model-bound modes, mirror images of each other. Director is the LTX
  // timeline graph, so under H3 it would silently render LTX instead; ref2v is
  // H3's reference checkpoint, which LTX has no equivalent of. Each family
  // therefore still offers exactly three modes.
  // Edit (H3 video-to-video) is H3's too, so H3 offers four and LTX three.
  const modes = (['t2v', 'i2v', 'ref2v', 'edit', 'director'] as const).filter(
    (m) =>
      (m !== 'director' || isLtxWorkflow(workflow.id)) &&
      (m !== 'ref2v' || !isLtxWorkflow(workflow.id)) &&
      (m !== 'edit' || !isLtxWorkflow(workflow.id)),
  )
  // Full literal class names: Tailwind scans source text.
  const cols = ({ 2: 'grid grid-cols-2 gap-2', 3: 'grid grid-cols-3 gap-2', 4: 'grid grid-cols-4 gap-2' } as Record<number, string>)[modes.length] ?? 'grid grid-cols-2 gap-2'
  // A stock-checkpoint edit renders the ref2va weights, an Eros one Eros — so
  // the gate follows the checkpoint actually picked.
  const refCkptReady = h3RefCheckpointReady(params.h3Checkpoint, { ref2v: ref2vReady, eros: erosReady, hybrid: hybridReady, sparseref: sparserefReady })
  // Loosely needs no edit LoRA, so the mode is usable with only a reference checkpoint.
  const editUninstalled = !refCkptReady
  return (
    <div className="space-y-2">
      {/* Full literal class names: Tailwind scans source text, so a
          `grid-cols-${n}` template would never be generated. */}
      {/* data-tour: rung by the first-run tour's video step — which kind of clip
          you are making is the first choice on this page. */}
      <div data-tour="/generate-videos" className={compact ? 'flex gap-1' : cols}>
        {modes.map((m) => {
          // Shown-but-locked rather than hidden: someone who cannot see the
          // feature cannot decide they want it. Until entitlements load, treat
          // it as unlocked so the button does not flicker into a locked state
          // on every page load for a supporter who owns it.
          const lockedHere = m === 'director' && addonsLoaded && directorLocked
          // Shown-but-disabled for the same reason Director is: someone who
          // cannot see the feature cannot decide they want the 21 GB download.
          const uninstalled = (m === 'ref2v' && !refCkptReady) || (m === 'edit' && editUninstalled)
          const unavailable = lockedHere || uninstalled
          return (
            <Button
              key={m}
              variant={params.mode === m ? 'default' : 'outline'}
              className={`${compact ? 'h-7 px-2.5 text-xs' : 'h-9 text-xs'}${unavailable ? ' opacity-60' : ''}`}
              title={
                lockedHere
                  ? 'Supporter feature — unlock it on the Supporters page'
                  : uninstalled
                    ? 'Needs the MiniMax H3 reference model — install it on the Models page'
                    : undefined
              }
              onClick={() => { if (!unavailable) set('mode', m) }}
            >
              {lockedHere && <Lock className={compact ? 'h-3 w-3' : 'h-3.5 w-3.5'} />}
              {m === 't2v'
                ? (compact ? 'Text' : 'Text → Video')
                : m === 'i2v'
                  ? (compact ? 'Image' : 'Image → Video')
                  : m === 'ref2v'
                    ? (compact ? 'Refs' : 'References → Video')
                    : m === 'edit'
                      ? (compact ? 'Edit' : 'Edit video')
                      : 'Director'}
            </Button>
          )
        })}
      </div>
      {!compact && addonsLoaded && directorLocked && modes.includes('director') && (
        <p className="rounded-lg border border-border bg-muted/30 p-2 text-xs text-muted-foreground">
          <strong>Director</strong> is a supporter feature — plan a whole scene on a timeline
          and render it as one film. It unlocks with a key from a{' '}
          {SUBSCRIBE_PAGES.map((p, i) => (
            <Fragment key={p.href}>
              {i > 0 && ' or '}
              <a href={p.href} target="_blank" rel="noreferrer" className="underline hover:text-foreground">
                {p.label}
              </a>
            </Fragment>
          ))}{' '}
          subscription; paste the key on the{' '}
          <Link href="/add-ons" className="underline hover:text-foreground">Supporters</Link> page
          to turn it on.
        </p>
      )}
    </div>
  )
}

/** The params a model pick changes — shared by the Model cards below and Simple's cards. */
export function modelPatch(
  p: VideoGenerationParams, w: VideoWorkflowDefinition, checkpoint?: H3CheckpointId,
): VideoGenerationParams {
  const active = MODEL_CHOICES.find((x) => x.id === p.videoModel) ?? MODEL_CHOICES[0]
  return {
    ...p,
    ...(w.id === active.id ? {} : { ...w.defaultParams, videoModel: w.id, mode: p.mode }),
    ...(checkpoint ? { h3Checkpoint: checkpoint } : {}),
  }
}

/**
 * Which model renders the clip, as family cards — the shape of the image page's
 * Model preset: LTX on one card, MiniMax H3 and its four checkpoints on the
 * other, so one click picks the model and the checkpoint. A checkpoint that is
 * not installed stays visible and greyed — someone who cannot see it cannot
 * decide they want the 21 GB download.
 *
 * Hidden in Director mode: that mode is bound to the LTX timeline graph, so a
 * picker there would offer a choice the builder ignores.
 *
 * Switching model also applies the target workflow's `defaultParams`, because
 * the families disagree on what a sane render is — LTX defaults to 15 s at 30
 * fps, which on H3 is 362 frames of a 33B model and reads as a hang. `mode` and
 * the prompt are preserved; everything else is the new family's own default.
 * Picking another checkpoint of the model already in use changes only that.
 */
export function ModelSwitch() {
  const { params, setParams, workflow, erosReady, hybridReady, sparserefReady, h3BaseReady } = useVideoForm()
  const choices = MODEL_CHOICES
  if (params.mode === 'director' || choices.length < 2) return null
  const active = choices.find((w) => w.id === params.videoModel) ?? choices[0]

  // Checkpoint is H3-only, and offered in every mode including reference:
  // Eros is built on ref2va's own weights, so it renders references as well as
  // it renders anything else (see `H3_EROS`).
  const showCheckpoint = !isLtxWorkflow(workflow.id)
  const ckpt = H3_CHECKPOINTS.find((c) => c.id === (params.h3Checkpoint ?? 'base'))!
  const readyOf = (id: H3CheckpointId) =>
    id === 'base' ? h3BaseReady : id === 'eros' ? erosReady : id === 'hybrid' ? hybridReady : sparserefReady
  const ckptMissing = showCheckpoint && !readyOf(ckpt.id)

  const pick = (w: VideoWorkflowDefinition, checkpoint?: H3CheckpointId) =>
    setParams((p) => modelPatch(p, w, checkpoint))

  return (
    <div className="space-y-2">
      <SectionLabel>Model</SectionLabel>
      {/* 1:2, not halves: H3's card carries four checkpoints to LTX's one, and
          at 2:3 "10Eros Max" and "SparseRef15" no longer fit their buttons. Each
          button starts from its label's width (flex-auto), so the long two get room. */}
      <div className="grid grid-cols-[1fr_2fr] gap-2">
        {choices.map((w) => {
          const ltx = isLtxWorkflow(w.id)
          // "LTX 2.3 Video" → LTX · 2.3; H3's variants are its checkpoints.
          const name = w.name.replace(/ Video$/, '')
          const cut = name.lastIndexOf(' ')
          const current = active.id === w.id
          const variants = ltx
            ? [{ key: w.id, label: name.slice(cut + 1), selected: current, ready: true, title: w.description, onClick: () => pick(w) }]
            : H3_CHECKPOINTS.map((c) => ({
                key: c.id,
                label: c.label,
                selected: current && (params.h3Checkpoint ?? 'base') === c.id,
                ready: readyOf(c.id),
                title: readyOf(c.id) ? c.hint : `${c.download} — install it on the Models page`,
                onClick: () => { if (readyOf(c.id)) pick(w, c.id) },
              }))
          return (
            <div
              key={w.id}
              className={`space-y-1.5 rounded-xl border p-2 transition-colors ${
                current ? 'border-primary/50 bg-primary/[0.07]' : 'border-border bg-muted/20'
              }`}
            >
              <p className={`px-0.5 font-heading text-xs font-bold uppercase tracking-wider ${
                current ? 'text-primary' : 'text-foreground/75'
              }`}>
                {ltx ? name.slice(0, cut) : name}
              </p>
              <div className="flex">
                {variants.map((v, i) => (
                  <Button
                    key={v.key}
                    variant={v.selected ? 'default' : 'outline'}
                    className={`h-8 min-w-0 flex-auto rounded-none px-2 text-sm first:rounded-l-lg last:rounded-r-lg${i > 0 ? ' -ml-px' : ''}${v.ready ? '' : ' opacity-45'}`}
                    title={v.title}
                    onClick={v.onClick}
                  >
                    <span className="truncate">{v.label}</span>
                  </Button>
                ))}
              </div>
            </div>
          )
        })}
      </div>

      {/* An uninstalled pick stays visible — someone who cannot see it cannot
          decide they want the download — so its state has to stay visible too,
          rather than folding into the ⓘ below. */}
      {ckptMissing && (
        <p className="text-[11px] text-muted-foreground">
          Not installed. {ckpt.download} — add it on the Models page to enable this.
        </p>
      )}

      <Why summary={showCheckpoint ? `${active.name} · ${ckpt.short}` : active.name}>
        <p>{active.description}</p>
        {showCheckpoint && !ckptMissing && <p>{ckpt.hint}</p>}
      </Why>
    </div>
  )
}

/**
 * The creative half: what the clip is about. Shape, source image, the enhancer
 * and the prompt itself.
 */
export function BriefPanel() {
  const {
    workflow, params, set, settings, seedPreview, setSeedPreview, setImageB64, setEndImageB64, setParams, helperLock,
  } = useVideoForm()
  const [helperOpen, setHelperOpen] = useState(false)

  return (
    <>
      {params.mode === 'edit' ? (
        <EditPanel />
      ) : params.mode === 'director' ? (
        <div className="space-y-2">
          <SectionLabel>Shape</SectionLabel>
          <OrientationPicker compact />
          <p className="text-[11px] text-muted-foreground">
            Used until you add an image to the timeline — then the video follows that
            image&rsquo;s shape instead.
          </p>
        </div>
      ) : params.mode === 'ref2v' ? (
        // References never appear as a frame, so there is no source aspect to
        // inherit — ref2v frames from the orientation picker exactly like t2v.
        <>
          <div className="space-y-2">
            <SectionLabel>Orientation</SectionLabel>
            <OrientationPicker />
          </div>
          <ReferencePanel />
        </>
      ) : params.mode === 't2v' ? (
        <div className="space-y-2">
          <SectionLabel>Orientation</SectionLabel>
          <OrientationPicker />
        </div>
      ) : (
        <div className="space-y-2">
          {/* H3's conditioning node takes an optional last frame as well as a
              first one, so the end slot is offered there and only there — LTX
              has no equivalent input. Which of MiniMax's three frame-anchored
              tasks runs is derived from which slots are filled (`h3Task`), so
              this is two extra abilities without a fourth mode button. Side by
              side because they are one decision: where the clip starts, and
              where it has to end up. */}
          <Pair>
            <div className="space-y-1.5">
              <FieldLabel>{isLtxWorkflow(workflow.id) ? 'Source image' : 'Start frame'}</FieldLabel>
              <SourceImageInput
                compact={!isLtxWorkflow(workflow.id)}
                value={params.inputImage}
                onChange={(filename) => { set('inputImage', filename); setSeedPreview(null) }}
                onB64={setImageB64}
                onDims={(d) => setParams((p) => ({ ...p, inputImageWidth: d?.w, inputImageHeight: d?.h }))}
                previewUrl={seedPreview}
              />
            </div>
            {!isLtxWorkflow(workflow.id) && (
              <div className="space-y-1.5">
                <FieldLabel>End frame — optional</FieldLabel>
                <SourceImageInput
                  compact
                  value={params.endImage}
                  previewUrl={params.endImage ? inputViewUrl(params.endImage) : undefined}
                  onChange={(filename) => set('endImage', filename)}
                  onB64={setEndImageB64}
                  onDims={(d) => setParams((p) => ({ ...p, endImageWidth: d?.w, endImageHeight: d?.h }))}
                />
              </div>
            )}
          </Pair>
          {!isLtxWorkflow(workflow.id) && (
            <>
              {/* Which of the three frame-anchored tasks the slots have chosen.
                  State, not advice, so it stays visible. */}
              <p className="text-[11px] text-muted-foreground">
                {params.endImage && params.inputImage
                  ? 'The clip travels from the start frame to the end frame as one continuous shot.'
                  : params.endImage
                    ? 'With no start frame the clip is built backwards — it opens somewhere plausible and lands on this image.'
                    : 'Add an end frame to say where the clip must finish. Leave it empty to just animate forward.'}
              </p>
              <Why summary="What an end frame is worth">
                <p>
                  The strongest fix there is for a face drifting away over a long clip: identity
                  against the source rose from 0.51 to 0.60 mean, and on the final frame from 0.41
                  to 0.90. A <em>different</em> photo of the same person works too, which frees the
                  framing — the clip lands on whichever face you point it at.
                </p>
              </Why>
            </>
          )}
        </div>
      )}

      {/* Every mode; Edit's dialog writes a one-line instruction instead of a script.
          The writer is the Prompt Helper (supporter add-on); the box stays free to type in. */}
      <div className="space-y-0.5">
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1"><GroupHeader>Prompt</GroupHeader></div>
          <VideoPromptHelperButton onOpen={() => setHelperOpen(true)} />
        </div>
        {helperLock.loaded && !helperLock.locked && (
          <button type="button" onClick={() => setHelperOpen(true)} data-writer-summary
            className="block w-full truncate text-right text-[11px] text-muted-foreground hover:text-foreground">
            {summaryLine(settings)}
          </button>
        )}
        <VideoPromptHelperDialog open={helperOpen} onClose={() => setHelperOpen(false)} />
      </div>

      <PromptReview
        prompt={params.prompt}
        onPromptChange={(v) => set('prompt', v)}
        {...(params.mode === 'director'
          ? {
              label: 'Global prompt',
              placeholder:
                'Describes the whole clip — anchor the characters, setting and look here. Per-shot detail goes on the timeline.',
            }
          : params.mode === 'edit'
            ? {
                label: h3EditKind(params) === 'head' ? 'New face' : 'Instruction',
                // The shape that worked in the 2026-10-02 test: the edit first,
                // then what must stay. The trigger word is added by the builder;
                // a head swap's text fills its template's "Facial details" line.
                placeholder:
                  h3EditKind(params) === 'style'
                    ? 'Transform this video into a hand-drawn anime style with clean ink lines.'
                    : h3EditKind(params) === 'head'
                      ? 'Describe the new face: woman, fifties, oval face, blue-grey eyes, short silver pixie cut.'
                      : 'Change her jacket into red leather; keep her face, pose, motion and the café.',
              }
            : {})}
      />

      {/* Not Director (ltx23-director): its graph has no music, speech or POV input, so these only steer its writer. */}
      {workflow.id === 'ltx23' && <LtxSoundRow />}
    </>
  )
}

const TALKING: { value: EnhanceSettingsValues['dialogueTier']; label: string }[] = [
  { value: 'none', label: 'Silent' },
  { value: 'standard', label: 'Standard' },
  { value: 'talkative', label: 'Talkative' },
]

/**
 * LTX's Music, Talking and POV: free, because on LTX they shape the render, not
 * only the script — negatives.build() keeps music out with no music picked,
 * speech out on Silent, and the camera out of frame for POV. The Prompt Helper
 * shows the same three and writes the same keys.
 */
export function LtxSoundRow() {
  const { settings, onSettingChange, options } = useVideoForm()
  return (
    <div className="space-y-2" data-ltx-sound>
      <Pair>
        <div className="space-y-1.5">
          <FieldLabel>Music</FieldLabel>
          <Select value={settings.music} onValueChange={(v: string | null) => { if (v !== null) onSettingChange('music', v) }}>
            <SelectTrigger aria-label="Music" className="h-8 w-full text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              {options.music.map((m) => <SelectItem key={m} value={m} className="text-sm">{m}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <FieldLabel>Talking</FieldLabel>
          <div className="flex gap-1.5">
            {TALKING.map((t) => (
              <Button key={t.value} variant={settings.dialogueTier === t.value ? 'default' : 'outline'}
                aria-pressed={settings.dialogueTier === t.value} className="h-8 flex-1 text-sm"
                onClick={() => onSettingChange('dialogueTier', t.value)}>
                {t.label}
              </Button>
            ))}
          </div>
        </div>
      </Pair>
      <Pair>
        <ToggleRow label="Point of view" on={settings.pov} onChange={(v) => onSettingChange('pov', v)} />
        {settings.pov && (
          <div className="flex gap-1.5">
            {(['female', 'male'] as const).map((g) => (
              <Button key={g} variant={settings.povGender === g ? 'default' : 'outline'} aria-pressed={settings.povGender === g}
                className="h-auto flex-1 py-2 text-sm" onClick={() => onSettingChange('povGender', g)}>
                {g === 'female' ? '♀ Female' : '♂ Male'}
              </Button>
            ))}
          </div>
        )}
      </Pair>
      <Why summary="These three change the clip itself, not only the script">
        <p>
          No music picked keeps music out of the clip. Silent keeps people from talking. Point of
          view films through someone&rsquo;s eyes and keeps the camera itself out of the picture.
        </p>
      </Why>
    </div>
  )
}

/**
 * Resolution and Speed are the two time knobs and they are read together — both
 * were three-button rows taking a full 600px each, with Duration and two toggles
 * wedged between them. Paired, they are one decision. Dropping the pixel budget is
 * the biggest speed lever there is; the low tier also keeps 16 GB cards on-card.
 * Labelled by resolution, not by VRAM — the speed is why most people reach for it.
 *
 * `simple` swaps the labels for plain words (Quick look / Good / Best) and drops
 * the long copy (Simple video, spec §3).
 */
const SIMPLE_QUALITY = { low: 'Quick look', medium: 'Good', high: 'Best' } as const
export function ResolutionSpeedRow({ simple = false }: { simple?: boolean }) {
  const { params, set, workflow, turboReady } = useVideoForm()
  const profile = h3Profile(params)
  const isLtx = isLtxWorkflow(workflow.id)
  const resTier = RESOLUTION_TIERS.find((t) => t.id === (params.vramMode ?? 'high'))!
  const showSpeed = !isLtx && !profile
  const speedTier = H3_SPEED_TIERS.find((t) => t.id === (h3TurboTier(params.turbo) ?? false))!
  const speedMissing = showSpeed && speedTier.id !== false && !turboReady[speedTier.id]
  // Simple reads as a dial from quick to best; Advanced keeps today's order.
  const tiers = simple ? [...RESOLUTION_TIERS].reverse() : RESOLUTION_TIERS
  return (
    <div className="space-y-2">
      <Pair>
        <div className="space-y-1.5">
          <FieldLabel>{simple ? 'Quality' : 'Resolution'}</FieldLabel>
          <div className="grid grid-cols-3 gap-1.5">
            {tiers.map((t) => (
              <Button
                key={t.id}
                variant={(params.vramMode ?? 'high') === t.id ? 'default' : 'outline'}
                className={simple ? 'h-auto flex-col gap-0.5 px-1 py-1.5 text-sm' : 'h-9 px-1 text-sm'}
                onClick={() => set('vramMode', t.id)}
              >
                {simple ? (<><span>{SIMPLE_QUALITY[t.id]}</span><span className="text-[10px] font-normal opacity-70">{t.label}</span></>) : t.label}
              </Button>
            ))}
          </div>
        </div>

        {/* Speed (H3 only) — which distillation LoRA renders the clip, or none.
            Named for the axis rather than the weights: the two tiers differ in
            what the output is FOR, not in a number anyone tunes. Off by
            default, and a tier whose LoRA is not on disk stays visible but
            disabled — someone who cannot see the option cannot decide they
            want it. Absent under the Eros checkpoint, whose own distillation is
            already in the weights: the builder forces `speed` to null there, so
            every tier would render identically. */}
        {showSpeed && (
          <div className="space-y-1.5">
            <FieldLabel>Speed</FieldLabel>
            <div className="grid grid-cols-3 gap-1.5">
              {H3_SPEED_TIERS.map((t) => {
                const ready = t.id === false || turboReady[t.id]
                return (
                  <Button
                    key={String(t.id)}
                    variant={(h3TurboTier(params.turbo) ?? false) === t.id ? 'default' : 'outline'}
                    className={`h-9 px-1 text-sm${ready ? '' : ' opacity-60'}`}
                    title={ready ? undefined : `${t.download} — install it on the Models page`}
                    onClick={() => { if (ready) set('turbo', t.id) }}
                  >
                    {t.label}
                  </Button>
                )
              })}
            </div>
          </div>
        )}
      </Pair>

      {/* An uninstalled tier stays pickable-looking on purpose, so its state
          has to stay visible rather than folding into the disclosure. */}
      {speedMissing && (
        <p className="text-[11px] text-muted-foreground">
          Not installed. {speedTier.download} — add it on the Models page to enable this.
        </p>
      )}

      {!simple && (
        <Why
        summary={
          showSpeed && !speedMissing
            ? `${resTier.label} · ${resTier.short} — ${speedTier.label} · ${speedTier.short}`
            : `${resTier.label} · ${resTier.short}`
        }
      >
        <p>{resTier.hint}</p>
        <p>
          Resolution is a <strong>time knob, not a quality knob</strong>: cost is linear in
          pixels at roughly 179&nbsp;s per megapixel, and measured detail barely moves between
          0.4 and 1.0&nbsp;MP.
        </p>
        {showSpeed && !speedMissing && <p>{speedTier.hint}</p>}
        <p>
          {isLtx
            ? 'Longer clips take proportionally longer to render.'
            : `Longer clips take proportionally longer to render. H3 was trained on ${H3_MIN_DURATION_S}–${H3_MAX_DURATION_S}s.`}
        </p>
      </Why>
      )}
    </div>
  )
}

/** Duration (or, in Edit, the clip's own length) — shared by RenderPanel and Simple video. */
export function DurationRow() {
  const { params, set, workflow, renderParams } = useVideoForm()
  const isLtx = isLtxWorkflow(workflow.id)
  return (
    <>
      {/* An edit is as long as its clip; there is nothing to choose. (Simple renders an Edit session as Words.) */}
      {renderParams.mode === 'edit' ? (
        <p className="text-xs text-muted-foreground">Length: the clip&rsquo;s own (up to 15 s).</p>
      ) : (
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <SectionLabel>Duration</SectionLabel>
          <span className="text-xs font-mono text-muted-foreground tabular-nums">
            {/* Clamped, not raw: form state persists, so a slider left at 30 s
                before H3 gained its ceiling would otherwise read "30s" over a
                render the builder caps at 15. */}
            {isLtx ? params.durationSeconds : h3ClampDuration(params.durationSeconds)}s · {params.fps}fps
            {/* A continuation delivers less than it samples: the pinned head
                comes off the front before saving. Showing only the slider value
                would over-report the clip by ~0.9 s at every link, and a chain
                of six would be five seconds shorter than the UI claimed. */}
            {!isLtx && params.continueFrom && (
              <span className="text-primary">
                {' '}→ {h3DeliveredSeconds(params.durationSeconds).toFixed(2)}s kept
              </span>
            )}
          </span>
        </div>
        {/* H3 was trained on 124–362 frames; the slider used to reach 30 s, which
            is twice that and renders worse for taking twice as long. The builder
            clamps regardless — this keeps the control from offering a number it
            will not honour. LTX has no such ceiling. */}
        <input
          type="range"
          min={isLtx ? 2 : H3_MIN_DURATION_S}
          max={isLtx ? 30 : H3_MAX_DURATION_S}
          step={1}
          value={isLtx ? params.durationSeconds : h3ClampDuration(params.durationSeconds)}
          aria-label="Duration"
          onChange={(e) => set('durationSeconds', Number(e.target.value))}
          className="w-full accent-primary"
        />
      </div>
      )}
    </>
  )
}

/**
 * The technical half: how the clip renders. Resolution, duration, stabilised
 * motion, Advanced and the seed hunt.
 */
export function RenderPanel({ seed = true }: { seed?: boolean } = {}) {
  const {
    params, set, setParams, motionReady, faceIdReady,
    huntCount, setHuntCount, workflow, turboReady,
  } = useVideoForm()

  /**
   * How many LoRA rows to show. Four permanently visible “None” rows spent a
   * quarter of the panel saying nothing, so this follows the image panel: two
   * to start, a dashed Add for the rest. Local state rather than a param
   * because the count is a view preference — and the slots themselves must
   * always come back empty (a persisted name whose file is gone fails
   * validation on every job).
   */
  const filledLoras = LORA_SLOTS.filter((i) => params[`lora${i}`]).length
  const [loraSlots, setLoraSlots] = useState(Math.max(FREE_LORA_SLOTS, filledLoras))
  const [loraWarnOpen, setLoraWarnOpen] = useState(false)

  /**
   * Past two slots the patches start competing, so the panel asks once — the
   * same question, off the same acknowledgement, as the image panel.
   */
  const requestLoraSlot = () => {
    let acked = false
    try { acked = localStorage.getItem(LORA_STACK_ACK_KEY) === '1' } catch { /* unavailable */ }
    if (loraSlots >= FREE_LORA_SLOTS && !acked) setLoraWarnOpen(true)
    else setLoraSlots((n) => n + 1)
  }
  const confirmLoraSlots = () => {
    try { localStorage.setItem(LORA_STACK_ACK_KEY, '1') } catch { /* quota or unavailable */ }
    setLoraSlots((n) => n + 1)
  }

  /**
   * Slots are four flat params, not an array, so removing one has to shift the
   * rest down by hand: clearing in place would leave a hole, and the row below
   * the one you removed would vanish with it as the count drops.
   */
  const removeLoraSlot = (slot: number) => {
    setParams((p) => {
      const names = LORA_SLOTS.map((i) => p[`lora${i}`] ?? '')
      const strengths = LORA_SLOTS.map((i) => p[`lora${i}Strength`] ?? 1)
      names.splice(slot - 1, 1)
      names.push('')
      strengths.splice(slot - 1, 1)
      strengths.push(1)
      return {
        ...p,
        ...Object.fromEntries(
          LORA_SLOTS.flatMap((i, idx) => [
            [`lora${i}`, names[idx]],
            [`lora${i}Strength`, strengths[idx]],
          ]),
        ),
      }
    })
    setLoraSlots((n) => Math.max(1, n - 1))
  }
  // A checkpoint with its own schedule (Eros: distillation merged in; Hybrid:
  // Plaguekind's 13-step recipe) retires the Speed row entirely and changes
  // what a seed-hunt candidate costs.
  const profile = h3Profile(params)
  // Stabilised motion and the seed hunt are LTX-graph features; see isLtxWorkflow.
  const isLtx = isLtxWorkflow(workflow.id)

  return (
    <>
      <ResolutionSpeedRow />

      <DurationRow />

      {/* Stabilised motion — deliberately outside Advanced: it is on by default, so
          it has to be visible enough that someone can find it and turn it off. A
          plain LoRA row, hence offered in both modes. */}
      {isLtx && (
        <div className="space-y-1.5">
          <ToggleRow
            label="Stabilised motion"
            on={params.motionLora === true}
            disabled={!motionReady}
            note={motionReady ? 'VBVR LoRA' : 'not installed'}
            title={motionReady ? undefined : 'Adds the VBVR motion LoRA (554 MB) — install it on the Models page'}
            onChange={(v) => set('motionLora', v)}
          />
          <Why summary={motionReady ? '92% less camera drift, at no extra render time' : 'Needs the VBVR motion LoRA (554 MB)'}>
            <p>
              {motionReady
                ? 'Holds the camera to whatever the prompt asks for — static when you ask for static, moving when you ask for a move — and steadies motion between frames. Measured on image-to-video: 92% less camera drift and 17% less flicker, at no extra render time. Turn it off to let the model move the camera on its own.'
                : 'Adds the VBVR motion LoRA (554 MB) for a steadier camera and less flicker — install it on the Models page to enable this.'}
            </p>
          </Why>
        </div>
      )}

      {/* Face identity — LTX i2v only: t2v has no source face to lock onto and
          the builder strips the whole conditioning path there. Sits beside
          Stabilised motion because both are about holding something still. */}
      {isLtx && params.mode === 'i2v' && (
        <div className="space-y-2">
          <ToggleRow
            label="Identity lock"
            on={params.faceId === true}
            disabled={!faceIdReady}
            note={faceIdReady ? undefined : 'not installed'}
            title={faceIdReady ? undefined : 'Needs the Best-FaceID LoRA (2.4 GB) — install it on the Models page'}
            onChange={(v) => set('faceId', v)}
          />
          {/* Without the LoRA the reinforcer would inject reference tokens the
              model was never trained to read — worse than leaving it off. */}
          {faceIdReady && params.faceId && (
            <>
              <Pair>
                <div className="flex items-center gap-2">
                  <FieldLabel>Strength</FieldLabel>
                  <Input
                    type="number"
                    min={0}
                    max={2}
                    step={0.1}
                    value={params.faceIdStrength ?? 1}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => set('faceIdStrength', Number(e.target.value))}
                    className="h-8 flex-1 min-w-0 font-mono text-sm"
                  />
                </div>
                {/* Two named states, not an on/off — “Face only” means something,
                    so it gets its own button rather than being the absence of
                    the other one. */}
                <div className="grid grid-cols-2 gap-1.5">
                  {([false, true] as const).map((whole) => (
                    <Button
                      key={String(whole)}
                      variant={(params.faceIdWholeSubject === true) === whole ? 'default' : 'outline'}
                      className="h-8 px-1 text-xs"
                      onClick={() => set('faceIdWholeSubject', whole)}
                    >
                      {whole ? 'Whole subject' : 'Face only'}
                    </Button>
                  ))}
                </div>
              </Pair>
              <Why summary="+12% identity on a wide shot, nothing on a close-up">
                <p>
                  Best when the subject is <strong>far from camera</strong> — measured
                  +12% identity hold on a wide shot, and it prevents the face drifting
                  away by the end. On a tight close-up it adds nothing, and “Face only”
                  makes it slightly worse; use “Whole subject” there. 1.0 is what the
                  LoRA was trained for.
                </p>
              </Why>
            </>
          )}
        </div>
      )}

      {/* LoRAs — up to four stack slots on top of the built-in distillation LoRA
          (LTX) or the Turbo LoRA (H3). Laid out like the image panel's: rows
          grow on demand instead of standing empty. */}
      <div className="space-y-2">
        <SectionLabel>LoRAs</SectionLabel>
        <div className="space-y-1.5">
          {LORA_SLOTS.slice(0, loraSlots).map((i) => (
            <LoraSelector
              key={i}
              label={`LoRA ${i}`}
              // An image LoRA dropped into an H3 slot does not fail validation:
              // ComfyUI loads it, matches no key and attaches **nothing**, which
              // the log records as `0 patches attached` and the user reads as
              // "the character LoRA does nothing". lora-arch.ts fingerprints H3
              // by `attn_qkv_proj`, so the slots can filter on it — and an
              // unrecognised LoRA still lists everywhere, so nothing vanishes.
              family={isLtx ? 'ltx' : 'h3'}
              value={params[`lora${i}`] ?? ''}
              strength={params[`lora${i}Strength`] ?? 1}
              onChange={(lora, strength) =>
                setParams((p) => ({ ...p, [`lora${i}`]: lora, [`lora${i}Strength`]: strength }))
              }
              onRemove={loraSlots > 1 ? () => removeLoraSlot(i) : undefined}
            />
          ))}
        </div>
        {loraSlots < LORA_SLOTS.length && (
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
          title={`Stack more than ${FREE_LORA_SLOTS} LoRAs?`}
          description={`Every LoRA patches the same weights, so past ${FREE_LORA_SLOTS} they start competing — expect weaker prompt adherence, muddier detail and drifting colour. Lowering each one's strength usually helps. You can stack up to ${LORA_SLOTS.length} here.`}
          confirmLabel="Add anyway"
          onConfirm={confirmLoraSlots}
        />
      </div>

      {/* The classic form pins Seed to its footer instead; Director's inspector
          keeps it here. */}
      {seed && <SeedField />}

      {/* Finish — what happens to the pixels after sampling. These five were the
          bottom half of the Advanced drawer, which meant the settings people
          reach for most were the ones behind a click; Advanced is now only what
          the word should mean. Visible, two-up, one switch idiom. */}
      <GroupHeader>Finish</GroupHeader>
      <FinishPanel />

      {/* Seed hunt — render N cheap half-res candidates that differ only by seed,
          then upscale just the one that gets picked. Lives beside the Generate
          button rather than in Advanced because it changes what Generate does.
          Each graph makes the candidate cheap its own way — LTX truncates after
          its half-res first pass, H3 forces Draft mode — hence the allowlist. */}
      {/* Edit renders the one clip it was given; seed candidates would be a separate graph. */}
      {supportsSeedHunt(workflow.id) && params.mode !== 'edit' && (
      <div className="space-y-2">
        {/* Reads "Seed hunt" normally, but a continuation is the case people
            most want several takes of and least expect the hunt to cover — it
            does, unchanged: candidates and the promoted keeper all carry
            `continueFrom`. Naming it here is the whole discoverability fix. */}
        <SectionLabel>{params.continueFrom ? 'Seed hunt — several takes on the next few seconds' : 'Seed hunt'}</SectionLabel>
        <div className="grid grid-cols-4 gap-2">
          {[0, 2, 3, 4].map((n) => (
            <Button
              key={n}
              variant={huntCount === n ? 'default' : 'outline'}
              className="h-9 text-sm"
              onClick={() => setHuntCount(n)}
            >
              {n === 0 ? 'Off' : n}
            </Button>
          ))}
        </div>
        {/* The three shares this multiplies by are measured per graph and live in
            `video-cost.ts`, which is also what the footer estimate reads — they
            used to be spelled out three times here, one per branch. */}
        <p className="text-xs text-muted-foreground">
          {huntCount === 0
            ? 'Render one clip straight through.'
            : isLtx
              ? `${huntCount} half-res candidates first, then upscale the one you pick — roughly ${huntMultiplier(workflow.id, params, huntCount).toFixed(1)}× one render.`
              : profile
                ? `${huntCount} takes that differ only by seed, then the one you pick is re-rendered — roughly ${huntMultiplier(workflow.id, params, huntCount).toFixed(1)}× one render.`
                : `${huntCount} quick drafts that differ only by seed, then the one you pick is re-rendered at full quality — roughly ${huntMultiplier(workflow.id, params, huntCount).toFixed(1)}× one render.`}
        </p>
        {/* The candidate/final quality gap is H3-specific and surprising enough
            that it has to be said outright: people will otherwise read a draft
            as the finished look and reject a perfectly good seed. */}
        {!isLtx && profile && huntCount > 0 && (
          <p className="rounded-lg border border-border bg-muted/30 p-2 text-xs text-muted-foreground">
            Candidates render at {profile.huntSteps} steps instead of {profile.steps}, so they are
            close to the clip you will keep — a touch rougher, but near enough to judge on.
          </p>
        )}
        {!isLtx && !profile && huntCount > 0 && (
          <p className="rounded-lg border border-border bg-muted/30 p-2 text-xs text-muted-foreground">
            Candidates always render distilled — at <strong>Draft</strong> speed, or at{' '}
            <strong>Fast</strong> if that is what you picked above — so they will look rougher than
            the final clip. Judge the <em>composition and motion</em>, not the detail. When you
            pick one, the candidate grid asks whether to render it at full quality (20 steps)
            or Fast (8 steps) — the Speed row above only governs the candidates.
            {!turboReady.draft && !turboReady.fast && (
              <> <strong className="text-destructive">Needs a Turbo LoRA</strong> — install one on
              the Models page, or the candidates cost a full render each.</>
            )}
          </p>
        )}
      </div>
      )}
    </>
  )
}

/**
 * Seed — one line. It used to be a section label, a full-width input and a
 * “-1 = random each time” paragraph: four rows for a field most renders never
 * touch. The convention now states itself, next to the value.
 */
export function SeedField() {
  const { params, set, lastJobSeed } = useVideoForm()
  return (
    <div className="flex items-center gap-2">
      <FieldLabel>Seed</FieldLabel>
      <Input
        type="number"
        value={params.seed}
        aria-label="Seed"
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => set('seed', Number(e.target.value))}
        className="h-8 w-28 shrink-0 font-mono text-sm"
      />
      {params.seed === -1 && (
        <span className="text-[11px] text-muted-foreground">random each time</span>
      )}
      <div className="ml-auto flex shrink-0 gap-1.5">
        <Button variant="outline" size="icon" className="h-8 w-8" title="Randomize" onClick={() => set('seed', -1)}>
          <Shuffle className="h-3.5 w-3.5" />
        </Button>
        {lastJobSeed !== null && lastJobSeed >= 0 && (
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={() => set('seed', lastJobSeed)}
            title={`Use last clip's seed (${lastJobSeed})`}
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
    </div>
  )
}

/**
 * Finish — the five settings that decide what the delivered clip looks like,
 * once sampling is done with it.
 *
 * They were the bottom five of a seven-item "Advanced" drawer that also held
 * LoRAs and Seed, which is the wrong grouping twice over: these are the ones
 * touched most often, and they were the ones behind a click. Two-up, one switch
 * idiom, and the four paragraphs of measured copy behind a single shared
 * disclosure rather than one each.
 */
function FinishPanel() {
  const { params, set, realismReady, workflow } = useVideoForm()
  const isLtx = isLtxWorkflow(workflow.id)
  // LTX bakes RIFE into its graph and splices it out when off; H3's graph is
  // core-only and splices it in when on — so the same param defaults opposite
  // ways and the toggle has to read it per model, never by bare truthiness.
  const rifeOn = isLtx ? params.rife !== false : params.rife === true

  return (
    <div className="space-y-2">
      <Pair>
        {/* Film grain (H3 only for now) — the same RES4LYF node and 0.04
            intensity the Krea2 / Z-Image paths use, so clips read like the
            stills do. Kept next to Realistic skin on purpose: grain *masks*
            smooth skin, the adapter repairs it, and seeing the two together is
            what tells you which one you actually want. */}
        {!isLtx && (
          <ToggleRow
            label="Film grain"
            on={params.filmGrain !== false}
            onChange={(v) => set('filmGrain', v)}
          />
        )}

        {/* Realistic skin (H3 only) — fal's realism adapter. */}
        {!isLtx && (
          <ToggleRow
            label="Realistic skin"
            on={params.realismLora === true}
            disabled={!realismReady}
            note={realismReady ? undefined : 'not installed'}
            title={realismReady ? undefined : 'Needs the 125 MB realism adapter — install it on the Models page'}
            onChange={(v) => set('realismLora', v)}
          />
        )}

        {/* RCAS sharpen (H3 only) — AMD's contrast-adaptive filter. Off by
            default: unlike grain this is taste, not a corrective. */}
        {!isLtx && (
          <ToggleRow
            label="Sharpen"
            on={params.sharpen === true}
            onChange={(v) => set('sharpen', v)}
          />
        )}

        {/* RTX upscale (H3 only) — NVIDIA Video Effects SDK. Off by default: it
            costs file size and is a delivery step, not a render setting. */}
        {!isLtx && (
          <ToggleRow
            label="Upscale"
            note={`${H3_UPSCALE_SCALE}×`}
            on={params.upscale === true}
            onChange={(v) => set('upscale', v)}
          />
        )}

        <ToggleRow
          label="Frame interpolation"
          note={`${isLtx ? ltxRifeFps(params.fps) : H3_RIFE_FPS} fps`}
          on={rifeOn}
          onChange={(v) => set('rife', v)}
        />

        {/* Defers everything above until the post-render face swap. Lives here
            rather than beside the reference slots because what it changes is
            when these four passes run, not how the clip is sampled. */}
        {!isLtx && (
          <ToggleRow
            label="Swap faces first"
            note="finish after"
            on={params.swapFaces === true}
            title="Hold the finishing passes back until after the face swap"
            onChange={(v) => set('swapFaces', v)}
          />
        )}
      </Pair>

      <Why
        summary={
          isLtx
            ? `Smooths motion to ${ltxRifeFps(params.fps)} fps`
            : 'Grain, skin, sharpen and upscale do four different jobs'
        }
      >
        {!isLtx && (
          <>
            <p>
              <strong>Film grain</strong> is on by default, and a different job from Realistic
              skin: grain lays texture over the whole frame, the adapter rebuilds the skin
              itself. Costs roughly 125&nbsp;ms per frame (~35&nbsp;s on a 10&nbsp;s clip).
              Neither will fix over-sharpening — for that, lower Draft mode&rsquo;s strength.
            </p>
            <p>
              <strong>Realistic skin</strong>{' '}
              {realismReady
                ? 'restores pores, fine lines and stubble that the model otherwise renders away, so faces hold up in close-up. Best on people; it does nothing for a shot with nobody in it. Works alongside Draft and Fast.'
                : 'needs the 125 MB realism adapter — install it on the Models page.'}
            </p>
            <p>
              <strong>Sharpen</strong> is a contrast-adaptive pass that lifts edge definition
              without the halos an ordinary sharpen leaves. It raises the detail that is already
              there — it cannot recover what the sampler dropped, so reach for more steps first
              if the clip is mushy rather than soft. Stacks with grain.
            </p>
            <p>
              <strong>Upscale</strong> enlarges the finished clip by {H3_UPSCALE_SCALE}&times; using
              NVIDIA&rsquo;s hardware upscaler. Measured 26% more detail than an ordinary resize
              and about 18&nbsp;s on a 12&nbsp;s clip &mdash; faster than the ordinary resize,
              not slower. It cannot recover detail the sampler never rendered, and it will not
              steady a drifting face; it makes a small render deliverable at a large size.
              NVIDIA cards only.
            </p>
          </>
        )}
        {!isLtx && (
          <p>
            <strong>Swap faces first</strong> holds all of the above back until the face swap.
            The swapper then works on raw frames &mdash; a third fewer of them, at a fraction of
            the area &mdash; and the grain and sharpen land <em>on</em> the swapped face instead
            of around it, which is what stops a swap leaving a smooth face-shaped patch in a
            grained clip. The catch: the clip that lands is <em>not finished</em>. Nothing else
            applies these passes, so open Swap faces &amp; finish on it, even to swap nobody.
          </p>
        )}
        <p>
          <strong>Frame interpolation</strong> smooths motion by generating in-between frames:{' '}
          {isLtx
            ? `LTX's ${params.fps ?? LTX_FPS} fps to ${ltxRifeFps(params.fps)}`
            : `H3’s fixed 24 fps to ${H3_RIFE_FPS}`}
          . The generated
          audio track is untouched and stays in sync.
        </p>
      </Why>
    </div>
  )
}

/**
 * What this render is about to cost — the one number the panel never showed.
 *
 * Six controls multiply render time (resolution, duration, speed, seed hunt,
 * grain, upscale) and each explained its own share in its own paragraph:
 * “roughly 2×”, “~35 s on a 10 s clip”, “about 18 s”. Nowhere were they
 * added up. `video-cost.ts` does the arithmetic against a rate learned from
 * this machine's own finished renders, so a fresh install with nothing to learn
 * from shows the chips and no number rather than one it invented. It reads as
 * approximate on purpose — anything that looks like a promise gets treated as
 * one.
 */
export function RenderSummary() {
  const { workflow, renderParams: params, huntCount: storedHunt, simple } = useVideoForm()
  // Simple never hunts seeds, and shows what it will actually render (the overlay).
  const huntCount = simple ? 0 : storedHunt
  const jobs = useQueueStore((s) => s.jobs)
  const isLtx = isLtxWorkflow(workflow.id)
  const profile = h3Profile(params)
  const seconds = estimateSeconds(workflow.id, params, huntCount, jobs)

  // Only what changes the render, and only when it is on: a chip row that
  // always says the same thing is a chip row nobody reads.
  const chips = [
    isLtx ? 'LTX 2.3' : h3UsesEros(params) ? '10Eros' : params.h3Checkpoint === 'hybrid' ? 'Hybrid' : params.h3Checkpoint === 'sparseref' ? 'SparseRef15' : 'H3',
    RESOLUTION_TIERS.find((t) => t.id === (params.vramMode ?? 'high'))!.label,
    params.mode === 'edit'
      ? params.editSourceFrames ? `${(params.editSourceFrames / 24).toFixed(1)}s` : null
      : `${isLtx ? params.durationSeconds : h3ClampDuration(params.durationSeconds)}s`,
    !isLtx && !profile
      ? H3_SPEED_TIERS.find((t) => t.id === (h3TurboTier(params.turbo) ?? false))!.label
      : null,
    !isLtx && params.filmGrain !== false ? 'grain' : null,
    !isLtx && params.realismLora === true ? 'skin' : null,
    !isLtx && params.upscale === true ? `${H3_UPSCALE_SCALE}×` : null,
    // Not a cost — a warning that the clip lands unfinished.
    !isLtx && params.swapFaces === true ? 'swap first' : null,
    huntCount > 0 ? `${huntCount} takes` : null,
  ].filter((c): c is string => c !== null)

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
      <div className="flex min-w-0 flex-wrap items-center gap-1">
        {chips.map((c, i) => (
          <span key={i} className="rounded-md bg-muted/60 px-1.5 py-0.5 text-muted-foreground">
            {c}
          </span>
        ))}
      </div>
      {seconds !== null && (
        <span
          className="ml-auto shrink-0 font-mono tabular-nums text-muted-foreground"
          title="Estimated from this machine's own recent renders — approximate"
        >
          &asymp;&nbsp;{formatSeconds(seconds)}
        </span>
      )}
    </div>
  )
}

/** Generate, flipping to Cancel while a render is queued or running. */
export function GenerateButton({ compact = false }: { compact?: boolean }) {
  const { hasActiveJob, isGenerating, params, handleGenerate, handleCancel, editBlock, videoMissing } = useVideoForm()
  const size = compact ? 'h-8 px-4 text-sm font-semibold' : 'w-full h-11 text-base font-bold'

  if (hasActiveJob) {
    return (
      <Button variant="destructive" className={`${size} shadow-lg`} onClick={handleCancel}>
        <Square className={`${compact ? 'h-3.5 w-3.5' : 'h-4 w-4'} mr-2 fill-current`} /> Cancel
      </Button>
    )
  }
  if (videoMissing?.model) {
    return <DownloadModelButton model={videoMissing.model} compact={compact} className={`${size} shadow-lg shadow-primary/25`} />
  }
  if (videoMissing) {
    return (
      <Button className={`${size} shadow-lg`} disabled title={`Missing: ${videoMissing.files.join(', ')}`}>
        Model files missing — get them on the Models page
      </Button>
    )
  }
  return (
    <Button
      className={`${size} shadow-lg shadow-primary/25 transition-shadow hover:shadow-primary/40`}
      onClick={handleGenerate}
      disabled={isGenerating || !editHasInstruction(params) || !!editBlock}
      title={editBlock ?? undefined}
    >
      {isGenerating ? (
        <><Loader2 className={`${compact ? 'h-4 w-4' : 'h-5 w-5'} mr-2 animate-spin`} /> Queuing…</>
      ) : (
        <><Clapperboard className={`${compact ? 'h-4 w-4' : 'h-5 w-5'} mr-2`} /> Generate video</>
      )}
    </Button>
  )
}

/**
 * Edit mode: the clip, what kind of edit, and its facts. The instruction is the
 * ordinary prompt box below (relabelled), so editing a prompt works as anywhere else.
 */
function EditPanel() {
  const { params, setParams, editReady, editBlock } = useVideoForm()
  const source = params.editSource
  const probed = !!params.editSourceFrames

  // Probe whenever a source arrives without its facts — an upload here, or a
  // clip handed over by the gallery's "Edit video".
  useEffect(() => {
    if (!source || probed) return
    let alive = true
    fetch('/api/video/probe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(editSourceRef(source)),
    })
      .then(async (r) => {
        const j = await r.json()
        if (!r.ok) throw new Error(j.error ?? r.statusText)
        return j as { width: number; height: number; frames: number; hasAudio: boolean }
      })
      .then((f) => {
        if (!alive) return
        setParams((p) => p.editSource === source
          ? { ...p, editSourceWidth: f.width, editSourceHeight: f.height, editSourceFrames: f.frames, editSourceHasAudio: f.hasAudio }
          : p)
      })
      .catch((e) => { if (alive) toast.error(`Could not read the clip: ${e instanceof Error ? e.message : String(e)}`) })
    return () => { alive = false }
  }, [source, probed, setParams])

  const block = editBlockReason(params)
  const loose = params.editFollow === 'loose'
  // What renders — Loosely is "Change something" only.
  const kind = h3EditKind(params)
  // Recomputed every render, never stored: it follows the tier and the join.
  const plan = h3EditPlan(params)
  const parts = plan?.length ?? 1
  // What will render, not what was clicked: a first frame forces Seamless.
  const join = plan?.[1]?.overlap === EDIT_JOIN_OVERLAP.fast ? 'fast' : 'seamless'
  const joinLocked = !!params.editFirstFrame && kind === 'vfx' && !loose

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <FieldLabel>Clip to edit — up to 15 s</FieldLabel>
        <RefFileInput
          accept="video/*"
          label="Pick a clip"
          value={source ? editSourceRef(source).filename : undefined}
          onChange={(f) => setParams((p) => ({
            ...p, editSource: f, editSourceWidth: undefined, editSourceHeight: undefined,
            editSourceFrames: undefined, editSourceHasAudio: undefined,
            // A first frame belongs to the clip it was cut from.
            editFirstFrame: undefined,
          }))}
        />
        {source && probed && !block && (
          <p className="text-[11px] text-muted-foreground">
            {params.editSourceWidth}×{params.editSourceHeight}, {(params.editSourceFrames! / 24).toFixed(1)} s
            {params.editSourceHasAudio ? ' — its sound is kept' : ' — no sound, H3 makes a soundtrack'}
            {parts > 1 && ` · renders in ${parts} parts, joined automatically`}
          </p>
        )}
        {block && source && <p className="text-[11px] text-destructive">{block}</p>}
        {!block && editBlock && <p className="text-[11px] text-destructive">{editBlock}</p>}
      </div>
      <div className="space-y-1.5">
        <FieldLabel>Follow the original</FieldLabel>
        <div className="grid grid-cols-2 gap-2">
          {(['exact', 'loose'] as const).map((f) => (
            <Button
              key={f}
              variant={(loose ? 'loose' : 'exact') === f ? 'default' : 'outline'}
              className="h-9 text-xs"
              onClick={() => setParams((p) => withEditKindChange(p, { editFollow: f }))}
            >
              {f === 'exact' ? 'Exactly' : 'Loosely'}
            </Button>
          ))}
        </div>
        <p className="text-[11px] text-muted-foreground">
          {loose
            ? 'Re-performs the clip from its motion — faster, can change a person\u2019s build, follows poses and framing more loosely. \u201cChange something\u201d only; works best with Describe pictures on.'
            : 'Keeps the take: same motion, framing and timing, only what you ask for changes.'}
        </p>
      </div>
      <div className="space-y-1.5">
        <FieldLabel>Edit</FieldLabel>
        <div className="grid grid-cols-3 gap-2">
          {(['vfx', 'style', 'head'] as const).map((k) => (
            <Button
              key={k}
              variant={kind === k ? 'default' : 'outline'}
              className={`h-9 text-xs${editReady[k] || (loose && k === 'vfx') ? '' : ' opacity-60'}`}
              disabled={loose && k !== 'vfx'}
              title={loose && k !== 'vfx' ? 'Exactly only' : editReady[k] ? undefined : 'Install this Edit LoRA on the Models page'}
              onClick={() => { if (editReady[k]) setParams((p) => withEditKindChange(p, { editKind: k })) }}
            >
              {k === 'vfx' ? 'Change something' : k === 'style' ? 'Restyle' : 'Swap head'}
            </Button>
          ))}
        </div>
      </div>
      <EditPicturesRow />
      {kind === 'vfx' && !loose && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-1">
            <FieldLabel>Start from an edited first frame (optional)</FieldLabel>
            <InfoTip>
              <p>
                The clip&rsquo;s first frame, already changed the way you want (for example in the
                Qwen Edit preset). The edit carries it through the whole clip.
              </p>
            </InfoTip>
          </div>
          <SourceImageInput
            value={params.editFirstFrame}
            previewUrl={params.editFirstFrame ? inputViewUrl(params.editFirstFrame) : undefined}
            onChange={(f) => setParams((p) => ({ ...p, editFirstFrame: f }))}
            onB64={() => {}}
            onDims={() => {}}
            disabled={!editReady.ffp}
            disabledHint="Install the First-frame Edit LoRA on the Models page"
            hint="The clip’s first frame, already edited — drag & drop supported."
          />
        </div>
      )}
      {parts > 1 && (
        <div className="space-y-1.5">
          <FieldLabel>Joins</FieldLabel>
          <div className="grid grid-cols-2 gap-2">
            {(['seamless', 'fast'] as const).map((j) => (
              <Button
                key={j}
                variant={join === j ? 'default' : 'outline'}
                className="h-9 text-xs"
                disabled={j === 'fast' && joinLocked}
                onClick={() => setParams((p) => ({ ...p, editJoin: j }))}
              >
                {j === 'seamless' ? 'Seamless' : 'Fast'}
              </Button>
            ))}
          </div>
          <p className="text-[11px] text-muted-foreground">
            {joinLocked
              ? 'With a first frame the parts always join seamlessly — each part starts from the one before.'
              : join === 'fast'
              ? 'Parts render on their own — quicker; a big change can show a small jump where they meet.'
              : 'Each part continues from the last 1.6 s of the one before — no visible joins, about a quarter more render time.'}
          </p>
        </div>
      )}
    </div>
  )
}

/**
 * Edit's pictures and what each is for. Own params, not reference mode's — a
 * picture left there must never reach an edit. A Person picture is checked for
 * a face once, and only then is the in-graph face swap offered (a faceless
 * reference would fail the render at its last step).
 */
function EditPicturesRow() {
  const { params, setParams } = useVideoForm()
  const { probe, detectPictureFace } = useVideoFaceSwap()
  const pictures = params.editPictures ?? []
  const head = h3EditKind(params) === 'head'
  const max = head ? 1 : H3_EDIT_PICTURE_MAX
  const [shown, setShown] = useState(1)
  // A filled slot can sit past `shown` after a remount — never hide one, it renders.
  const lastFilled = pictures.reduce((n, f, i) => (f ? i : n), -1)
  // Swap head shows the one slot the builder renders: the Person picture, else
  // the first in role order (`h3EditPictures`).
  const headPick = orderedRefImages(pictures, params.editPictureRoles)
  const headSlot = (headPick.find((x) => x.role === 'character') ?? headPick[0])?.slot ?? 0
  const slots = head
    ? [headSlot]
    : Array.from({ length: Math.min(max, Math.max(shown, lastFilled + 1)) }, (_, i) => i)
  const [swapAvailable, setSwapAvailable] = useState(false)
  const [checked, setChecked] = useState<{ file: string; found: boolean | null } | null>(null)
  // Bumped on every upload and retry: an upload can overwrite a picture under the
  // SAME name, and the check is keyed by name, so a name alone cannot tell.
  const [checkRun, setCheckRun] = useState(0)

  useEffect(() => {
    let alive = true
    void probe().then((c) => { if (alive) setSwapAvailable(c.available) })
    return () => { alive = false }
  }, [probe])

  const person = h3EditPictures(params).find((x) => x.role === 'character')?.file
  useEffect(() => {
    if (!person || !swapAvailable || params.editFaceChecked === person) return
    let alive = true
    detectPictureFace(person)
      .then((found) => {
        if (!alive) return
        setChecked({ file: person, found })
        if (found) setParams((p) => ({ ...p, editFaceChecked: person }))
      })
      .catch(() => { if (alive) setChecked({ file: person, found: null }) })
    return () => { alive = false }
  }, [person, swapAvailable, params.editFaceChecked, checkRun, detectPictureFace, setParams])

  const faceStatus = !person
    ? null
    : params.editFaceChecked === person
      ? 'ok'
      : checked?.file === person
        ? (checked.found === false ? 'none' : 'error')
        : 'checking'

  const recheck = () => {
    setChecked(null)
    setCheckRun((n) => n + 1)
  }

  // ── Describe pictures (optional): Built-in (Krea2's 4B) or an Ollama vision model ──
  // The words are what move a person — the edit LoRA takes only outfits and
  // places from a picture (measured 2026-10-03).
  const { describe } = useDescribePicture()
  const [builtinReady, setBuiltinReady] = useState(false)
  const [visionModels, setVisionModels] = useState<string[]>([])
  const [availLoaded, setAvailLoaded] = useState(false)
  const [describeErr, setDescribeErr] = useState<Record<number, string>>({})
  // slot -> what is being described there, so a late answer for a replaced
  // picture (or a changed role or describer) is dropped, never written.
  const inflight = useRef(new Map<number, string>())
  // slot -> the describe that failed there: not retried on every keystroke,
  // only by "Describe again", a new picture, role or describer.
  const failed = useRef(new Map<number, string>())
  // slot -> uploads so far: a re-upload under the SAME name is a new picture.
  const uploads = useRef(new Map<number, number>())
  useEffect(() => {
    let alive = true
    void Promise.all([
      fetch('/api/comfyui/object_info/CLIPLoader').then((r) => r.json()).catch(() => null),
      fetch('/api/video/vision-models').then((r) => r.json()).catch(() => null),
    ]).then(([clip, vm]) => {
      if (!alive) return
      const names: string[] = clip?.CLIPLoader?.input?.required?.clip_name?.[0] ?? []
      setBuiltinReady(names.includes(KREA2_TEXT_ENCODER))
      setVisionModels(Array.isArray(vm?.models) ? vm.models : [])
      setAvailLoaded(true)
    })
    return () => { alive = false }
  }, [])
  const describeWith = params.editDescribeWith ?? ''
  const describeOn = describeWith === 'builtin'
    ? builtinReady
    : describeWith.startsWith('ollama:') && visionModels.includes(describeWith.slice('ollama:'.length))
  // A stored describer that is gone (model removed, Krea2 deleted) falls back to off.
  useEffect(() => {
    if (availLoaded && describeWith && !describeOn) setParams((p) => ({ ...p, editDescribeWith: undefined }))
  }, [availLoaded, describeWith, describeOn, setParams])
  const notes = params.editPictureNotes ?? []
  // Reads the stable state fields, not the arrays rebuilt every render above, so
  // it runs when a picture, role or note changes — not on every render.
  const { editPictures, editPictureRoles, editPictureNotes } = params
  useEffect(() => {
    if (!describeOn) return
    const pics = editPictures ?? []
    const rls = editPictureRoles ?? []
    const nts = editPictureNotes ?? []
    const isHead = head
    const order = orderedRefImages(pics, rls)
    // Swap head describes only the one face that renders; otherwise every picture.
    const targets = isHead ? [(order.find((x) => x.role === 'character') ?? order[0])?.slot ?? 0] : pics.map((_, i) => i)
    for (const i of targets) {
      const file = pics[i]
      if (!file || nts[i] !== undefined) continue
      const role = isHead ? 'character' : rls[i] ?? null
      const key = `${file}#${uploads.current.get(i) ?? 0}|${role}|${describeWith}|${isHead}`
      if (inflight.current.get(i) === key || failed.current.get(i) === key) continue
      inflight.current.set(i, key)
      describe(file, role, isHead, describeWith)
        .then((text) => {
          if (inflight.current.get(i) !== key) return
          inflight.current.delete(i)
          setDescribeErr((e) => ({ ...e, [i]: '' }))
          setParams((p) => {
            const nowRole = isHead ? 'character' : p.editPictureRoles?.[i] ?? null
            if (p.editPictures?.[i] !== file || nowRole !== role || p.editDescribeWith !== describeWith) return p
            // Typed while it was describing: the user's words win.
            if (p.editPictureNotes?.[i] !== undefined) return p
            const next = [...(p.editPictureNotes ?? [])]
            next[i] = text
            return { ...p, editPictureNotes: next }
          })
        })
        .catch((err) => {
          if (inflight.current.get(i) !== key) return
          inflight.current.delete(i)
          failed.current.set(i, key)
          setDescribeErr((e) => ({ ...e, [i]: err instanceof Error ? err.message : String(err) }))
        })
    }
  }, [describeOn, describeWith, editPictures, editPictureRoles, editPictureNotes, head, describe, setParams])
  const setNote = (i: number, note: string | undefined) => {
    if (note === undefined) {
      inflight.current.delete(i)
      failed.current.delete(i)
    }
    setParams((p) => {
      const next = [...(p.editPictureNotes ?? [])]
      next[i] = note
      return { ...p, editPictureNotes: next }
    })
  }

  const setSlot = (i: number, file: string | undefined) => {
    recheck()
    uploads.current.set(i, (uploads.current.get(i) ?? 0) + 1)
    setParams((p) => {
      const files = [...(p.editPictures ?? [])]
      files[i] = file
      const roles = [...(p.editPictureRoles ?? [])]
      // The first picture defaults to the person — the common case; clearing a
      // picture clears its role so the next one does not inherit it. Swap
      // head's one slot is always the face.
      if (!file) roles[i] = undefined
      else if (head) roles[i] = 'character'
      else if (!roles[i] && !roles.includes('character')) roles[i] = 'character'
      const notesNext = [...(p.editPictureNotes ?? [])]
      notesNext[i] = undefined
      // Any upload invalidates the face check, even under the same file name,
      // and the old picture's description.
      return { ...p, editPictures: files, editPictureRoles: roles, editFaceChecked: undefined, editPictureNotes: notesNext }
    })
  }

  return (
    <div className="space-y-1.5">
      <FieldLabel>{head ? 'Face picture — the new head' : 'Pictures (optional) — a person, outfit, place…'}</FieldLabel>
      <select
        className="h-7 w-full rounded border border-border bg-background px-1.5 text-[11px] text-muted-foreground"
        value={describeOn ? describeWith : ''}
        onChange={(e) => {
          inflight.current.clear()
          failed.current.clear()
          setDescribeErr({})
          // A new describer describes every picture again.
          setParams((p) => ({ ...p, editDescribeWith: e.target.value || undefined, editPictureNotes: undefined }))
        }}
        aria-label="Describe pictures"
        title="Writes a description of each picture into the prompt — the edit takes a person's look only from words."
      >
        <option value="">Describe pictures: off</option>
        <option value="builtin" disabled={!builtinReady}>
          {builtinReady ? 'Describe with the built-in model (Krea2)' : 'Built-in model — install Krea2 on the Models page'}
        </option>
        {visionModels.map((m) => <option key={m} value={`ollama:${m}`}>Describe with Ollama: {m}</option>)}
      </select>
      {slots.map((i) => (
        <div key={i} className="space-y-1">
          {!head && pictures[i] && (
            <select
              className="h-6 rounded border border-border bg-background px-1 text-[11px] text-muted-foreground"
              value={params.editPictureRoles?.[i] ?? ''}
              onChange={(e) => setParams((p) => {
                const roles = [...(p.editPictureRoles ?? [])]
                roles[i] = e.target.value || undefined
                // A different role asks a different question.
                const notesNext = [...(p.editPictureNotes ?? [])]
                notesNext[i] = undefined
                return { ...p, editPictureRoles: roles, editPictureNotes: notesNext }
              })}
              aria-label={`What picture ${i + 1} is for`}
            >
              <option value="">What is it for?</option>
              {/* ponytail: no face close-up in Edit — its pictures go through the edit LoRA and the in-graph swap, never measured with one. */}
              {H3_REF_ROLES.filter((r) => r.id !== 'face').map((r) => <option key={r.id} value={r.id}>{r.id === 'character' ? 'Person' : r.label}</option>)}
            </select>
          )}
          <SourceImageInput
            value={pictures[i]}
            previewUrl={pictures[i] ? inputViewUrl(pictures[i]) : undefined}
            onChange={(f) => setSlot(i, f)}
            onB64={() => {}}
            onDims={() => {}}
            hint={head ? 'A clear picture of the new face — drag & drop supported.' : 'A person, an outfit or a place — drag & drop supported.'}
          />
          {describeOn && pictures[i] && (
            <div className="space-y-0.5">
              <textarea
                className="w-full rounded border border-border bg-background px-2 py-1 text-[11px]"
                rows={2}
                value={notes[i] ?? ''}
                placeholder={notes[i] === undefined ? 'describing…' : 'No description — type one, or describe again.'}
                onChange={(e) => setNote(i, e.target.value)}
                aria-label={`Description of picture ${i + 1}`}
              />
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => { setDescribeErr((e) => ({ ...e, [i]: '' })); setNote(i, undefined) }} className="text-[11px] text-muted-foreground underline hover:text-foreground">
                  Describe again
                </button>
                {describeErr[i] && <span className="text-[11px] text-destructive">{describeErr[i]}</span>}
              </div>
            </div>
          )}
        </div>
      ))}
      {!head && slots.length < max && (
        <button
          type="button"
          onClick={() => setShown(Math.min(slots.length + 1, max))}
          className="w-full rounded-lg border border-dashed border-border py-1.5 text-xs text-muted-foreground hover:bg-muted/40"
        >
          + Add picture
        </button>
      )}
      {person && h3EditKind(params) !== 'style' && swapAvailable && (
        <ToggleRow
          label="Also swap the face to this person"
          on={params.editSwapFace !== false && faceStatus === 'ok'}
          disabled={faceStatus !== 'ok'}
          note={faceStatus === 'checking' ? 'checking the face…' : faceStatus === 'none' ? 'no face found in this picture' : faceStatus === 'error' ? 'could not check' : undefined}
          title="Edits change hair, outfit and body but only half the face; this swaps the face to the picture afterwards, in the same job."
          onChange={(on) => setParams((p) => ({ ...p, editSwapFace: on }))}
        />
      )}
      {faceStatus === 'error' && h3EditKind(params) !== 'style' && swapAvailable && (
        <button type="button" onClick={recheck} className="text-[11px] text-muted-foreground underline hover:text-foreground">
          Check the face again
        </button>
      )}
      {/* Measured 2026-10-03: the edit LoRA takes outfits and places from a
          picture, but not a person's identity — the face comes from the swap,
          the rest of the look from the words. */}
      {person && !head && h3EditKind(params) !== 'style' && (
        <p className="text-[11px] text-muted-foreground">
          {describeOn
            ? 'The face comes from this picture, the rest of the look from its description.'
            : 'The face comes from this picture. Describe the new hair and clothes in the instruction — or switch on Describe pictures.'}
        </p>
      )}
    </div>
  )
}

/**
 * A plain upload row for a reference clip or sound file.
 *
 * `SourceImageInput` cannot be reused for these: it decodes what it is given as
 * an image to build the vision-pass thumbnail, which throws on an mp4 or a wav.
 * There is nothing to preview here either, so this shows the filename instead.
 */
function RefFileInput({
  value, accept, label, onChange, disabled = false,
}: {
  value?: string
  accept: string
  label: string
  onChange: (filename: string | undefined) => void
  disabled?: boolean
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)

  async function handleFile(file: File) {
    setUploading(true)
    try {
      // ComfyUI's /upload/image writes whatever bytes it is given — it does no
      // content-type check on the write path — so the one endpoint serves
      // images, video and audio alike.
      onChange(await uploadImageBlob(file, file.name))
    } catch (e) {
      toast.error(`${label} upload failed: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/20 p-2">
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) void handleFile(f)
        }}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={uploading || disabled}
        title={disabled ? `All ${H3_REF_BUDGET} references used — clear one first` : undefined}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 py-1 text-xs font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
      >
        {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
        {value ? 'Replace' : label}
      </button>
      <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground" title={value}>
        {value ?? 'none'}
      </span>
      {value && (
        <button
          type="button"
          onClick={() => { onChange(undefined); if (inputRef.current) inputRef.current.value = '' }}
          className="shrink-0 rounded p-1 text-muted-foreground hover:text-foreground"
          aria-label="Clear"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  )
}

/** A collapsible group of reference slots, used for the video and audio rows. */
function RefGroup({
  title, hint, count, max, open, onToggle, children,
}: {
  title: string
  hint: string
  count: number
  max: number
  open: boolean
  onToggle: () => void
  children: React.ReactNode
}) {
  return (
    <div className="rounded-xl border border-border bg-muted/10">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between px-3 py-2 text-left"
      >
        <span className="text-sm font-medium">{title}</span>
        <span className="flex items-center gap-2 text-xs text-muted-foreground">
          {count}/{max}
          <ChevronDown className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} />
        </span>
      </button>
      {open && (
        <div className="space-y-2 border-t border-border px-3 py-2">
          {children}
          <p className="text-[11px] text-muted-foreground">{hint}</p>
        </div>
      )}
    </div>
  )
}

const KEYFRAME_LABEL: Record<H3KeyframeSlot, string> = { start: 'Start', middle: 'Middle', end: 'End' }

/**
 * Pictures a reference render must hit — its first, middle and last frame. Not
 * references: no <Picture N>, no share of the budget. In a continuation the
 * previous clip IS the start, so that slot becomes a tile.
 */
function KeyframesRow() {
  const { params, setParams } = useVideoForm()
  const continuing = Boolean(params.continueFrom)
  const at = h3KeyframeFrames(h3FrameCount(h3ClampDuration(params.durationSeconds)), continuing)
  const kf = params.keyframes ?? {}
  const put = (slot: H3KeyframeSlot, patch: Partial<H3Keyframe> | null) =>
    setParams((p) => ({
      ...p,
      keyframes: { ...p.keyframes, [slot]: patch ? { image: '', ...p.keyframes?.[slot], ...patch } : undefined },
    }))
  const filled = H3_KEYFRAME_SLOTS.filter((s) => kf[s]?.image && at[s] !== undefined)
  // Clip time, i.e. what the delivered clip shows — a continuation's frozen head is trimmed.
  const sec = (s: H3KeyframeSlot) => `${h3KeyframeClipSeconds(at[s]!, continuing).toFixed(1)} s`
  const said = filled.map((s) =>
    s === 'start' ? 'starts on the Start picture'
    : s === 'middle' ? `passes through the Middle picture at ${sec(s)}`
    : `ends on the End picture at ${sec(s)}`)
  const summary = said.length
    ? `The clip ${said.length > 1 ? `${said.slice(0, -1).join(', ')} and ${said.at(-1)}` : said[0]}. Enhance writes it as one continuous shot.`
    : 'Add a picture to make the clip start on it, pass through it halfway, or end on it.'

  return (
    <div className="space-y-1.5">
      <SectionLabel>Keyframes — optional</SectionLabel>
      <div className="grid grid-cols-3 gap-2">
        {H3_KEYFRAME_SLOTS.map((slot) => (
          <div key={slot} className="min-w-0 space-y-1">
            <FieldLabel>{at[slot] === undefined ? 'Start' : `${KEYFRAME_LABEL[slot]} · ${sec(slot)}`}</FieldLabel>
            {at[slot] === undefined ? (
              <div className="flex aspect-square items-center justify-center rounded-lg border border-dashed border-border text-center text-[11px] text-muted-foreground">
                Previous clip
              </div>
            ) : (
              <SourceImageInput
                compact
                value={kf[slot]?.image || undefined}
                previewUrl={kf[slot]?.image ? inputViewUrl(kf[slot]!.image) : undefined}
                // Dims land before the filename (SourceImageInput's contract), so
                // both merge into whatever the slot already holds.
                onDims={(d) => put(slot, d ? { width: d.w, height: d.h } : { width: undefined, height: undefined })}
                onChange={(image) => put(slot, image ? { image } : null)}
                onB64={() => {}}
              />
            )}
          </div>
        ))}
      </div>
      <p className="text-[11px] text-muted-foreground">{summary}</p>
    </div>
  )
}

/**
 * Reference slots for MiniMax H3's ref2v mode: images, clips and sounds.
 *
 * Every filled slot is labelled by its **compacted** position within its own
 * type, not by its array index — the node counts `<Picture i>` / `<Video i>` /
 * `<Audio i>` over the references it actually receives, so clearing the first
 * image promotes the second to `<Picture 1>`. Labelling by index would tell the
 * user to write a tag the model never sees. Same `compactRefs` the builder
 * emits with, so the two can never disagree.
 *
 * Images are shown progressively and video/audio start collapsed, because the
 * common case is one or two stills and a wall of twelve uploaders reads as
 * work to do rather than options available.
 */
export function ReferencePanel({ simple = false }: { simple?: boolean } = {}) {
  const { params, set, setParams, setImageB64 } = useVideoForm()
  const images = params.refImages ?? []
  const videos = params.refVideos ?? []
  const audios = params.refAudios ?? []

  const [shown, setShown] = useState(2)
  const [openVideos, setOpenVideos] = useState(false)
  const [openAudios, setOpenAudios] = useState(false)

  const used = h3RefCount(params)
  const spent = used >= H3_REF_BUDGET

  const setSlot = (
    key: 'refImages' | 'refVideos' | 'refAudios' | 'refImageRoles',
    i: number,
    filename: string | undefined,
  ) =>
    setParams((p) => {
      const next = [...(p[key] ?? [])]
      next[i] = filename
      // Clearing a picture clears its role with it. Leaving it behind means the
      // next picture dropped in this slot silently inherits the old one's job,
      // and the only tell is a dropdown nobody looks at twice.
      const roles = key === 'refImages' && !filename ? { refImageRoles: cleared(p.refImageRoles, i) } : {}
      return { ...p, [key]: next, ...roles }
    })

  /** `list` with index `i` emptied, or undefined if there was nothing to empty. */
  const cleared = (list: (string | undefined)[] | undefined, i: number) => {
    if (!list?.[i]) return list
    const next = [...list]
    next[i] = undefined
    return next
  }

  /** `<Tag N>` for a filled slot, counted the way the node counts it. */
  const tag = (list: (string | undefined)[], i: number, kind: string) =>
    list[i] ? `<${kind} ${compactRefs(list.slice(0, i + 1)).length}>` : null
  // Pictures are numbered by role order, not slot order (character first —
  // see `orderedRefImages`), so the label follows the number the node uses.
  const pictureNo = (i: number) => refPictureNumber(images, params.refImageRoles, i)

  // Enough rows to show every filled slot even after the budget is spent, so a
  // reference can always be cleared again.
  const imageRows = Math.max(shown, compactRefs(images).length, images.length ? images.length : 0)

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <SectionLabel>References</SectionLabel>
        <span className="text-xs tabular-nums text-muted-foreground">
          {used}/{H3_REF_BUDGET} used
        </span>
      </div>

      {Array.from({ length: Math.min(imageRows, H3_REF_MAX.images) }, (_, i) => (
        <div key={i} className="space-y-1">
          <div className="flex items-center justify-between gap-2">
            <p className="font-mono text-[11px] text-muted-foreground">
              {images[i] ? `<Picture ${pictureNo(i)}>` : `Image slot ${i + 1} — empty`}
            </p>
            {/* What this picture is FOR. The writer never sees these images, so
                unset means it guesses from the brief — and it guesses that
                every picture is a character to preserve exactly. Only on a
                filled slot: a role for a picture that is not attached is a role
                the doctrine would name for a reference H3 never receives. */}
            {images[i] && (
              <select
                className="h-6 rounded border border-border bg-background px-1 text-[11px] text-muted-foreground"
                value={params.refImageRoles?.[i] ?? ''}
                onChange={(e) => setSlot('refImageRoles', i, e.target.value || undefined)}
                aria-label={`What Picture ${pictureNo(i)} is for`}
                title="What this reference is for. Unset lets the prompt writer guess. The character is always shown to H3 first, then a face close-up of the same person, which holds the face far better beside a character sheet. Outfit and prop pictures are sent without their face so nobody in them competes with the character. A typed prompt with no <Picture N> in it gets these roles written in front of it."
              >
                <option value="">Set a role…</option>
                {H3_REF_ROLES.map((r) => (
                  <option key={r.id} value={r.id}>{r.label}</option>
                ))}
              </select>
            )}
          </div>
          <SourceImageInput
            value={images[i]}
            // A slot can hold a name this browser never uploaded (a "send as
            // reference", a restored form), and the uploader only keeps an
            // object URL for its own uploads — without this the slot reads as
            // empty while holding a live reference.
            previewUrl={images[i] ? inputViewUrl(images[i]) : undefined}
            onChange={(filename) => setSlot('refImages', i, filename)}
            // Only the first slot feeds the enhancer's vision pass; it takes one image.
            onB64={(b64) => { if (i === 0) setImageB64(b64) }}
            onDims={() => {}}
            // The budget is shared, so an empty slot of ANY type has to respect
            // it — otherwise 3 videos + 3 sounds still leaves image slots live.
            disabled={spent && !images[i]}
            disabledHint={`All ${H3_REF_BUDGET} references used — clear one first`}
          />
        </div>
      ))}

      {imageRows < H3_REF_MAX.images && (
        <button
          type="button"
          disabled={spent}
          onClick={() => setShown((n) => Math.min(n + 1, H3_REF_MAX.images))}
          className="w-full rounded-lg border border-dashed border-border py-1.5 text-xs text-muted-foreground hover:bg-muted/40 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {spent ? `All ${H3_REF_BUDGET} references used` : '+ Add image'}
        </button>
      )}

      {/* Keyframes, clips, sounds and High-fidelity are Advanced (Simple video, spec §3). */}
      {!simple && (<>
      <KeyframesRow />

      <RefGroup
        title="Reference videos"
        count={compactRefs(videos).length}
        max={H3_REF_MAX.videos}
        open={openVideos}
        onToggle={() => setOpenVideos((o) => !o)}
        hint="A clip donates motion, camera movement or cutting rhythm — not its pixels. It is read as 24 fps and trimmed to the length of the clip you are making, so only the opening seconds count. Its own sound rides along automatically."
      >
        {Array.from({ length: H3_REF_MAX.videos }, (_, i) => (
          <div key={i} className="space-y-1">
            <p className="font-mono text-[11px] text-muted-foreground">
              {tag(videos, i, 'Video') ?? `Video slot ${i + 1} — empty`}
            </p>
            <RefFileInput
              value={videos[i]}
              accept="video/*"
              label="Upload clip"
              onChange={(f) => setSlot('refVideos', i, f)}
              disabled={spent && !videos[i]}
            />
          </div>
        ))}
      </RefGroup>

      <RefGroup
        title="Reference audio"
        count={compactRefs(audios).length}
        max={H3_REF_MAX.audios}
        open={openAudios}
        onToggle={() => setOpenAudios((o) => !o)}
        hint="A sound reference drives voice timbre or musical style, not the words — the dialogue is still whatever your prompt says."
      >
        {Array.from({ length: H3_REF_MAX.audios }, (_, i) => (
          <div key={i} className="space-y-1">
            <p className="font-mono text-[11px] text-muted-foreground">
              {tag(audios, i, 'Audio') ?? `Audio slot ${i + 1} — empty`}
            </p>
            <RefFileInput
              value={audios[i]}
              accept="audio/*"
              label="Upload sound"
              onChange={(f) => setSlot('refAudios', i, f)}
              disabled={spent && !audios[i]}
            />
          </div>
        ))}
      </RefGroup>

      <Why
        summary={<>
          Tag them in the prompt — <span className="font-mono">&lt;Picture 1&gt;</span>,{' '}
          <span className="font-mono">&lt;Video 1&gt;</span>,{' '}
          <span className="font-mono">&lt;Audio 1&gt;</span>
        </>}
      >
        <p>
          Give each one a single job: a character, a location, a style, a movement. More
          references do not make a better clip.
        </p>
      </Why>

      <ToggleRow
        label="High-fidelity references"
        on={params.refHiFi === true}
        onChange={(v) => set('refHiFi', v)}
      />
      <Why summary="The closest likeness — costs render time">
        <p>
          Keeps each reference image at up to 2048px instead of shrinking it to the render size —
          the closest likeness you can get. Costs render time in proportion to how much
          bigger your reference is than the clip: about 7% for a normal gallery image,
          much more for a high-resolution photo.
        </p>
      </Why>
      </>)}
    </div>
  )
}

/**
 * Source-image picker for image-to-video. Uploads the full-res file to ComfyUI's
 * input folder (drives the render), produces a downscaled base64 JPEG for the
 * LLM's vision pass (onB64), and reports the image's pixel size (onDims) so the
 * clip resolution can follow the image's aspect.
 */
export function SourceImageInput({
  value, onChange, onB64, onDims, previewUrl, disabled = false, disabledHint, compact = false,
  hint = "The clip's resolution follows this image — drag & drop supported.",
}: {
  /** The line under an empty slot — Edit's pictures do not set the resolution. */
  hint?: string
  value?: string
  onChange: (filename: string | undefined) => void
  onB64: (b64: string) => void
  onDims: (dims: { w: number; h: number } | null) => void
  previewUrl?: string | null
  /** Blocks new uploads (reference mode uses it to enforce the shared budget). */
  disabled?: boolean
  disabledHint?: string
  /**
   * Half-width variant, for the start/end frame pair that now shares a row.
   * Only the thumbnail and the button copy shrink — the drop target, the
   * picker and the clear button are all still here, because a smaller slot is
   * not a lesser one.
   */
  compact?: boolean
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)

  const { isDragging, dragProps } = useFileDrop((file) => void handleFile(file))
  const { openPicker, pickerDialog } = useImagePicker(inputRef, (file) => void handleFile(file))

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
      setPreview(URL.createObjectURL(file))
      // One awaited decode yields both the vision-pass thumbnail and the source's
      // true pixel size, exactly as `useSendToVideo` does it. The dims drive the
      // clip's aspect ratio, so they must land *before* `inputImage` — and a
      // decode failure has to throw rather than leave the form holding an image
      // with no dims, which silently renders at the orientation default instead.
      const { b64, width, height } = await downscaleToB64AndDims(file)
      onDims({ w: width, h: height })
      onChange(name)
      onB64(b64)
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
      className={`flex items-center rounded-xl border bg-muted/20 transition-colors ${
        compact ? 'gap-2.5 p-2.5' : 'gap-3 p-3'
      } ${isDragging ? 'border-primary ring-2 ring-primary/30' : 'border-border'}`}
    >
      {value && (preview ?? previewUrl) ? (
        // eslint-disable-next-line @next/next/no-img-element -- local object-URL / ComfyUI input preview
        <img src={(preview ?? previewUrl) as string} alt="Source" className={`${compact ? 'h-11 w-11' : 'h-16 w-16'} shrink-0 rounded-lg object-cover ring-1 ring-border`} />
      ) : (
        <div className={`flex ${compact ? 'h-11 w-11' : 'h-16 w-16'} shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground ring-1 ring-border`}>
          <ImageIcon className={compact ? 'h-5 w-5' : 'h-6 w-6'} />
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
        {pickerDialog}
        <button
          type="button"
          onClick={openPicker}
          disabled={uploading || disabled}
          title={disabled ? disabledHint : undefined}
          className={`inline-flex items-center gap-2 rounded-lg border border-border bg-background font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50 ${
            compact ? 'px-2 py-1 text-xs' : 'px-3 py-1.5 text-sm'
          }`}
        >
          {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className={compact ? 'h-3.5 w-3.5' : 'h-4 w-4'} />}
          {value ? (compact ? 'Replace' : 'Replace image') : (compact ? 'Upload' : 'Upload image')}
        </button>
        {value && (
          <button type="button" onClick={clear} className={`inline-flex items-center gap-1 rounded-lg text-muted-foreground hover:text-foreground ${compact ? 'ml-1 px-1.5 py-1 text-xs' : 'ml-2 px-2 py-1.5 text-sm'}`}>
            <X className="h-3.5 w-3.5" /> Clear
          </button>
        )}
        {/* The hint is worth a line at full width and costs a wrap at half, so
            the compact slot drops it — the drop target behaves the same. */}
        {!value && !uploading && !compact && (
          <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
        )}
      </div>
    </div>
  )
}

/**
 * Shown only while the form is set to continue an existing clip.
 *
 * Continuing is a mode the user entered from somewhere else (the gallery, the
 * result inspector), so the form has to say so — otherwise the next Generate
 * silently chains onto a clip they may have stopped thinking about.
 *
 * It stays set after a render on purpose: pressing Generate again re-rolls
 * *this* link rather than extending the chain, which is the regenerate the
 * feature needs. Crucially that re-roll continues from the same clip it always
 * did — never from the take just rejected — so a bad link cannot drag the rest
 * of the chain off course. Extending happens by hitting Continue on the new
 * clip, which is a deliberate second act.
 */
export function ContinuationBanner() {
  const { params, set } = useVideoForm()
  if (!params.continueFrom) return null
  const name = params.continueFrom.split('/').pop() ?? params.continueFrom
  return (
    <div className="rounded-lg border border-primary/40 bg-primary/10 p-3 text-xs">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold text-foreground">Continuing a clip</p>
          <p className="mt-0.5 truncate font-mono text-muted-foreground" title={params.continueFrom}>
            {name}
          </p>
        </div>
        <button
          type="button"
          onClick={() => set('continueFrom', undefined)}
          className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-muted-foreground hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" /> Clear
        </button>
      </div>
      <p className="mt-2 text-muted-foreground">
        The last second of that clip is pinned to the start of this one, then trimmed off, so the
        motion and sound carry across the join. Generate again to re-roll this continuation — it
        always continues from the same clip, never from a take you rejected.
      </p>
    </div>
  )
}
