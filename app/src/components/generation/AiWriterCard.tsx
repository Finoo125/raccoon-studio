'use client'

import { useState } from 'react'
import { Check, Download, KeyRound, Loader2, Pause } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { ScanServer } from '@/lib/ai-writers/types'
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
 * A server the scan found that wants an API key (Unsloth Studio), asked for right
 * here so nobody has to find the setup's "Add an address". Saved the same way.
 */
function ServerKeyField({ server, onSaved }: { server: ScanServer; onSaved: () => Promise<unknown> }) {
  const [key, setKey] = useState('')
  const [state, setState] = useState<{ busy?: boolean; error?: string }>({})
  const save = async () => {
    setState({ busy: true })
    const r = await fetch('/api/ai-writers/servers', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ address: server.address, apiKey: key }),
    }).catch(() => null)
    const j = (await r?.json().catch(() => ({}))) as { error?: string } | undefined
    if (!r?.ok) { setState({ error: j?.error ?? 'That did not work' }); return }
    await onSaved()
  }
  const unsloth = server.kind === 'Unsloth Studio'
  return (
    <div className="space-y-1.5 rounded-md border border-amber-500/40 p-2" data-server-key>
      <p className="flex items-center gap-1.5 text-[12px] font-semibold"><KeyRound className="h-3.5 w-3.5 text-amber-400" /> {server.kind} found — it needs its API key</p>
      <div className="flex gap-1.5">
        <Input aria-label={`${server.kind} API key`} type="password" autoComplete="off" spellCheck={false} value={key}
          placeholder={unsloth ? 'sk-unsloth-…' : 'API key'} className="h-7 min-w-0 flex-1 font-mono text-xs"
          onChange={(e) => { setKey(e.target.value); setState({}) }}
          onKeyDown={(e) => { if (e.key === 'Enter' && key.trim() && !state.busy) void save() }} />
        <Button type="button" size="xs" disabled={!key.trim() || state.busy} onClick={() => void save()}>
          {state.busy ? <Loader2 className="animate-spin" /> : null} Connect
        </Button>
      </div>
      {state.error
        ? <p className="text-[11px] text-amber-400">{state.error}</p>
        : unsloth && <p className="text-[11px] text-muted-foreground">In Unsloth Studio: your avatar (bottom left) → Settings → API → Create, then paste it here.</p>}
    </div>
  )
}

/**
 * The writing bar's AI writer: which writer writes, whether it can right now,
 * and the one button that fixes it when it cannot.
 */
export default function AiWriterCard({ kind, options, picked, rendering, onPick, onSetup, onStart,
  offerBuiltin = true, writingLabel = 'Writing 3 versions…', scan, onRescan }: {
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
  /** The scan's servers: one that wants a key gets a key field; an idle Unsloth gets its hint. */
  scan?: { servers: ScanServer[] } | null
  onRescan?: () => Promise<unknown>
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
  const keyless = scan?.servers.find((s) => s.reachable && s.needsKey)
  const idleUnsloth = scan?.servers.find((s) => s.reachable && !s.needsKey && s.kind === 'Unsloth Studio' && !s.models.length)
  const busy = kind === 'loading' || kind === 'writing' || kind === 'starting'

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
      {!busy && keyless && onRescan && <ServerKeyField key={keyless.id} server={keyless} onSaved={onRescan} />}
      {!busy && idleUnsloth && (
        <div className="space-y-1.5" data-unsloth-idle>
          <p className="text-[11px] text-amber-400">
            Unsloth Studio has no model loaded. Load one on its Chat page, or turn on Settings → API → Model auto-switch.
          </p>
          {onRescan && <Button type="button" size="xs" variant="outline" onClick={() => void onRescan()}>Check again</Button>}
        </div>
      )}
    </div>
  )
}
