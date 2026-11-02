'use client'

import { useEffect, useRef, useState } from 'react'
import { Loader2, Undo2, Wand2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import PromptPicks from './PromptPicks'
import AiWriterCard from './AiWriterCard'
import AiWriterSetup from './AiWriterSetup'
import HelperShell, { HelperLocked } from './helper/HelperShell'
import { useNsfwSwitch, useWriters } from './helper/useWriters'
import { useDraftHistory } from './helper/useDraftHistory'
import { useVideoForm } from './video-form-context'
import { midFrameB64 } from './director/lane-media'
import { cardKind } from '@/lib/ai-writers/view'
import { editRows } from '@/lib/prompt-builder/edit-writer'
import { rerollRow, togglePick } from '@/lib/prompt-builder/picks'
import { migrateWriterId } from '@/lib/prompt-builder/video-picks'
import { editSourceUrl } from '@/lib/video/edit-source'
import { h3EditKind, type H3EditKind } from '@/lib/workflows/minimax-h3'

const KIND: Record<H3EditKind, { label: string; wish: string; draft: string }> = {
  vfx: {
    label: 'Change something',
    wish: 'e.g. make her jacket red leather',
    draft: 'Change her jacket into red leather; keep her face, pose, motion and the café.',
  },
  style: {
    label: 'Restyle',
    wish: 'e.g. a hand-drawn anime look',
    draft: 'Transform this video into a hand-drawn anime style with clean ink lines.',
  },
  head: {
    label: 'Swap head',
    wish: 'e.g. a woman in her fifties with short silver hair',
    draft: 'woman, fifties, oval face, blue-grey eyes, short silver pixie cut',
  },
}

/**
 * Help me write in Edit mode: a frame from the middle of the clip, the kind of
 * edit the form has picked (read-only), and a writer that turns a rough wish into
 * three versions of the instruction. Picture cards write their clause straight
 * into it. Nothing reaches the form until "Use this instruction"; the builder
 * adds the edit LoRA's trigger word itself, so this never does.
 */
export default function VideoEditHelper({ onClose }: { onClose: () => void }) {
  const { params, renderParams: p, settings, helperLock, set, onSettingChange } = useVideoForm()
  const { locked, loaded } = helperLock
  const kind = h3EditKind(p)
  const [initial] = useState(params.prompt)
  const { draft, latest, change, typeInto, undo, canUndo } = useDraftHistory(params.prompt)
  const [wish, setWish] = useState('')
  const [versions, setVersions] = useState<string[]>([])
  const [sees, setSees] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const [chosen, setChosen] = useState(() => migrateWriterId(settings.model))
  const { scan, rescan, options: writers, picked, engine, starting, start, setupOpen, setSetupOpen } =
    useWriters({ chosen, excludeBuiltin: true, enabled: loaded && !locked, minTier: 'm' })
  const [nsfw, setNsfw] = useNsfwSwitch()

  // The middle frame: shown here, and what the writer names in its "keep …" clause.
  const clipUrl = (() => {
    try { return p.editSource ? editSourceUrl(p.editSource) : null } catch { return null }
  })()
  // undefined = still reading the clip.
  const [frame, setFrame] = useState<string | null | undefined>(clipUrl ? undefined : null)
  useEffect(() => {
    if (!clipUrl) return
    let live = true
    void midFrameB64(clipUrl).then((f) => { if (live) setFrame(f) })
    return () => { live = false }
  }, [clipUrl])

  // Closing drops a write still running: nothing lands, no late error toast.
  const abort = useRef<AbortController | null>(null)
  useEffect(() => () => abort.current?.abort(), [])

  if (loaded && locked) return <HelperLocked onClose={onClose} />

  // Only "Change something" names what it sees; a restyle or a new face must not describe the clip.
  const showsFrame = kind === 'vfx'
  const reason = !scan ? 'Looking for AI writers…'
    : !engine ? 'Pick a writer first.'
      : showsFrame && frame === undefined ? 'Looking at your clip…'
        : !wish.trim() && !draft.trim() ? 'Say what should change first.' : null

  const write = async () => {
    const wasOff = picked?.off
    const ctrl = new AbortController()
    abort.current = ctrl
    setBusy(true)
    try {
      const res = await fetch('/api/prompt-builder/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // An empty wish with picked cards: polish what the cards wrote (the writer adds the keep clause).
        body: JSON.stringify({
          task: 'edit', editKind: kind, idea: wish.trim() || latest.current, prompt: latest.current,
          frameB64: showsFrame ? frame ?? undefined : undefined, engine, count: 3,
        }),
        signal: ctrl.signal,
      })
      const j = (await res.json().catch(() => ({}))) as { prompts?: string[]; sees?: boolean; error?: string }
      // Closed while the answer was read: the json above swallowed the abort, so nothing below may run.
      if (ctrl.signal.aborted) return
      if (!res.ok || !j.prompts?.length) { toast.error(j.error ?? 'The writer did not answer — try again'); return }
      setVersions(j.prompts)
      setSees(j.sees === true)
      change(j.prompts[0])
    } catch (e) {
      if (!ctrl.signal.aborted) toast.error(e instanceof Error ? e.message : 'Request failed')
    } finally {
      if (!ctrl.signal.aborted) {
        setBusy(false)
        // The write started a switched-off app; show it running now.
        if (wasOff) void rescan()
      }
    }
  }

  return (
    <>
      <HelperShell title="✨ Help me write"
        chip={<>Edit writes one instruction for your clip</>}
        nsfw={{ on: nsfw, toggle: () => setNsfw(!nsfw) }}
        steps={['Pick pictures, or say in your own words what should change', 'Write it for me gives you 3 versions',
          'Choose one, change anything, then Use this instruction']}
        bar={<>
          <div className="min-w-0 space-y-2">
            <div className="flex items-center gap-2">
              <label htmlFor="edit-helper-wish" className="text-sm font-semibold">What should change?</label>
              <span data-edit-kind title="The kind of edit is picked in the Generate panel"
                className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
                {KIND[kind].label}
              </span>
            </div>
            <div className="flex gap-2">
              <figure className="w-24 shrink-0" title={showsFrame ? 'The writer looks at this frame of your clip' : 'Your clip'}>
                {frame ? (
                  // eslint-disable-next-line @next/next/no-img-element -- a frame lifted from the clip
                  <img src={`data:image/jpeg;base64,${frame}`} alt="The middle of your clip" data-edit-frame
                    className="h-16 w-24 rounded-md bg-muted object-contain" />
                ) : (
                  <div className="grid h-16 w-24 place-items-center rounded-md bg-muted text-[10px] text-muted-foreground">
                    {frame === undefined ? <Loader2 className="h-4 w-4 animate-spin" /> : 'No clip yet'}
                  </div>
                )}
                <figcaption className="truncate text-center text-[10px] text-muted-foreground">Your clip</figcaption>
              </figure>
              <Textarea id="edit-helper-wish" value={wish} onChange={(e) => setWish(e.target.value)}
                className="h-16 min-h-0 flex-1 resize-none text-sm" placeholder={KIND[kind].wish}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter' || e.shiftKey) return
                  e.preventDefault()
                  if (!reason && !busy) void write()
                }} />
              <Button type="button" className="h-16 shrink-0" disabled={!!reason || busy} title={reason ?? undefined}
                onClick={() => void write()}>
                {busy ? <Loader2 className="animate-spin" /> : <Wand2 />} Write it for me
              </Button>
            </div>
            {reason && <p className="text-[11px] text-muted-foreground" data-write-reason>{reason}</p>}
            <label htmlFor="edit-helper-draft" className="block text-sm font-semibold">Your instruction</label>
            <Textarea id="edit-helper-draft" value={draft} onChange={(e) => typeInto(e.target.value)}
              className="h-24 resize-none text-sm leading-relaxed" placeholder={KIND[kind].draft} />
          </div>

          <div className="flex min-w-0 flex-col gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">Versions</span>
              {versions.map((v, i) => (
                <Button key={v} type="button" size="xs" variant={draft === v ? 'default' : 'outline'} aria-pressed={draft === v}
                  title={v} onClick={() => change(v)}>
                  Version {i + 1}
                </Button>
              ))}
              <Button type="button" size="xs" variant="ghost" className="ml-auto" disabled={!canUndo || busy} onClick={undo}>
                <Undo2 /> Undo
              </Button>
            </div>
            <p className="min-h-4 text-[11px] text-muted-foreground">
              {versions.length ? 'Click a version to use it — or keep editing.' : 'Write it for me gives you three versions.'}
            </p>
            <AiWriterCard kind={cardKind(scan, picked, { starting, writing: busy })} options={writers} picked={picked}
              rendering={false} offerBuiltin={false} onPick={setChosen} onSetup={() => setSetupOpen(true)}
              onStart={(app) => void start(app)} scan={scan} onRescan={rescan} />
            {showsFrame && sees === false && (
              <p className="text-[11px] text-amber-400" data-writer-blind>
                The writer can’t see your clip — it keeps the face, pose, motion and setting in general words.
              </p>
            )}
          </div>
        </>}
        rows={<>
          <p className="mb-4 text-xs text-muted-foreground">
            Click a picture to add its change to your instruction. Click it again to take it back.
          </p>
          <PromptPicks rows={editRows(kind)} draft={draft} style="sentences" nsfw={nsfw}
            onPick={(row, pick) => change(togglePick(latest.current, row, pick, 'sentences'))}
            onReroll={(row) => change(rerollRow(latest.current, row, 'sentences', { nsfw }))} />
        </>}
        useLabel="Use this instruction" useDisabled={busy}
        onUse={() => {
          set('prompt', latest.current)
          // One writer for the whole video dialog: the one picked here (it may be a fallback).
          if (scan) onSettingChange('model', engine)
        }}
        dirty={draft !== initial}
        discardText="Your instruction in the Generate panel stays as it was."
        onClose={onClose} />
      <AiWriterSetup open={setupOpen} onClose={() => setSetupOpen(false)} scan={scan} onRescan={rescan}
        offerBuiltin={false} minTier="m" testWorkflowId="krea2-turbo" chosen={engine} onUse={setChosen} onStart={start} starting={starting} />
    </>
  )
}
