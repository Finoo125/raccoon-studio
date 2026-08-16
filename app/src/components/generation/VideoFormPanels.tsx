'use client'

import { useRef, useState } from 'react'
import { Shuffle, RotateCcw, Clapperboard, Loader2, Upload, X, ImageIcon, Square, ChevronDown, SlidersHorizontal, Lock } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import LoraSelector from './LoraSelector'
import EnhanceSettings from './EnhanceSettings'
import PromptReview from './PromptReview'
import { downscaleToB64AndDims } from '@/lib/generation/image-b64'
import { uploadImageBlob } from '@/lib/generation/upload'
import { useFileDrop } from '@/lib/generation/useFileDrop'
import { useVideoForm } from './video-form-context'
import { videoWorkflows, isLtxWorkflow, supportsSeedHunt } from '@/lib/workflows/video-index'
import {
  H3_RIFE_FPS,
  H3_REF_BUDGET,
  H3_REF_MAX,
  h3RefCount,
  h3TurboTier,
  compactRefs,
  type H3TurboTier,
} from '@/lib/workflows/minimax-h3'
import { useAddonLock, LTX_DIRECTOR_ADDON } from '@/lib/addons/useAddonLock'
import { PATREON_PAGE } from '@/lib/addons/membership'
import Link from 'next/link'

