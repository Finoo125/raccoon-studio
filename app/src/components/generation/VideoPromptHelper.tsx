'use client'

import { useEffect, useRef, useState } from 'react'
import { Dices, Loader2, RefreshCw, Undo2, Wand2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { InfoTip, Knob } from './SwitchTile'
import PromptPicks from './PromptPicks'
import PromptReview from './PromptReview'
import VideoPresetRows from './VideoPresetRows'
import VideoEditHelper from './VideoEditHelperBar'
import AiWriterCard from './AiWriterCard'
import AiWriterSetup from './AiWriterSetup'
import { PromptHelperButton } from './PromptHelper'
import HelperShell, { HelperLocked } from './helper/HelperShell'
import { useNsfwSwitch, useWriters } from './helper/useWriters'
import { useDraftHistory } from './helper/useDraftHistory'
import { useVideoForm } from './video-form-context'
import { useCinematicEnhance, type EnhanceArgs } from '@/lib/comfyui/useCinematicEnhance'
import { writeBlockReason } from '@/lib/comfyui/enhance-args'
import { cardKind } from '@/lib/ai-writers/view'
import { parseWriterId } from '@/lib/ai-writers/writer-id'
import { PICK_ROWS, dropBlocked, rerollRow, togglePick, type PickRowId } from '@/lib/prompt-builder/picks'
import { fitWho, migrateWriterId, surpriseVideo, visibleVideoRows } from '@/lib/prompt-builder/video-picks'
import { isLtxWorkflow } from '@/lib/workflows/video-index'
import { inputViewUrl } from '@/lib/generation/upload'

/** What one write or Make it better sent — kept so Try again can repeat it exactly. */
type WriteRequest = { args: EnhanceArgs; refine?: { instruction: string; prior: string } }

/** The ✨ button in Generate Video's Prompt group: the Prompt Helper's, with Director owners counted in. */
export function VideoPromptHelperButton({ onOpen }: { onOpen: () => void }) {
  const { helperLock } = useVideoForm()
  return <PromptHelperButton onOpen={onOpen} lock={helperLock} />
}

/**
 * Generate Video's Prompt Helper: the image helper's frame with the video
 * writer behind it — the same `/rvn/generate_stream` script as the old Enhance
 * box. It works on a copy of the settings, the prompt and One continuous shot;
 * nothing reaches the form until "Use this script". Mounted only while open,
 * so every opening starts from the form, and closing stops a running write.
 * Edit writes a one-line instruction instead (`VideoEditHelper`).
 */
export default function VideoPromptHelperDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { renderParams } = useVideoForm()
  if (!open) return null
  return renderParams.mode === 'edit' ? <VideoEditHelper onClose={onClose} /> : <HelperDialog onClose={onClose} />
}

