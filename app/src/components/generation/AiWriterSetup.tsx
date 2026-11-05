'use client'

import { useEffect, useRef, useState } from 'react'
import { Check, Loader2, Minus, Pause, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import type { SetupJob, SetupStep } from '@/lib/ai-writers/setup-jobs'
import { OLLAMA_TIERS, clampTier, tierInfo, type Tier } from '@/lib/ai-writers/tiers'
import type { ScanResult } from '@/lib/ai-writers/types'
import { jobFor, scanRows, setupOffers, startsByItself, writerOptions, type ScanRow } from '@/lib/ai-writers/view'

type Test = { id: string; state: 'running' | 'done' | 'error'; text?: string; seconds?: number }

function RowIcon({ state, busy }: { state: ScanRow['state']; busy?: boolean }) {
  const cls = busy ? 'bg-accent text-accent-foreground'
    : state === 'ok' ? 'bg-emerald-500/15 text-emerald-400' : state === 'warn' ? 'bg-amber-500/15 text-amber-400' : 'bg-muted text-muted-foreground'
  const I = busy ? Loader2 : state === 'ok' ? Check : state === 'warn' ? Pause : Minus
  return <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-md ${cls}`}><I className={`h-3.5 w-3.5 ${busy ? 'animate-spin' : ''}`} /></span>
}

function Steps({ steps }: { steps: SetupStep[] }) {
  return (
    <ol className="space-y-2">
      {steps.map((s, i) => (
        <li key={s.label} className={`grid grid-cols-[22px_minmax(0,1fr)] gap-x-2.5 gap-y-1 text-[13px] ${s.state === 'waiting' ? 'text-muted-foreground' : ''}`}>
          <span className={`grid h-[22px] w-[22px] place-items-center rounded-full border text-[11px] ${
            s.state === 'done' ? 'border-transparent bg-emerald-500/15 text-emerald-400'
              : s.state === 'error' ? 'border-transparent bg-destructive/15 text-destructive'
                : s.state === 'running' ? 'border-primary text-accent-foreground' : 'border-input'}`}>
            {s.state === 'done' ? <Check className="h-3 w-3" /> : s.state === 'error' ? <X className="h-3 w-3" />
              : s.state === 'running' ? <Loader2 className="h-3 w-3 animate-spin" /> : i + 1}
          </span>
          <span>
            {s.label}
            {s.state === 'running' && s.gb ? <span className="ml-1.5 font-mono text-[11px] text-muted-foreground">{(s.doneGb ?? 0).toFixed(1)} of {s.gb.toFixed(1)} GB</span> : null}
          </span>
          {s.state === 'running' && s.gb ? (
            <div className="col-start-2 h-1.5 overflow-hidden rounded-full bg-muted">
              <div className="h-full bg-gradient-to-r from-primary to-[#ffa64d] transition-[width]" style={{ width: `${Math.min(100, ((s.doneGb ?? 0) / s.gb) * 100)}%` }} />
            </div>
          ) : null}
        </li>
      ))}
    </ol>
  )
}

/** The green "it works" box: what the writer wrote and how long it took. */
function Result({ title, text, seconds, children }: { title: string; text?: string; seconds?: number; children?: React.ReactNode }) {
  return (
    <div className="space-y-1.5 rounded-lg border border-emerald-500/60 bg-emerald-500/10 p-3 text-[13px]">
      <p className="font-semibold text-emerald-400">✓ {title}</p>
      {text && <p className="text-[11px] text-muted-foreground">Test write, done in {seconds} s:</p>}
      {text && <q className="block italic">{text}</q>}
      {children}
    </div>
  )
}

/**
 * "AI writer setup": looks for every writer on this PC, lets the user pick one,
 * starts switched-off apps, adds a server address, and sets up the built-in
 * writer or Ollama with one click — for someone who has never heard of either.
 * Without `offerBuiltin` the built-in writer is neither listed nor offered.
 */
export default function AiWriterSetup({ open, onClose, scan, onRescan, offerBuiltin = true, testWorkflowId, chosen, onUse, onStart, starting, minTier = 's' }: {
  open: boolean
  onClose: () => void
  scan: ScanResult | null
  onRescan: () => Promise<ScanResult | null>
  offerBuiltin?: boolean
  /** The model the test write writes for; it only proves the writer answers. */
  testWorkflowId: string
  chosen: string
  onUse: (id: string) => void
  onStart: (app: 'ollama' | 'lmstudio' | 'comfy') => Promise<void>
  starting: string | null
  /** Smaller models are not offered (video's H3 script needs 9b or more). */
  minTier?: Tier
}) {
  const [scanning, setScanning] = useState(false)
  const [pick, setPick] = useState(chosen)
  const [test, setTest] = useState<Test | null>(null)
  const [jobs, setJobs] = useState<SetupJob[]>([])
  const [mine, setMine] = useState<ReadonlySet<string>>(new Set())
  const [tier, setTier] = useState<Tier | null>(null)
  const [addr, setAddr] = useState<{ open: boolean; value: string; key: string; error?: string; busy?: boolean }>({ open: false, value: 'http://127.0.0.1:8080', key: '' })
  const [removing, setRemoving] = useState<string | null>(null)
  const [manual, setManual] = useState(false)
  const [copied, setCopied] = useState(false)
  // Kinds that finished during this opening: their cards stay to show the result.
  const settled = useRef(new Set<string>())
  // The parent's latest callback and choice, for effects that run once per opening.
  const latest = useRef({ onRescan, chosen, mine })
  useEffect(() => { latest.current = { onRescan, chosen, mine } })

  // A fresh look every time the dialog opens.
  useEffect(() => {
    if (!open) return
    let live = true
    void (async () => {
      setScanning(true)
      setPick(latest.current.chosen)
      await latest.current.onRescan()
      if (live) setScanning(false)
    })()
    return () => { live = false }
  }, [open])

  // Setup jobs run on the server; follow them while the dialog is open.
  useEffect(() => {
    if (!open) return
    let live = true
    const tick = async () => {
      try {
        const r = await fetch('/api/ai-writers/setup', { cache: 'no-store' })
        if (!r.ok || !live) return
        const next = ((await r.json()) as { jobs: SetupJob[] }).jobs
        for (const j of next) {
          if (j.status === 'done' && !settled.current.has(j.kind) && latest.current.mine.has(j.kind)) {
            settled.current.add(j.kind)
            void latest.current.onRescan()
          }
        }
        // A setup still running from an earlier opening is followed like one started now.
        const running = next.filter((j) => j.status === 'running' && !latest.current.mine.has(j.kind)).map((j) => j.kind)
        if (running.length) setMine((m) => new Set([...m, ...running]))
        setJobs(next)
      } catch { /* the next tick tries again */ }
    }
    void tick()
    const t = setInterval(tick, 1000)
    return () => { live = false; clearInterval(t) }
  }, [open])

  const options = (scan ? writerOptions(scan) : []).filter((o) => offerBuiltin || o.app !== 'builtin')
  const offers = scan ? setupOffers(scan, minTier) : { builtin: false, ollama: false }
  const job = (kind: 'builtin' | 'ollama') => jobFor(jobs, kind, mine)
  const showBuiltin = offerBuiltin && (offers.builtin || !!job('builtin'))
  const showOllama = offers.ollama || !!job('ollama')
  const t = tierInfo(clampTier(tier ?? scan?.tier ?? 'm', minTier))
  const busyJob = jobs.some((j) => j.status === 'running')
  // Ollama is here but has no model to write with (or only smaller ones): the setup only adds the model.
  const ollamaHere = scan ? scan.ollama.state !== 'missing' : false
  const ollamaSmall = offers.ollama && ollamaHere && !!scan?.ollama.models.length
  const stage = scanning || !scan ? 1 : test || busyJob || jobs.some((j) => mine.has(j.kind)) ? 3 : 2

  const setUp = async (kind: 'builtin' | 'ollama') => {
    setMine((m) => new Set(m).add(kind))
    settled.current.delete(kind)
    const r = await fetch('/api/ai-writers/setup', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(kind === 'builtin' ? { kind } : { kind, model: t.model }),
    })
    const j = (await r.json().catch(() => ({}))) as { job?: SetupJob; error?: string }
    if (!r.ok || !j.job) { toast.error(j.error ?? 'The setup did not start'); return }
    setJobs((all) => [...all.filter((x) => x.kind !== kind), j.job!])
  }

  const runTest = async () => {
    const id = pick
    setTest({ id, state: 'running' })
    const t0 = performance.now()
    try {
      const r = await fetch('/api/prompt-builder/generate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ test: true, workflowId: testWorkflowId, engine: id }),
      })
      const j = (await r.json().catch(() => ({}))) as { prompts?: string[]; error?: string }
      const seconds = Math.round((performance.now() - t0) / 100) / 10
      setTest(r.ok && j.prompts?.[0] ? { id, state: 'done', text: j.prompts[0], seconds } : { id, state: 'error', text: j.error ?? 'The writer did not answer' })
      void onRescan()
    } catch (e) {
      setTest({ id, state: 'error', text: e instanceof Error ? e.message : 'Request failed' })
    }
  }

  const addServer = async () => {
    setAddr((a) => ({ ...a, busy: true, error: undefined }))
    const r = await fetch('/api/ai-writers/servers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ address: addr.value, apiKey: addr.key }) })
    const j = (await r.json().catch(() => ({}))) as { error?: string }
    if (!r.ok) { setAddr((a) => ({ ...a, busy: false, error: j.error ?? 'That did not work' })); return }
    setAddr({ open: false, value: 'http://127.0.0.1:8080', key: '' })
    await onRescan()
  }

  const removeServer = async (id: string) => {
    setRemoving(id)
    const r = await fetch('/api/ai-writers/servers', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) }).catch(() => null)
    if (r?.ok) await onRescan()
    else toast.error('That server could not be removed')
    setRemoving(null)
  }

  const copyCmd = async () => {
    try { await navigator.clipboard.writeText(`ollama pull ${t.model}`); setCopied(true); setTimeout(() => setCopied(false), 1500) }
    catch { toast.message(`ollama pull ${t.model}`) }
  }

  const facts = (rows: [string, React.ReactNode][]) => (
    <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-3.5 gap-y-1 text-[13px]">
      {rows.map(([k, v]) => <div key={k} className="contents"><dt className="text-muted-foreground">{k}</dt><dd>{v}</dd></div>)}
    </dl>
  )
  const card = (kind: 'builtin' | 'ollama') => {
    const j = job(kind)
    const builtin = kind === 'builtin'
    return (
      <article key={kind} className="grid content-start gap-3 rounded-xl border border-border p-4" data-setup-card={kind}>
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-[15px] font-semibold">{builtin ? 'Built-in writer' : 'Ollama'}</h3>
          <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-400">
            {builtin ? 'Easiest' : 'Best quality on your card'}
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          {builtin ? 'A small AI that runs inside Raccoon Studio. Nothing else to install.'
            : ollamaSmall ? 'Ollama is already here, but its models are too small for this. We add the right one for your graphics card.'
              : ollamaHere ? 'Ollama is already here, but has no model to write with. We add the right one for your graphics card.'
              : 'A free app for bigger AI models. We download and install it for you, no administrator rights needed.'}
        </p>
        {builtin
          ? facts([['Download', '5 GB, one file'], ['Extra app', 'None'], ['Speed', 'A few seconds per description'],
              ['Wording', 'Good, to the point'], ['Also helps', 'Picture descriptions in Edit video']])
          : facts([['Download', ollamaHere ? `${t.sizeGb.toFixed(1)} GB, the model` : `${(t.sizeGb + 1.6).toFixed(1)} GB, the app and a model`],
              ['Extra app', ollamaHere ? 'Ollama, already installed' : 'Ollama, installed for you'],
              ['Speed', 'A few seconds; bigger models take a bit longer'], ['Wording', 'Richer, more detail with bigger models'],
              ['Also helps', 'Video prompt writer and Director can use it too']])}
        {!builtin && (
          <div className="space-y-1.5">
            <p className="text-[11px] text-muted-foreground">Model for your graphics card memory (picked for you)</p>
            <div className="flex flex-wrap gap-1.5">
              {OLLAMA_TIERS.filter((x) => clampTier(x.tier, minTier) === x.tier).map((x) => (
                <Button key={x.tier} type="button" size="xs" variant={x.tier === t.tier ? 'default' : 'outline'} aria-pressed={x.tier === t.tier}
                  disabled={!!j && j.status === 'running'} onClick={() => setTier(x.tier)}>
                  {x.label}{scan?.gpu && x.tier === scan.tier ? ' · your card' : ''}
                </Button>
              ))}
            </div>
            <div className="rounded-lg border border-border px-3 py-2">
              <p className="font-mono text-[13px]">{t.model}</p>
              <p className="text-[11px] text-muted-foreground">{t.feel}</p>
            </div>
          </div>
        )}
        {!j || j.status === 'error' ? (
          <Button type="button" className="w-full" disabled={busyJob} onClick={() => void setUp(kind)}>
            {j?.status === 'error' ? 'Try again' : builtin ? 'Set up the built-in writer' : ollamaHere ? 'Add the model for me' : 'Set up Ollama for me'}
          </Button>
        ) : null}
        {j && <Steps steps={j.steps} />}
        {j?.status === 'error' && <p className="text-xs text-destructive">{j.error}</p>}
        {j?.status === 'done' && (
          <Result title={`Your AI writer is ready: ${builtin ? 'Built-in writer' : j.model}`} text={j.sample} seconds={j.seconds}>
            <Button type="button" className="mt-1" onClick={() => { onUse(j.writer!); onClose() }}>Start writing</Button>
          </Result>
        )}
      </article>
    )
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="flex max-h-[90vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-4xl" data-ai-writer-setup>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border px-4 py-3 pr-12">
          <DialogTitle className="text-base">AI writer setup</DialogTitle>
          <ol className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-label="Steps">
            {['Look for writers', 'Choose or install', 'Test and use'].map((label, i) => (
              <li key={label} className={`inline-flex items-center gap-1.5 ${i + 1 === stage ? 'text-foreground' : ''}`} aria-current={i + 1 === stage ? 'step' : undefined}>
                <span className={`grid h-[18px] w-[18px] place-items-center rounded-full text-[10px] font-bold ${
                  i + 1 < stage ? 'bg-emerald-500/15 text-emerald-400' : i + 1 === stage ? 'bg-primary text-primary-foreground' : 'border border-input'}`}>{i + 1}</span>
                {label}
              </li>
            ))}
          </ol>
          <DialogDescription className="w-full text-xs">
            A small AI on your own graphics card turns your idea into a detailed description. It is set up once, works offline, and nothing you type leaves your PC.
          </DialogDescription>
        </div>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
          <section className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold">What we found on your PC</h2>
              <Button type="button" size="xs" variant="ghost" disabled={scanning} onClick={() => { setScanning(true); void onRescan().finally(() => setScanning(false)) }}>
                {scanning ? <Loader2 className="animate-spin" /> : null} Scan again
              </Button>
            </div>
            <div className="overflow-hidden rounded-xl border border-border" data-scan-rows>
              {(scan ? scanRows(scan) : []).filter((r) => offerBuiltin || r.key !== 'builtin').map((r) => {
                const busy = scanning || (r.action === 'start-ollama' && starting === 'ollama') || (r.action === 'start-lmstudio' && starting === 'lmstudio')
                  || (r.action === 'start-comfy' && starting === 'comfy')
                return (
                  <div key={r.key} data-row={r.key} className="grid grid-cols-[24px_minmax(0,1fr)] items-center gap-x-3 gap-y-1.5 border-t border-border px-3.5 py-2.5 first:border-t-0 sm:grid-cols-[24px_minmax(0,1fr)_auto]">
                    <RowIcon state={r.state} busy={busy} />
                    <span className="grid min-w-0">
                      <b className="text-[13px]">{r.title}</b>
                      <span className="text-xs text-muted-foreground">{scanning ? 'Looking…' : busy ? 'Starting…' : r.detail}</span>
                    </span>
                    {!scanning && !busy && r.action && (
                      <span className="col-start-2 sm:col-start-3">
                        {r.action === 'add-address'
                          ? <Button type="button" size="xs" variant="outline" onClick={() => {
                              // A server that wants its key opens the form on its own address.
                              const keyless = scan?.servers.find((s) => s.needsKey)
                              setAddr((a) => ({ ...a, open: true, error: undefined, value: keyless?.address ?? a.value }))
                            }}>
                              {scan?.servers.length ? 'Add another' : 'Add an address'}
                            </Button>
                          : <Button type="button" size="xs" variant="outline"
                              onClick={() => void onStart(r.action === 'start-ollama' ? 'ollama' : r.action === 'start-lmstudio' ? 'lmstudio' : 'comfy')}>
                              {r.action === 'start-ollama' ? 'Start Ollama' : r.action === 'start-lmstudio' ? 'Start LM Studio' : 'Start ComfyUI'}
                            </Button>}
                      </span>
                    )}
                  </div>
                )
              })}
              {scan?.servers.filter((s) => s.saved).map((s) => (
                <div key={s.id} data-saved-server={s.address} className="flex items-center gap-3 border-t border-border py-1.5 pl-[50px] pr-3.5">
                  <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">{s.address}</span>
                  <Button type="button" size="xs" variant="ghost" aria-label={`Remove ${s.address}`} disabled={scanning || !!removing} onClick={() => void removeServer(s.id)}>
                    {removing === s.id ? <Loader2 className="animate-spin" /> : null} Remove
                  </Button>
                </div>
              ))}
              {!scan && <p className="flex items-center gap-2 px-3.5 py-3 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Looking…</p>}
            </div>
            {addr.open && (
              <div className="space-y-2 rounded-xl border border-border p-3" data-add-address>
                <label htmlFor="ai-server-address" className="text-[13px] font-semibold">Server address</label>
                <div className="flex flex-wrap gap-2">
                  <Input id="ai-server-address" value={addr.value} spellCheck={false} className="h-8 min-w-0 flex-1 font-mono text-xs"
                    onChange={(e) => setAddr((a) => ({ ...a, value: e.target.value, error: undefined }))}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !addr.busy) void addServer() }} />
                  <Input aria-label="API key" type="password" placeholder="API key, if it wants one" value={addr.key} spellCheck={false} autoComplete="off"
                    className="h-8 min-w-0 flex-1 font-mono text-xs"
                    onChange={(e) => setAddr((a) => ({ ...a, key: e.target.value, error: undefined }))}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !addr.busy) void addServer() }} />
                  <Button type="button" size="sm" disabled={addr.busy} onClick={() => void addServer()}>
                    {addr.busy ? <Loader2 className="animate-spin" /> : null} Connect
                  </Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => setAddr((a) => ({ ...a, open: false, error: undefined }))}>Cancel</Button>
                </div>
                {addr.error && <p className="text-xs text-amber-400">{addr.error}</p>}
                <p className="text-[11px] text-muted-foreground">
                  Any server with the OpenAI-style interface works: llama.cpp, KoboldCpp, Jan, text-generation-webui, vLLM, Unsloth Studio. We remember it and check it on every scan.
                  Unsloth Studio wants a key: Settings → API → Create, then load a model on its Chat page.
                </p>
              </div>
            )}
          </section>

          {options.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-sm font-semibold">Pick your writer</h2>
              <p className="text-xs text-muted-foreground">Everything we found. The same list is the dropdown in Help me write. Apps that are switched off start by themselves when used.</p>
              <div className="grid gap-2" role="radiogroup" aria-label="AI writer">
                {options.map((o) => (
                  <label key={o.id} className={`grid cursor-pointer grid-cols-[18px_minmax(0,1fr)] items-center gap-x-3 gap-y-1 rounded-xl border px-3.5 py-2.5 sm:grid-cols-[18px_minmax(0,1fr)_auto] ${
                    pick === o.id ? 'border-primary bg-accent' : 'border-border'}`}>
                    <input type="radio" name="ai-writer" value={o.id} checked={pick === o.id} onChange={() => setPick(o.id)} className="accent-[#f5811e]" />
                    <span className="grid min-w-0">
                      <b className="truncate text-[13px]">{o.name}</b>
                      <span className="truncate text-[11px] text-muted-foreground">{o.group}{o.detail ? ` · ${o.detail}` : ''}</span>
                    </span>
                    <span className="col-start-2 flex flex-wrap gap-1 sm:col-start-3 sm:justify-end">
                      {o.tags.map((tag) => <span key={tag} className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-400">{tag}</span>)}
                      {o.off && <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                        {startsByItself(o) ? 'Starts by itself when used' : 'Needs ComfyUI running'}</span>}
                    </span>
                  </label>
                ))}
              </div>
              {test?.state === 'running' && (
                <p className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" />
                  {options.some((o) => o.id === test.id && startsByItself(o)) ? 'Starting it, then writing a test description…' : 'Writing a test description…'}</p>
              )}
              {test?.state === 'done' && <Result title={`Works: ${options.find((o) => o.id === test.id)?.name ?? ''}`} text={test.text} seconds={test.seconds} />}
              {test?.state === 'error' && <p className="text-xs text-destructive">{test.text}</p>}
            </section>
          )}

          {(showBuiltin || showOllama) && (
            <section className="space-y-2">
              <h2 className="text-sm font-semibold">{options.length ? 'Add another writer' : 'Choose your AI writer. We set it up for you.'}</h2>
              <p className="text-xs text-muted-foreground">
                {options.length ? 'One click. It installs and tests itself.'
                  : showBuiltin && showOllama
                    ? 'Both install by themselves with one click and are tested before you use them. You can keep picking pictures meanwhile, and add the other one any time later.'
                    : 'It installs by itself with one click and is tested before you use it. You can keep picking pictures meanwhile.'}
              </p>
              <div className="grid gap-3 md:grid-cols-2">
                {showBuiltin && card('builtin')}
                {showOllama && card('ollama')}
              </div>
              {showBuiltin && showOllama && (
                <p className="text-[11px] text-muted-foreground">
                  Not sure? The built-in writer is ready soonest. Ollama writes richer descriptions and also powers the video tools.
                </p>
              )}
              {showOllama && (
                <div className="space-y-2">
                  <button type="button" className="text-xs text-accent-foreground underline underline-offset-2" onClick={() => setManual(!manual)}>
                    I’d rather install Ollama myself
                  </button>
                  {manual && (
                    <div className="space-y-2 text-[13px]" data-manual-steps>
                      <ol className="list-decimal space-y-1.5 pl-5">
                        <li>Download Ollama from <a href="https://ollama.com/download" target="_blank" rel="noopener noreferrer" className="text-accent-foreground underline">ollama.com/download</a> and install it like any other app.</li>
                        <li>Copy this command. Open the Start menu, type <b>cmd</b>, press Enter, paste it and press Enter. Leave the window open until it says <span className="font-mono">success</span>.</li>
                        <li>Come back here and click <b>Scan again</b>.</li>
                      </ol>
                      <div className="flex items-center gap-2 rounded-lg border border-input bg-background py-1 pl-3 pr-1">
                        <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap font-mono text-xs">ollama pull {t.model}</code>
                        <Button type="button" size="xs" variant="outline" onClick={() => void copyCmd()}>{copied ? 'Copied' : 'Copy'}</Button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </section>
          )}
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-t border-border px-4 py-3">
          <p className="min-w-56 flex-1 border-l-2 border-input pl-2.5 text-xs text-muted-foreground">
            {options.length
              ? 'For 18+ descriptions: some models refuse adult topics. Versions marked “uncensored”, “abliterated” or “heretic” don’t.'
              : 'Already use LM Studio or a llama.cpp server? Start it and click Scan again, or add its address above.'}
          </p>
          {options.length > 0 ? (
            <>
              <Button type="button" variant="outline" disabled={!options.some((o) => o.id === pick) || test?.state === 'running'} onClick={() => void runTest()}>Test write</Button>
              <Button type="button" disabled={!options.some((o) => o.id === pick)} onClick={() => { onUse(pick); onClose() }}>Use this writer</Button>
            </>
          ) : (
            <Button type="button" variant="ghost" onClick={onClose}>Not now</Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