/** Pixel-budget tiers — dims live in `lib/workflows/ltx23.ts` (they vary by orientation). */
export const RESOLUTION_TIERS = [
  { id: 'high', label: 'Full HD', hint: '~2 MP — full-size render. Slowest setting; wants 24 GB+.' },
  { id: 'medium', label: '900p', hint: '~1.4 MP — a third fewer pixels than Full HD, most of the detail.' },
  { id: 'low', label: '720p', hint: '~0.9 MP — less than half the pixels. Much faster, and keeps 16 GB cards out of shared GPU memory.' },
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
const H3_SPEED_TIERS: { id: false | H3TurboTier; label: string; hint: string; download: string }[] = [
  {
    id: false,
    label: 'Full',
    hint: '20 steps, no distillation — the best this model renders, and the slowest.',
    download: '',
  },
  {
    id: 'draft',
    label: 'Draft',
    hint: 'For testing prompts and finding seeds only — roughly 3× faster, and visibly worse than a Full render (plastic-looking skin, over-sharp grain). Once a prompt and seed look right, switch back to Full and render the real clip.',
    download: 'Adds the 4-step Turbo LoRA (620 MB)',
  },
  {
    id: 'fast',
    label: 'Fast',
    hint: 'lightx2v 8-step distillation — roughly 2× faster than Full and close enough in quality to keep. Start here if Full is too slow; drop to Draft only while you are still hunting for a prompt.',
    download: 'Adds the lightx2v 8-step Turbo LoRA (2 GB)',
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

/** Models the picker offers — Director is a mode, not a choice in that list. */
const MODEL_CHOICES = videoWorkflows.filter((w) => w.id !== 'ltx23-director')

/** T2V / I2V / Director. A page-level mode in Director's layout, a field otherwise. */
export function ModeSwitch({ compact = false }: { compact?: boolean }) {
  const { params, set, workflow, ref2vReady } = useVideoForm()
  const { locked: directorLocked, loaded: addonsLoaded } = useAddonLock(LTX_DIRECTOR_ADDON)
  // Two model-bound modes, mirror images of each other. Director is the LTX
  // timeline graph, so under H3 it would silently render LTX instead; ref2v is
  // H3's reference checkpoint, which LTX has no equivalent of. Each family
  // therefore still offers exactly three modes.
  const modes = (['t2v', 'i2v', 'ref2v', 'director'] as const).filter(
    (m) =>
      (m !== 'director' || isLtxWorkflow(workflow.id)) &&
      (m !== 'ref2v' || !isLtxWorkflow(workflow.id)),
  )
  return (
    <div className="space-y-2">
      {/* Full literal class names: Tailwind scans source text, so a
          `grid-cols-${n}` template would never be generated. */}
      {/* data-tour: rung by the first-run tour's video step — which kind of clip
          you are making is the first choice on this page. */}
      <div data-tour="/generate-videos" className={compact ? 'flex gap-1' : modes.length === 3 ? 'grid grid-cols-3 gap-2' : 'grid grid-cols-2 gap-2'}>
        {modes.map((m) => {
          // Shown-but-locked rather than hidden: someone who cannot see the
          // feature cannot decide they want it. Until entitlements load, treat
          // it as unlocked so the button does not flicker into a locked state
          // on every page load for a supporter who owns it.
          const lockedHere = m === 'director' && addonsLoaded && directorLocked
          // Shown-but-disabled for the same reason Director is: someone who
          // cannot see the feature cannot decide they want the 21 GB download.
          const uninstalled = m === 'ref2v' && !ref2vReady
          const unavailable = lockedHere || uninstalled
          return (
            <Button
              key={m}
              variant={params.mode === m ? 'default' : 'outline'}
              className={`${compact ? 'h-7 px-2.5 text-xs' : 'h-9 text-xs'}${unavailable ? ' opacity-60' : ''}`}
              title={
                lockedHere
                  ? 'Supporter add-on — unlock on the Patreon page'
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
                    : 'Director'}
            </Button>
          )
        })}
      </div>
      {!compact && addonsLoaded && directorLocked && modes.includes('director') && (
        <p className="rounded-lg border border-border bg-muted/30 p-2 text-xs text-muted-foreground">
          <strong>Director</strong> is a supporter add-on — plan a whole scene on a timeline and
          render it as one film. It unlocks with a key from the{' '}
          <a href={PATREON_PAGE} target="_blank" rel="noreferrer" className="underline hover:text-foreground">
            Patreon
          </a>{' '}
          membership; paste the key on the{' '}
          <Link href="/add-ons" className="underline hover:text-foreground">Patreon</Link> page to
          turn it on.
        </p>
      )}
    </div>
  )
}

/**
 * Which model family renders the clip.
 *
 * Hidden in Director mode: that mode is bound to the LTX timeline graph, so a
 * picker there would offer a choice the builder ignores.
 *
 * Switching also applies the target workflow's `defaultParams`, because the
 * families disagree on what a sane render is — LTX defaults to 15 s at 30 fps,
 * which on H3 is 362 frames of a 33B model and reads as a hang. `mode` and the
 * prompt are preserved; everything else is the new family's own default.
 */
export function ModelSwitch() {
  const { params, setParams } = useVideoForm()
  const choices = MODEL_CHOICES
  if (params.mode === 'director' || choices.length < 2) return null
  const active = choices.find((w) => w.id === params.videoModel) ?? choices[0]

  return (
    <div className="space-y-2">
      <SectionLabel>Model</SectionLabel>
      <div className="flex gap-2 flex-wrap">
        {choices.map((w) => (
          <Button
            key={w.id}
            variant={active.id === w.id ? 'default' : 'outline'}
            className="h-9 px-3 text-sm"
            title={w.description}
            onClick={() =>
              setParams((p) => ({ ...p, ...w.defaultParams, videoModel: w.id, mode: p.mode }))
            }
          >
            {w.name}
          </Button>
        ))}
      </div>
      <p className="text-[11px] text-muted-foreground">{active.description}</p>
    </div>
  )
}

/**
 * The creative half: what the clip is about. Shape, source image, the enhancer
 * and the prompt itself.
 */
export function BriefPanel() {
  const {
    workflow, params, set, settings, onSettingChange, models, options,
    collapsed, setCollapsed, seedPreview, setSeedPreview, setImageB64, setEndImageB64, setParams,
    enh, enhanceDisabledReason, handleEnhance, handleRefine,
  } = useVideoForm()

  return (
    <>
      <ModelSwitch />
      {params.mode === 'director' ? (
        <div className="space-y-2">
          <SectionLabel>Shape</SectionLabel>
          <div className="flex gap-2 flex-wrap">
            {workflow.orientations.map((o) => (
              <Button
                key={o.value}
                variant={params.orientation === o.value ? 'default' : 'outline'}
                className="h-8 px-2 text-xs"
                onClick={() => set('orientation', o.value)}
              >
                {o.label}
              </Button>
            ))}
          </div>
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
          <ReferencePanel />
        </>
      ) : params.mode === 't2v' ? (
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
          {/* H3's conditioning node takes an optional last frame as well as a
              first one, so the end slot is offered there and only there — LTX
              has no equivalent input. Which of MiniMax's three frame-anchored
              tasks runs is derived from which slots are filled (`h3Task`), so
              this is two extra abilities without a fourth mode button. */}
          <SectionLabel>{isLtxWorkflow(workflow.id) ? 'Source image' : 'Start frame'}</SectionLabel>
          <SourceImageInput
            value={params.inputImage}
            onChange={(filename) => { set('inputImage', filename); setSeedPreview(null) }}
            onB64={setImageB64}
            onDims={(d) => setParams((p) => ({ ...p, inputImageWidth: d?.w, inputImageHeight: d?.h }))}
            previewUrl={seedPreview}
          />
          {!isLtxWorkflow(workflow.id) && (
            <>
              <SectionLabel>End frame — optional</SectionLabel>
              <SourceImageInput
                value={params.endImage}
                onChange={(filename) => set('endImage', filename)}
                onB64={setEndImageB64}
                onDims={(d) => setParams((p) => ({ ...p, endImageWidth: d?.w, endImageHeight: d?.h }))}
              />
              <p className="text-[11px] text-muted-foreground">
                {params.endImage && params.inputImage
                  ? 'The clip travels from the start frame to the end frame as one continuous shot.'
                  : params.endImage
                    ? 'With no start frame the clip is built backwards — it opens somewhere plausible and lands on this image.'
                    : 'Add one to say where the clip must finish. Leave it empty to just animate forward.'}
              </p>
            </>
          )}
        </div>
      )}

      <GroupHeader>Prompt</GroupHeader>

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

      <PromptReview
        status={enh.status}
        isStreaming={enh.isStreaming}
        error={enh.error}
        prompt={params.prompt}
        onPromptChange={(v) => set('prompt', v)}
        onRefine={handleRefine}
        onStop={enh.stop}
        {...(params.mode === 'director'
          ? {
              label: 'Global prompt',
              placeholder:
                'Describes the whole clip — anchor the characters, setting and look here. Per-shot detail goes on the timeline.',
            }
          : {})}
      />
    </>
  )
}

/**
 * The technical half: how the clip renders. Resolution, duration, stabilised
 * motion, Advanced and the seed hunt.
 */
export function RenderPanel() {
  const { params, set, motionReady, advancedOpen, setAdvancedOpen, huntCount, setHuntCount, workflow, turboReady } = useVideoForm()
  // Stabilised motion and the seed hunt are LTX-graph features; see isLtxWorkflow.
  const isLtx = isLtxWorkflow(workflow.id)

  return (
    <>
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
          aria-label="Duration"
          onChange={(e) => set('durationSeconds', Number(e.target.value))}
          className="w-full accent-primary"
        />
        <p className="text-xs text-muted-foreground">Longer clips take proportionally longer to render.</p>
      </div>

      {/* Stabilised motion — deliberately outside Advanced: it is on by default, so
          it has to be visible enough that someone can find it and turn it off. A
          plain LoRA row, hence offered in both modes. */}
      {isLtx && (
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
      )}

      {/* Speed (H3 only) — which distillation LoRA renders the clip, or none.
          Named for the axis rather than the weights: the two tiers differ in
          what the output is FOR, not in a number anyone tunes. Off by default,
          and a tier whose LoRA is not on disk stays visible but disabled —
          someone who cannot see the option cannot decide they want it. */}
      {!isLtx && (
        <div className="space-y-2">
          <SectionLabel>Speed</SectionLabel>
          <div className="grid grid-cols-3 gap-2">
            {H3_SPEED_TIERS.map((t) => {
              const ready = t.id === false || turboReady[t.id]
              return (
                <Button
                  key={String(t.id)}
                  variant={(h3TurboTier(params.turbo) ?? false) === t.id ? 'default' : 'outline'}
                  className={`h-9 text-sm${ready ? '' : ' opacity-60'}`}
                  title={ready ? undefined : `${t.download} — install it on the Models page`}
                  onClick={() => { if (ready) set('turbo', t.id) }}
                >
                  {t.label}
                </Button>
              )
            })}
          </div>
          <p className="text-xs text-muted-foreground">
            {(() => {
              const tier = h3TurboTier(params.turbo) ?? false
              const t = H3_SPEED_TIERS.find((x) => x.id === tier)!
              return tier !== false && !turboReady[tier as H3TurboTier]
                ? `Not installed. ${t.download} — add it on the Models page to enable this.`
                : t.hint
            })()}
          </p>
        </div>
      )}

      {/* Advanced — LoRAs + Seed + RIFE, collapsed by default to keep the panel calm. */}
      <div className="rounded-xl border border-border bg-muted/20">
        <button
          type="button"
          onClick={() => setAdvancedOpen(!advancedOpen)}
          aria-expanded={advancedOpen}
          className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm font-semibold hover:bg-muted/40 rounded-xl"
        >
          <SlidersHorizontal className="h-4 w-4 shrink-0 text-primary" />
          <span className="flex-1">Advanced</span>
          <span className="text-xs font-normal text-muted-foreground">{isLtx ? 'LoRAs · Seed · Interpolation' : 'Seed'}</span>
          <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${advancedOpen ? 'rotate-180' : ''}`} />
        </button>
        {advancedOpen && <AdvancedBody />}
      </div>

      {/* Seed hunt — render N cheap half-res candidates that differ only by seed,
          then upscale just the one that gets picked. Lives beside the Generate
          button rather than in Advanced because it changes what Generate does.
          Each graph makes the candidate cheap its own way — LTX truncates after
          its half-res first pass, H3 forces Draft mode — hence the allowlist. */}
      {supportsSeedHunt(workflow.id) && (
      <div className="space-y-2">
        <SectionLabel>Seed hunt</SectionLabel>
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
        {/* Measured 2026-08-01 (5 s t2v, low tier, warm models, RTX 5090): a
            candidate is 60 s against 93 s for the full render, so the first pass
            is ~0.65 of a clip — it carries the text encode, preprocess and both
            decodes, and only the 3-step upscale sits on the other side. The share
            drops at higher tiers, where the 2MP upscale pass gets much heavier,
            so this reads high rather than low. Plus 1 for re-rendering the
            winner's first pass; see the plan's deferred latent handoff. */}
        <p className="text-xs text-muted-foreground">
          {huntCount === 0
            ? 'Render one clip straight through.'
            : isLtx
              ? `${huntCount} half-res candidates first, then upscale the one you pick — roughly ${(huntCount * 0.65 + 1).toFixed(1)}× one render.`
              : `${huntCount} quick drafts that differ only by seed, then the one you pick is re-rendered at full quality — roughly ${(huntCount * 0.42 + 1).toFixed(1)}× one render.`}
        </p>
        {/* The candidate/final quality gap is H3-specific and surprising enough
            that it has to be said outright: people will otherwise read a draft
            as the finished look and reject a perfectly good seed. */}
        {!isLtx && huntCount > 0 && (
          <p className="rounded-lg border border-border bg-muted/30 p-2 text-xs text-muted-foreground">
            Candidates always render distilled — at <strong>Draft</strong> speed, or at{' '}
            <strong>Fast</strong> if that is what you picked above — so they will look rougher than
            the final clip. Judge the <em>composition and motion</em>, not the detail. The seed you
            pick is then rendered again at the speed set above.
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

function AdvancedBody() {
  const { params, set, setParams, faceIdReady, realismReady, lastJobSeed, workflow } = useVideoForm()
  // FaceID is LTX-only; the LoRA stack, Seed and RIFE now exist on both graphs.
  const isLtx = isLtxWorkflow(workflow.id)
  const rifeOn = isLtx ? params.rife !== false : params.rife === true

  return (
    <div className="space-y-4 border-t border-border/60 p-3">
      {/* LoRAs — up to 4 stack slots on top of the built-in distillation LoRA
          (LTX) or the Turbo LoRA (H3). Always start at None; selections are
          per-session only. */}
      <div className="space-y-2">
        <SectionLabel>LoRAs</SectionLabel>
        <div className="space-y-1.5">
          {([1, 2, 3, 4] as const).map((i) => (
            <LoraSelector
              key={i}
              label={`LoRA ${i}`}
              // ponytail: no 'h3' LoRA family yet, so H3 lists every installed
              // LoRA and a wrong pick fails at ComfyUI validation rather than
              // being hidden. Adding one means teaching lora-arch.ts H3's key
              // signature — do that once an H3 LoRA is on disk to read.
              family={isLtx ? 'ltx' : undefined}
              value={params[`lora${i}`] ?? ''}
              strength={params[`lora${i}Strength`] ?? 1}
              onChange={(lora, strength) =>
                setParams((p) => ({ ...p, [`lora${i}`]: lora, [`lora${i}Strength`]: strength }))
              }
            />
          ))}
        </div>
      </div>

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
      {isLtx && params.mode === 'i2v' && (
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
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => set('faceIdStrength', Number(e.target.value))}
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

      {/* Realistic skin (H3 only) — fal's realism adapter. Sits directly above
          film grain on purpose: grain *masks* smooth skin, this repairs it, and
          seeing them together is what tells you which one you actually want. */}
      {!isLtx && (
        <div className={`space-y-2 ${realismReady ? '' : 'opacity-60'}`}>
          <SectionLabel>Realistic skin</SectionLabel>
          <label className={`flex items-center gap-2 text-sm ${realismReady ? '' : 'cursor-not-allowed'}`}>
            <input
              type="checkbox"
              checked={params.realismLora === true}
              disabled={!realismReady}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => set('realismLora', e.target.checked)}
              className="h-4 w-4 accent-primary disabled:cursor-not-allowed"
            />
            <span className="font-medium">Use the realism adapter</span>
          </label>
          <p className="text-xs text-muted-foreground">
            {realismReady
              ? 'Restores pores, fine lines and stubble that the model otherwise renders away, so faces hold up in close-up. Best on people; it does nothing for a shot with nobody in it. Works alongside Draft and Fast.'
              : 'Needs the 125 MB realism adapter — install it on the Models page.'}
          </p>
        </div>
      )}

      {/* Film grain (H3 only for now) — the same RES4LYF node and 0.04 intensity
          the Krea2 / Z-Image paths use, so clips read like the stills do. */}
      {!isLtx && (
        <div className="space-y-2">
          <SectionLabel>Film grain</SectionLabel>
          <Button
            variant={params.filmGrain !== false ? 'default' : 'outline'}
            className="h-9 w-full text-sm"
            onClick={() => set('filmGrain', params.filmGrain === false)}
          >
            {params.filmGrain !== false ? 'Grain on — softer, film-like' : 'Grain off — model output as-is'}
          </Button>
          <p className="text-xs text-muted-foreground">
            On by default, and a different job from Realistic skin above: grain lays texture
            over the whole frame, the adapter rebuilds the skin itself. Costs roughly
            125&nbsp;ms per frame (~35&nbsp;s on a 10&nbsp;s clip). Neither will fix
            over-sharpening — for that, lower Draft mode&rsquo;s strength.
          </p>
        </div>
      )}

      {/* Frame interpolation. LTX bakes RIFE into its graph and splices it out
          when off; H3's graph is core-only and splices it in when on — so the
          same param defaults opposite ways and the toggle has to read it per
          model rather than by bare truthiness. */}
      <div className="space-y-2">
        <SectionLabel>Frame interpolation</SectionLabel>
        <Button
          variant={rifeOn ? 'default' : 'outline'}
          className="h-9 w-full text-sm"
          onClick={() => set('rife', !rifeOn)}
        >
          {rifeOn
            ? `RIFE on — smooth ${isLtx ? 60 : H3_RIFE_FPS}fps output`
            : 'RIFE off — native fps output'}
        </Button>
        {!isLtx && (
          <p className="text-xs text-muted-foreground">
            Doubles H3&rsquo;s fixed 24 fps to {H3_RIFE_FPS}. The generated audio track is
            untouched and stays in sync.
          </p>
        )}
      </div>
    </div>
  )
}

/** Generate, flipping to Cancel while a render is queued or running. */
export function GenerateButton({ compact = false }: { compact?: boolean }) {
  const { hasActiveJob, isGenerating, params, handleGenerate, handleCancel } = useVideoForm()
  const size = compact ? 'h-8 px-4 text-sm font-semibold' : 'w-full h-11 text-base font-bold'

  if (hasActiveJob) {
    return (
      <Button variant="destructive" className={`${size} shadow-lg`} onClick={handleCancel}>
        <Square className={`${compact ? 'h-3.5 w-3.5' : 'h-4 w-4'} mr-2 fill-current`} /> Cancel
      </Button>
    )
  }
  return (
    <Button
      className={`${size} shadow-lg shadow-primary/25 transition-shadow hover:shadow-primary/40`}
      onClick={handleGenerate}
      disabled={isGenerating || !params.prompt.trim()}
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
function ReferencePanel() {
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
    key: 'refImages' | 'refVideos' | 'refAudios',
    i: number,
    filename: string | undefined,
  ) =>
    setParams((p) => {
      const next = [...(p[key] ?? [])]
      next[i] = filename
      return { ...p, [key]: next }
    })

  /** `<Tag N>` for a filled slot, counted the way the node counts it. */
  const tag = (list: (string | undefined)[], i: number, kind: string) =>
    list[i] ? `<${kind} ${compactRefs(list.slice(0, i + 1)).length}>` : null

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
          <p className="font-mono text-[11px] text-muted-foreground">
            {tag(images, i, 'Picture') ?? `Image slot ${i + 1} — empty`}
          </p>
          <SourceImageInput
            value={images[i]}
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

      <p className="text-[11px] text-muted-foreground">
        Tag them in the prompt — <span className="font-mono">&lt;Picture 1&gt;</span>,{' '}
        <span className="font-mono">&lt;Video 1&gt;</span>,{' '}
        <span className="font-mono">&lt;Audio 1&gt;</span>. Give each one a single job: a
        character, a location, a style, a movement. More references do not make a better clip.
      </p>

      <label className="flex items-center gap-2 pt-1 text-sm">
        <input
          type="checkbox"
          checked={params.refHiFi === true}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => set('refHiFi', e.target.checked)}
          className="h-4 w-4 accent-primary"
        />
        <span className="font-medium">High-fidelity references</span>
      </label>
      <p className="text-[11px] text-muted-foreground">
        Keeps each reference image at up to 2048px instead of shrinking it to the render size —
        the closest likeness you can get. Costs render time in proportion to how much
        bigger your reference is than the clip: about 7% for a normal gallery image,
        much more for a high-resolution photo.
      </p>
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
  value, onChange, onB64, onDims, previewUrl, disabled = false, disabledHint,
}: {
  value?: string
  onChange: (filename: string | undefined) => void
  onB64: (b64: string) => void
  onDims: (dims: { w: number; h: number } | null) => void
  previewUrl?: string | null
  /** Blocks new uploads (reference mode uses it to enforce the shared budget). */
  disabled?: boolean
  disabledHint?: string
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
          disabled={uploading || disabled}
          title={disabled ? disabledHint : undefined}
          className="inline-flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-1.5 text-sm font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
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