function HelperDialog({ onClose }: { onClose: () => void }) {
  const {
    workflow, params, renderParams: p, simple, settings, options, seedPreview, helperLock, applySettings, enhanceArgsFor, set,
  } = useVideoForm()
  const { locked, loaded } = helperLock
  // A form saved with an animal Who and an 18+ card opens without the card (its row hides it, the write must not send it).
  const [initial] = useState(() => ({ settings: fitWho(settings, options), prompt: params.prompt, singleShot: params.singleShot === true }))
  const [copy, setCopy] = useState(initial.settings)
  const [singleShot, setSingleShot] = useState(initial.singleShot)
  const { draft, latest, change, typeInto, undo, canUndo } = useDraftHistory(params.prompt)
  const [keep, setKeep] = useState<ReadonlySet<string>>(new Set())
  const [versions, setVersions] = useState<string[]>([])
  const [lastRun, setLastRun] = useState<WriteRequest | null>(null)
  const [preparing, setPreparing] = useState(false)
  const [chosen, setChosen] = useState(() => migrateWriterId(settings.model))
  const { scan, rescan, options: writers, picked, engine, starting, start, setupOpen, setSetupOpen } =
    useWriters({ chosen, excludeBuiltin: true, enabled: loaded && !locked, minTier: 'm' })
  const [nsfw, setNsfw] = useNsfwSwitch()
  const [vision, setVision] = useState<string[] | null>(null)
  // The dialog's own stream: the form's prompt never sees it until Use.
  const { enhance, refine, stop, status, error, isStreaming, promptText } = useCinematicEnhance()

  // Closing stops a write; a write still preparing its pictures never starts.
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => { alive.current = false; stop() }
  }, [stop])

  useEffect(() => { if (error) toast.error(error) }, [error])

  // A finished write lands once: as the script and as a version.
  const pending = useRef<{ wasOff: boolean } | null>(null)
  useEffect(() => {
    if (isStreaming || !pending.current) return
    const { wasOff } = pending.current
    pending.current = null
    // The write started a switched-off app; show it running now.
    if (wasOff) void rescan()
    const text = promptText.trim()
    if (!text || error) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the stream has no completion callback
    setVersions((v) => [...v, text].slice(-3))
    change(text)
  }, [isStreaming, promptText, error, rescan, change])

  const isLtx = isLtxWorkflow(workflow.id)
  const scene = p.mode === 't2v' && !p.continueFrom
  const rows = visibleVideoRows({ scene, ltx: isLtx, simple })
  const sceneRows = PICK_ROWS.filter((r) => rows.scene.includes(r.id))
  // H3's writer only; Simple renders without it (simpleVideoValues).
  const showShot = !isLtx && !simple && p.mode !== 'edit'
  // The modes the writer has to see a picture in (the node refuses to write them blind).
  const seesPictures = p.mode === 'i2v' || p.mode === 'director' || !!p.continueFrom
    || (p.mode === 'ref2v' && Object.values(p.keyframes ?? {}).some((k) => k?.image))
  const ollamaUp = scan?.ollama.state === 'running'
  const pickedId = picked?.id

  // Again after every scan and pick: a model pulled since (the setup's qwen3.5) must not read as blind.
  useEffect(() => {
    if (!seesPictures || !ollamaUp) return
    let live = true
    fetch('/api/video/vision-models', { cache: 'no-store' })
      .then((r) => r.json())
      .then((j: { models?: string[] }) => { if (live) setVision(j.models ?? []) })
      .catch(() => {})
    return () => { live = false }
  }, [seesPictures, ollamaUp, scan, pickedId])

  if (loaded && locked) return <HelperLocked onClose={onClose} />

  const busy = isStreaming || preparing
  const withWriter = { ...copy, model: engine }
  const scanReason = !scan ? 'Looking for AI writers…'
    : !scan.comfyui ? 'ComfyUI is not running. Start it from the top bar first.' : null
  const reason = scanReason ?? writeBlockReason(p, withWriter)
  // Make it better and Try again need everything a write does but the idea; when they are blocked, `reason` says the same.
  const againReason = scanReason ?? writeBlockReason(p, withWriter, { idea: false })
  const ref = picked ? parseWriterId(picked.id) : null
  const blind = seesPictures && ollamaUp && vision !== null && ref?.kind === 'ollama' && !vision.includes(ref.model)
  const pictures: { label: string; src: string }[] = p.continueFrom ? []
    : p.mode === 'i2v' ? [
        ...(p.inputImage ? [{ label: 'Start frame', src: seedPreview ?? inputViewUrl(p.inputImage) }] : []),
        ...(!isLtx && p.endImage ? [{ label: 'End frame', src: inputViewUrl(p.endImage) }] : []),
      ]
      : p.mode === 'ref2v' && p.refImages?.[0] ? [{ label: 'Reference 1', src: inputViewUrl(p.refImages[0]) }]
        : []

  const send = (req: WriteRequest) => {
    setLastRun(req)
    pending.current = { wasOff: !!picked?.off }
    if (req.refine) refine(req.args, req.refine.instruction, req.refine.prior)
    else enhance(req.args)
  }
  /** A fresh write (or Make it better) from the dialog's choices; the pictures are read at the press. */
  const write = async (refineWith?: WriteRequest['refine']) => {
    setPreparing(true)
    try {
      const args = await enhanceArgsFor(withWriter, showShot ? { singleShot } : undefined)
      if (alive.current) send({ args, refine: refineWith })
    } catch (e) {
      // Closed while the pictures were read: say nothing.
      if (alive.current) toast.error(e instanceof Error ? e.message : 'The pictures could not be read')
    } finally {
      if (alive.current) setPreparing(false)
    }
  }
  // Every idea change (typing, a Who card, its 🎲): an animal Who drops an 18+ scenario or place.
  const setIdea = (userIntent: string) => setCopy(fitWho({ ...copy, userIntent }, options))
  const toggleKeep = (id: string) => setKeep((k) => {
    const next = new Set(k)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })
  // POV stays: a re-roll could only ever turn it on.
  const surpriseAll = () => setCopy(surpriseVideo(copy, { rows: rows.presets.filter((r) => r !== 'pov'), keep, nsfw, options, scene }))

  return (
    <>
      <HelperShell title="✨ Help me write"
        chip={<>{workflow.name} writes a timed shot script</>}
        nsfw={{ on: nsfw, toggle: () => setNsfw(!nsfw) }}
        steps={['Pick pictures, or say in your own words what should happen', 'Write it for me writes the script',
          'Change anything, then Use this script']}
        bar={<>
          <div className="min-w-0 space-y-2">
            <label htmlFor="video-helper-idea" className="text-sm font-semibold">What should happen?</label>
            <div className="flex gap-2">
              <Textarea id="video-helper-idea" value={copy.userIntent} onChange={(e) => setIdea(e.target.value)}
                className="h-16 min-h-0 flex-1 resize-none text-sm" placeholder="e.g. she walks into the kitchen, stops and smiles at the camera"
                onKeyDown={(e) => {
                  if (e.key !== 'Enter' || e.shiftKey) return
                  e.preventDefault()
                  if (!reason && !busy) void write()
                }} />
              {pictures.map((pic) => (
                <figure key={pic.label} className="w-14 shrink-0" title={`The writer looks at this picture (${pic.label.toLowerCase()})`}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- a ComfyUI input picture */}
                  <img src={pic.src} alt={pic.label} className="h-12 w-14 rounded-md object-cover" />
                  <figcaption className="truncate text-center text-[10px] text-muted-foreground">{pic.label}</figcaption>
                </figure>
              ))}
              <Button type="button" className="h-16 shrink-0" disabled={!!reason || busy} title={reason ?? undefined}
                onClick={() => void write()}>
                {busy ? <Loader2 className="animate-spin" /> : <Wand2 />} Write it for me
              </Button>
            </div>
            {reason && <p className="text-[11px] text-muted-foreground" data-write-reason>{reason}</p>}
            <PromptReview label="Your script" status={status} isStreaming={isStreaming} error={error} onStop={stop}
              prompt={isStreaming ? promptText : draft} onPromptChange={typeInto} refineLabel="Make it better"
              placeholder="Write it for me puts your script here. You can also type or paste one." refineBlock={againReason}
              onRefine={(instruction) => void write({ instruction, prior: latest.current })} />
          </div>

          <div className="flex min-w-0 flex-col gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">Versions</span>
              {versions.map((v, i) => (
                <Button key={i} type="button" size="xs" variant={draft === v ? 'default' : 'outline'} aria-pressed={draft === v}
                  title={v.slice(0, 300)} onClick={() => change(v)}>
                  Version {i + 1}
                </Button>
              ))}
              {lastRun && (
                <Button type="button" size="xs" variant="ghost" disabled={busy || !!againReason} title={againReason ?? undefined}
                  onClick={() => send(lastRun)}>
                  <RefreshCw /> Try again
                </Button>
              )}
              <Button type="button" size="xs" variant="ghost" className="ml-auto" disabled={!canUndo || busy} onClick={undo}>
                <Undo2 /> Undo
              </Button>
            </div>
            <p className="min-h-4 text-[11px] text-muted-foreground">
              {versions.length ? 'Click a version to go back to it — or keep editing.' : 'Every write is kept as a version; the last three stay here.'}
            </p>
            {showShot && (
              <div className="space-y-1">
                <button type="button" role="switch" aria-checked={singleShot} aria-label="One continuous shot"
                  onClick={() => setSingleShot(!singleShot)}
                  className={`flex w-full items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left text-xs font-medium transition-colors ${
                    singleShot ? 'border-primary/40 bg-primary/10' : 'border-border bg-muted/30 hover:bg-muted/50'}`}>
                  <Knob on={singleShot} /> One continuous shot
                </button>
                <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                  <span className="min-w-0">Cuts are what make a face drift — not length</span>
                  <InfoTip label="Why one continuous shot">
                    <p>
                      Stops the writer cutting between camera angles. Measured on a 12s clip:
                      a face stays 0.85 recognisable through the first shot, 0.63 after the
                      first cut and 0.37 after the second — so the cuts, not the length, are
                      what make a character drift. Turn it on for anything built around one
                      person; leave it off when you want the clip edited.
                    </p>
                  </InfoTip>
                </div>
              </div>
            )}
            <AiWriterCard kind={cardKind(scan, picked, { starting, writing: busy })} options={writers} picked={picked}
              rendering={false} offerBuiltin={false} writingLabel="Writing your script…"
              onPick={setChosen} onSetup={() => setSetupOpen(true)} onStart={(app) => void start(app)}
              scan={scan} onRescan={rescan} />
            {blind && (
              <p className="text-[11px] text-amber-400" data-writer-blind>
                This model can’t see pictures — pick one that can, like qwen3.5.
              </p>
            )}
          </div>
        </>}
        rows={<>
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <Button type="button" onClick={surpriseAll}><Dices /> Surprise me</Button>
            <p className="text-xs text-muted-foreground">
              Click a picture to pick it. Click it again to take it back.
              {scene && ' Who, Hair and Clothes add their words to your idea.'}
            </p>
          </div>
          <div className="space-y-5">
            <PromptPicks rows={sceneRows} draft={copy.userIntent} style="sentences" keep={keep as ReadonlySet<PickRowId>} nsfw={nsfw}
              onPick={(row, pick) => {
                const next = togglePick(copy.userIntent, row, pick, 'sentences')
                // A new Who drops what it cannot do (a dress on a cat).
                setIdea(row.id === 'who' ? dropBlocked(next, 'sentences') : next)
              }}
              onReroll={(row) => setIdea(rerollRow(copy.userIntent, row, 'sentences', { nsfw }))}
              onToggleKeep={toggleKeep} />
            <VideoPresetRows rows={rows.presets} settings={copy} options={options} nsfw={nsfw} keep={keep}
              onChange={setCopy} onToggleKeep={toggleKeep} />
          </div>
        </>}
        useLabel="Use this script" useDisabled={busy}
        onUse={() => {
          // The writer that is PICKED (it may be a fallback), never a stale saved id.
          applySettings({ ...copy, model: scan ? engine : settings.model })
          set('prompt', latest.current)
          if (singleShot !== initial.singleShot) set('singleShot', singleShot)
        }}
        dirty={draft !== initial.prompt || singleShot !== initial.singleShot || JSON.stringify(copy) !== JSON.stringify(initial.settings)}
        discardText="Your script and choices in the Generate panel stay as they were."
        onClose={onClose} />
      <AiWriterSetup open={setupOpen} onClose={() => setSetupOpen(false)} scan={scan} onRescan={rescan}
        offerBuiltin={false} minTier="m" testWorkflowId="krea2-turbo" chosen={engine} onUse={setChosen} onStart={start} starting={starting} />
    </>
  )
}
