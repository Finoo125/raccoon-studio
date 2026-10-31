'use client'

import { Check, Download, Loader2, Pause } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { startsByItself, type CardKind, type WriterApp, type WriterOption } from '@/lib/ai-writers/view'

export const APP_NAME: Record<WriterApp, string> = { builtin: 'Raccoon Studio', ollama: 'Ollama', lmstudio: 'LM Studio', server: 'your AI server' }

/** The writer dropdown: grouped by where each writer runs, switched-off apps marked. */
function WriterSelect({ options, picked, onPick, disabled }: {
  options: readonly WriterOption[]; picked: WriterOption; onPick: (id: string) => void; disabled?: boolean
}) {
  const groups = [...new Set(options.map((o) => o.group))]
  return (
    <select aria-label="AI writer" value={picked.id} disabled={disabled} onChange={(e) => onPick(e.target.value)}
      className="h-8 w-full rounded-md border border-border bg-background px-2 text-xs text-foreground disabled:opacity-60">
      {groups.map((g) => {
        const items = options.filter((o) => o.group === g)
        return (
          <optgroup key={g} label={startsByItself(items[0]) ? `${g} (switched off, starts when used)` : items[0].off ? `${g} (ComfyUI is not running)` : g}>
            {items.map((o) => <option key={o.id} value={o.id}>{o.name}{o.detail ? ` — ${o.detail}` : ''}</option>)}
          </optgroup>
        )
      })}
    </select>
  )
}

/**
 * The writing bar's AI writer: which writer writes, whether it can right now,
 * and the one button that fixes it when it cannot.
 */
export default function AiWriterCard({ kind, options, picked, rendering, onPick, onSetup, onStart,
  offerBuiltin = true, writingLabel = 'Writing 3 versions…' }: {
  kind: CardKind
  options: readonly WriterOption[]
  picked: WriterOption | null
  /** A render is running — the built-in writer waits for it. */
  rendering: boolean
  onPick: (id: string) => void
  onSetup: () => void
  onStart: (app: 'ollama' | 'lmstudio' | 'comfy') => void
  /** False where the built-in writer is never offered (Generate Video). */
  offerBuiltin?: boolean
  /** The card's title while a write runs. */
  writingLabel?: string
}) {
  const more = <Button type="button" size="xs" variant="ghost" onClick={onSetup}>Set up or find more</Button>
  const icon = (tone: 'ok' | 'warn' | 'busy', I: typeof Check) => (
    <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-md ${
      tone === 'ok' ? 'bg-emerald-500/15 text-emerald-400' : tone === 'warn' ? 'bg-amber-500/15 text-amber-400' : 'bg-accent text-accent-foreground'}`}>
      <I className={`h-4 w-4 ${tone === 'busy' ? 'animate-spin' : ''}`} />
    </span>
  )
  const line = (tone: 'ok' | 'warn' | 'busy', I: typeof Check, title: string, sub: React.ReactNode) => (
    <div className="flex items-start gap-2.5">
      {icon(tone, I)}
      <div className="min-w-0">
        <p className="text-[13px] font-semibold leading-tight">{title}</p>
        <p className="text-[11px] leading-snug text-muted-foreground">{sub}</p>
      </div>
    </div>
  )
  const app = picked ? APP_NAME[picked.app] : ''

  return (
    <div className="space-y-2 rounded-lg border border-border bg-background/60 p-2.5" aria-live="polite" data-ai-writer={kind}>
      <span className="text-xs font-semibold">AI writer</span>
      {kind === 'loading' && line('busy', Loader2, 'Looking for AI writers…', 'On this PC only.')}
      {kind === 'none' && (
        <>
          {line('warn', Download, 'No AI writer on this PC yet', <><b>Write it for me</b> needs one. {offerBuiltin
            ? 'Pick the built-in writer or Ollama, and we set it up with one click.'
            : 'We set up Ollama for you with one click, or find the one you already have.'} Picking pictures works without it.</>)}
          <Button type="button" className="w-full" onClick={onSetup}>Choose and set up</Button>
        </>
      )}
      {picked && kind !== 'none' && kind !== 'loading' && (
        <>
          <WriterSelect options={options} picked={picked} onPick={onPick} disabled={kind === 'writing' || kind === 'starting'} />
          {kind === 'ready' && line('ok', Check, 'Ready',
            picked.app === 'builtin' ? 'Runs inside Raccoon Studio, privately on your PC.' : `Runs in ${app}, privately on your PC.`)}
          {kind === 'off' && line('warn', Pause, `${app} is switched off`, <>It starts by itself when you click <b>Write it for me</b>.</>)}
          {kind === 'comfy-off' && line('warn', Pause, 'ComfyUI is not running', 'The built-in writer runs inside it.')}
          {kind === 'starting' && line('busy', Loader2, picked.app === 'builtin' ? 'Starting ComfyUI…' : `Starting ${app}…`,
            picked.app === 'builtin' ? 'This takes a minute or two.' : 'Takes a few seconds.')}
          {kind === 'writing' && line('busy', Loader2, writingLabel,
            startsByItself(picked) ? `Starting ${app} first, then writing.`
              : picked.app === 'builtin' && rendering ? 'It waits for the current render to finish.'
                : 'The first one after starting takes a few seconds longer.')}
          {(kind === 'ready' || kind === 'off' || kind === 'comfy-off') && (
            <div className="flex flex-wrap gap-1.5">
              {kind === 'off' && (picked.app === 'ollama' || picked.app === 'lmstudio') && (
                <Button type="button" size="xs" variant="outline" onClick={() => onStart(picked.app as 'ollama' | 'lmstudio')}>Start now</Button>
              )}
              {kind === 'comfy-off' && <Button type="button" size="xs" variant="outline" onClick={() => onStart('comfy')}>Start ComfyUI</Button>}
              {more}
            </div>
          )}
        </>
      )}
    </div>
  )
}
