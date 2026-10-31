'use client'

import { useState } from 'react'
import { Dices, Loader2, Lock, RefreshCw, Sparkles, Undo2, Wand2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { InfoTip } from './SwitchTile'
import PromptPicks from './PromptPicks'
import AiWriterCard from './AiWriterCard'
import AiWriterSetup from './AiWriterSetup'
import HelperShell, { HelperLocked } from './helper/HelperShell'
import { useNsfwSwitch, useWriters } from './helper/useWriters'
import { useDraftHistory } from './helper/useDraftHistory'
import { PROMPT_HELPER_ADDON, useAddonLock } from '@/lib/addons/useAddonLock'
import { useQueueStore } from '@/lib/comfyui/queue'
import type { PromptTask } from '@/lib/prompt-builder/enhance'
import { cardKind } from '@/lib/ai-writers/view'
import { dropBlocked, promptStyleOf, rerollRow, surprise, togglePick, type PickRowId } from '@/lib/prompt-builder/picks'
import { promptLimit } from '@/lib/workflows/z-image-turbo'
import type { WorkflowDefinition } from '@/types/workflow'

const ENGINE_KEY = 'raccoon.promptHelper.engine'
const readEngine = () => { try { return localStorage.getItem(ENGINE_KEY) ?? '' } catch { return '' } }
const saveEngine = (e: string) => { try { localStorage.setItem(ENGINE_KEY, e) } catch { /* private window */ } }
/** What one Write / Make it better sends — kept so Try again can repeat it exactly. */
type WriteRequest = { task: PromptTask; idea?: string; prompt: string }

/** The ✨ button in the Prompt header. `lock` replaces the Prompt Helper's own (Generate Video's Director exception). */
export function PromptHelperButton({ onOpen, lock }: { onOpen: () => void; lock?: { locked: boolean; loaded: boolean } }) {
  const own = useAddonLock(PROMPT_HELPER_ADDON)
  const { locked, loaded } = lock ?? own
  return (
    <Button type="button" variant="ghost" size="sm" aria-haspopup="dialog" onClick={onOpen}
      className="h-6 gap-1.5 px-2 text-xs text-muted-foreground">
      {loaded && locked ? <Lock className="h-3.5 w-3.5" /> : <Sparkles className="h-3.5 w-3.5" />} Help me write
    </Button>
  )
}

/**
 * The Prompt Helper (supporter add-on) as a dialog: a writing bar on top (idea,
 * three versions, the draft description) and picture picks scrolling below. It
 * works on a copy of the prompt; nothing reaches the Generate form until "Use
 * this description". Mounted only while open, so every opening starts fresh and a
 * write still running when it closes lands nowhere.
 */
export default function PromptHelperDialog({ open, ...rest }: {
  open: boolean
  onClose: () => void
  workflow: WorkflowDefinition
  prompt: string
  onUse: (text: string) => void
}) {
  return open ? <HelperDialog {...rest} /> : null
}

function HelperDialog({ onClose, workflow, prompt, onUse }: {
  onClose: () => void
  workflow: WorkflowDefinition
  prompt: string
  onUse: (text: string) => void
}) {
  const { locked, loaded } = useAddonLock(PROMPT_HELPER_ADDON)
  const rendering = useQueueStore((s) => s.jobs.some((j) => j.status === 'running' || j.status === 'pending'))
  const [initial] = useState(prompt)
  const { draft, latest, change, typeInto, undo, canUndo } = useDraftHistory(prompt)
  const [idea, setIdea] = useState('')
  const [keep, setKeep] = useState<ReadonlySet<PickRowId>>(new Set())
  const [versions, setVersions] = useState<string[]>([])
  const [lastRun, setLastRun] = useState<WriteRequest | null>(null)
  const [busy, setBusy] = useState<PromptTask | null>(null)
  const [chosen, setChosen] = useState(readEngine)
  const pickEngine = (e: string) => { setChosen(e); saveEngine(e) }
  const { scan, rescan, options, picked, engine, starting, start, setupOpen, setSetupOpen } =
    useWriters({ chosen, enabled: loaded && !locked })
  const [nsfw, setNsfw] = useNsfwSwitch()

  if (loaded && locked) return <HelperLocked onClose={onClose} />

  const style = promptStyleOf(workflow)
  const prefix = workflow.defaultParams.prompt ?? ''
  const limit = promptLimit(workflow.loraFamily)

  /** A fresh request, or — for Try again — exactly the last one: never a rewrite of version 1. */
  const run = async (req: WriteRequest = { task: 'write', idea, prompt: latest.current }) => {
    // No writer yet: the button opens the setup instead of failing.
    if (!engine) { setSetupOpen(true); return }
    const wasOff = picked?.off
    setBusy(req.task)
    setLastRun(req)
    try {
      const res = await fetch('/api/prompt-builder/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...req, workflowId: workflow.id, engine, count: 3 }),
      })
      const j = (await res.json().catch(() => ({}))) as { prompts?: string[]; error?: string }
      if (!res.ok || !j.prompts?.length) { toast.error(j.error ?? 'The writer did not answer — try again'); return }
      setVersions(j.prompts)
      change(j.prompts[0])
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Request failed')
    } finally {
      setBusy(null)
      // The write started a switched-off app; show it running now.
      if (wasOff) void rescan()
    }
  }

  return (
    <>
      <HelperShell title="✨ Help me write"
        chip={<>
          {workflow.name} writes in {style}
          <InfoTip label="About sentences and tags">
            Pony, Illustrious and Anima understand short tags like “beach, sunset”. The other models understand
            normal sentences. The helper writes the kind your model needs.
          </InfoTip>
        </>}
        nsfw={{ on: nsfw, toggle: () => setNsfw(!nsfw) }}
        steps={['Pick pictures, or type your idea in your own words', 'Write it for me gives you 3 versions',
          'Choose one, change anything, then Use this description']}
        bar={<>
          <div className="min-w-0 space-y-2">
            <label htmlFor="helper-idea" className="text-sm font-semibold">What do you want to see?</label>
            <div className="flex gap-2">
              <Input id="helper-idea" value={idea} onChange={(e) => setIdea(e.target.value)} className="h-8 text-sm"
                placeholder="e.g. my cat as a knight in a castle"
                onKeyDown={(e) => { if (e.key === 'Enter' && idea.trim() && !busy) void run() }} />
              <Button type="button" className="h-8 shrink-0" disabled={!idea.trim() || !!busy} onClick={() => void run()}>
                {busy === 'write' ? <Loader2 className="animate-spin" /> : <Wand2 />} Write it for me
              </Button>
            </div>
            <div className="flex items-baseline justify-between gap-2">
              <label htmlFor="helper-draft" className="text-sm font-semibold">Your description</label>
              {limit !== undefined && (
                <span className={`text-[11px] ${draft.length > limit ? 'font-medium text-destructive' : 'text-muted-foreground'}`}>
                  {draft.length} / {limit} characters{draft.length > limit ? ' — this model renders a black picture past that' : ''}
                </span>
              )}
            </div>
            <Textarea id="helper-draft" value={draft} onChange={(e) => typeInto(e.target.value)}
              className="h-24 resize-none text-sm leading-relaxed" placeholder="Pick pictures below, or write your idea above…" />
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
              {lastRun && (
                <Button type="button" size="xs" variant="ghost" disabled={!!busy} onClick={() => void run(lastRun)}>
                  <RefreshCw /> Try again
                </Button>
              )}
            </div>
            <p className="min-h-4 text-[11px] text-muted-foreground">
              {versions.length ? 'Click a version to use it — or keep editing.' : 'Write it for me and Make it better give you three versions.'}
            </p>
            <div className="flex gap-2">
              <Button type="button" variant="outline" className="flex-1" disabled={!draft.trim() || !!busy}
                onClick={() => void run({ task: 'improve', prompt: latest.current })}>
                {busy === 'improve' ? <Loader2 className="animate-spin" /> : <Sparkles />} Make it better
              </Button>
              <Button type="button" variant="ghost" disabled={!canUndo} onClick={undo}>
                <Undo2 /> Undo
              </Button>
            </div>
            <AiWriterCard kind={cardKind(scan, picked, { starting, writing: !!busy })} options={options} picked={picked}
              rendering={rendering} onPick={pickEngine} onSetup={() => setSetupOpen(true)} onStart={(app) => void start(app)} />
          </div>
        </>}
        rows={<>
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <Button type="button" onClick={() => change(surprise(latest.current, style, { prefix, keep, nsfw }))}>
              <Dices /> Surprise me
            </Button>
            <p className="text-xs text-muted-foreground">Click a picture to add it. Click it again to remove it.</p>
          </div>
          <PromptPicks draft={draft} style={style} keep={keep} nsfw={nsfw}
            onPick={(row, p) => {
              const next = togglePick(latest.current, row, p, style)
              // A new Who drops what it cannot do (a dress on a cat, a position for one person).
              change(row.id === 'who' ? dropBlocked(next, style) : next)
            }}
            onReroll={(row) => change(rerollRow(latest.current, row, style, { nsfw }))}
            onToggleKeep={(id) => setKeep((k) => {
              const next = new Set(k)
              if (next.has(id)) next.delete(id)
              else next.add(id)
              return next
            })} />
        </>}
        useLabel="Use this description" onUse={() => onUse(latest.current)} dirty={draft !== initial} onClose={onClose} />
      <AiWriterSetup open={setupOpen} onClose={() => setSetupOpen(false)} scan={scan} onRescan={rescan}
        testWorkflowId={workflow.id} chosen={engine} onUse={pickEngine} onStart={start} starting={starting} />
    </>
  )
}
