'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { Check, Download, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import ImportPanel from '@/components/models/ImportPanel'
import { useFileDownloads, useHardware, useOnDisk } from '@/components/setup/hooks'
import { cn } from '@/lib/utils'
import { restartComfyUI } from '@/lib/comfyui/restart'
import { fileKey } from '@/lib/models/download-client'
import {
  CIVITAI_URL, COMMUNITY_ROWS, NO_HARDWARE, STARTER_MODELS, defaultPicks, downloadPlan, fmtGb, isInstalled,
  recommendedFor, versionFor, whyNot, type CommunityRow, type StarterGroup, type StarterModel, type StarterVersion,
} from '@/lib/models/starter'
import { PORTAL_URL, guideUrl } from '@/lib/portal'
import type { Hardware } from '@/lib/hardware'
import { markOfferSeen, markSetupDone } from '@/lib/setup/state'
import { TOUR_EVENT, TOUR_KEY } from '@/lib/tour'

const GROUPS: { id: StarterGroup; title: string; blurb: string }[] = [
  { id: 'photo', title: 'Photos', blurb: 'Realistic people, places and things' },
  { id: 'anime', title: 'Anime & illustration', blurb: 'Drawn, painted and anime styles' },
  { id: 'video', title: 'Video', blurb: 'Short clips with sound, from text or a picture' },
]
const VRAM_CHOICES = [6, 8, 12, 16, 24]
const WIKI_FIRST_START = guideUrl('/setup')
const chip = 'rounded-md border border-border bg-muted px-2 py-1 text-xs transition-colors hover:bg-muted/70'

/**
 * Start here: the computer, every model that fits it, one download, a first
 * picture. One page, four steps, all visible (spec §1; the owner's mockup v3).
 */
export default function SetupPage() {
  const router = useRouter()
  const { hw, detected, override, pickVram } = useHardware()
  const { onDisk, hasImageModel, reload } = useOnDisk()
  const dl = useFileDownloads()
  const [picked, setPicked] = useState<Set<string> | null>(null)
  const [choosingVram, setChoosingVram] = useState(false)
  const [importing, setImporting] = useState(false)
  const [justGot, setJustGot] = useState<string[]>([])

  // Seed the ticks once the computer and the disk are known; a new memory pick re-seeds (setPicked(null)).
  useEffect(() => {
    if (picked || !hw || hw.vramGb === null || !onDisk) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time seed when the facts arrive
    setPicked(new Set(defaultPicks(hw, onDisk)))
  }, [picked, hw, onDisk])

  // Whoever opened the setup has seen it: the 2.0 "New: …" offer must not ask them afterwards.
  useEffect(() => { markOfferSeen() }, [])

  const { resume } = dl
  useEffect(() => { void resume(STARTER_MODELS.flatMap((m) => m.versions.flatMap((v) => v.files))) }, [resume])
  useEffect(() => { if (dl.phase === 'done') reload() }, [dl.phase, reload])

  const ticked = picked ?? new Set<string>()
  const chosen = hw
    ? STARTER_MODELS.filter((m) => ticked.has(m.id) && !whyNot(m, hw) && versionFor(m, hw) && !(onDisk && isInstalled(m, onDisk)))
    : []
  const plan = downloadPlan(chosen.map((m) => versionFor(m, hw ?? NO_HARDWARE)).filter((v): v is StarterVersion => !!v), onDisk ?? new Set())
  const busy = dl.phase === 'downloading' || dl.phase === 'waiting' || dl.phase === 'restarting'
  const roomGb = hw?.freeDiskGb ?? null
  const noRoom = roomGb !== null && plan.totalMb / 1000 > roomGb
  // "Make my first picture" never lands on picture editing, which needs a picture first.
  const installedImage = (m: StarterModel) => m.opens.page === 'image' && m.group !== 'edit' && !!onDisk && isInstalled(m, onDisk)
  const recommendedImage = (['photo', 'anime'] as const).map((g) => (hw ? recommendedFor(g, hw) : null))
  const target = STARTER_MODELS.find((m) => justGot.includes(m.id) && installedImage(m))
    ?? recommendedImage.find((m) => m && installedImage(m))
    ?? STARTER_MODELS.find(installedImage)
  const canGo = !busy && (!!target || hasImageModel)

  const toggle = (id: string) => setPicked((p) => {
    const next = new Set(p ?? [])
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })
  const download = () => {
    setJustGot(chosen.map((m) => m.id))
    void dl.start(plan.files)
  }
  const go = (tour: boolean) => {
    markSetupDone()
    // "Make my first picture" means: not now — the tour stays one click away in Settings.
    if (!tour) try { localStorage.setItem(TOUR_KEY, '1') } catch { /* unavailable */ }
    router.push(target?.opens.page === 'image' && target.samplePrompt
      ? `/generate?workflow=${target.opens.preset}&prompt=${encodeURIComponent(target.samplePrompt)}`
      : '/generate')
    if (tour) setTimeout(() => window.dispatchEvent(new Event(TOUR_EVENT)), 300)
  }

  return (
    <div className="mx-auto max-w-6xl space-y-3.5 px-5 py-7">
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">Let&apos;s get you set up</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Tick what you&apos;d like, press Download, and you&apos;re making pictures. We pick the version of each model that fits your computer.
        </p>
      </div>

      <Step n={1} title="Your computer" state={hw && hw.vramGb !== null ? 'done' : 'active'}>
        {!hw ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Looking at your computer…</p>
        ) : (
          <div className="flex flex-wrap gap-2.5">
            <Fact label="Graphics card" value={hw.gpuName ?? 'Not detected'} />
            <Fact label="Graphics memory" value={hw.vramGb !== null ? `${Math.round(hw.vramGb)} GB${override ? ' (picked by you)' : ''}` : 'Unknown'} />
            <Fact label="RAM" value={hw.ramGb !== null ? `${Math.round(hw.ramGb)} GB` : 'Unknown'} />
            <Fact label="Free disk space" value={roomGb !== null ? `${Math.round(roomGb)} GB` : 'Unknown'} />
          </div>
        )}
        {hw && (choosingVram || hw.vramGb === null) && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-sm">How much graphics memory does your card have?</span>
            {VRAM_CHOICES.map((gb) => (
              <Button key={gb} size="sm" variant={hw.vramGb !== null && Math.round(hw.vramGb) === gb ? 'default' : 'outline'}
                onClick={() => { pickVram(gb); setChoosingVram(false); setPicked(null) }}>
                {gb === 24 ? '24 GB or more' : `${gb} GB`}
              </Button>
            ))}
            {override && detected?.vramGb != null && (
              <Button size="sm" variant="ghost" onClick={() => { pickVram(null); setChoosingVram(false); setPicked(null) }}>
                Use what was detected ({Math.round(detected.vramGb)} GB)
              </Button>
            )}
          </div>
        )}
        <p className="mt-2.5 text-xs text-muted-foreground">
          Not right? <button type="button" className="underline" onClick={() => setChoosingVram(true)}>Pick your graphics memory yourself</button>
          {WIKI_FIRST_START && <> · <a href={WIKI_FIRST_START} target="_blank" rel="noreferrer" className="underline">What these numbers mean</a></>}
        </p>
      </Step>

      <Step n={2} title="What do you want to make?" state={busy || dl.phase === 'done' ? 'done' : hw?.vramGb != null ? 'active' : 'idle'}>
        <div className="grid items-start gap-3.5 lg:grid-cols-3">
          {GROUPS.map((g) => (
            <Column key={g.id} group={g} hw={hw} onDisk={onDisk} ticked={ticked} locked={busy} onToggle={toggle}
              onAdd={() => setImporting(true)} />
          ))}
        </div>
        {importing && (
          <div className="mt-3.5 rounded-xl border border-border bg-card p-3">
            <ImportPanel onEnd={(imported) => { if (imported) { reload(); void restartComfyUI() } }} />
          </div>
        )}
      </Step>

      <Step n={3} title="Download" state={dl.phase === 'done' ? 'done' : busy ? 'active' : 'idle'}>
        <div className="flex flex-wrap items-center gap-3.5">
          <Button className="h-10 px-5 text-sm font-bold" disabled={!plan.files.length || busy || noRoom} onClick={download}>
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
            {dl.phase === 'downloading' ? 'Downloading…'
              : dl.phase === 'waiting' ? 'Waiting for your render to finish…'
              : dl.phase === 'restarting' ? 'Restarting the engine…'
              : plan.files.length ? `Download ${chosen.length} model${chosen.length > 1 ? 's' : ''} (${fmtGb(plan.totalMb)} GB)`
              : 'Tick a model above'}
          </Button>
          {plan.files.length > 0 && roomGb !== null && (
            <span className={cn('text-xs', noRoom ? 'text-destructive' : 'text-muted-foreground')}>
              {noRoom ? `Not enough room: ${Math.round(roomGb)} GB free.` : `${Math.round(roomGb)} GB free on your disk — enough room.`}
            </span>
          )}
        </div>
        {dl.phase !== 'idle' && (
          <div className="mt-3.5 grid gap-2.5">
            {STARTER_MODELS.filter((m) => justGot.includes(m.id) || m.versions.some((v) => v.files.some((f) =>
              dl.transfers.some((t) => t.status === 'running' && t.key === fileKey(f))))).map((m) => {
              const keys = ((hw ? versionFor(m, hw) : null) ?? m.versions[0]).files.map(fileKey)
              const mine = dl.transfers.filter((t) => keys.includes(t.key))
              const total = mine.reduce((n, t) => n + t.totalBytes, 0)
              const pct = dl.phase === 'done' ? 100 : total ? Math.round((mine.reduce((n, t) => n + t.receivedBytes, 0) / total) * 100) : 0
              return (
                <div key={m.id}>
                  <div className="mb-1 flex justify-between text-xs"><span>{m.name}</span><span className="tabular-nums">{pct}%</span></div>
                  <div className="h-2 overflow-hidden rounded bg-muted"><div className="h-full bg-primary transition-[width]" style={{ width: `${pct}%` }} /></div>
                </div>
              )
            })}
          </div>
        )}
        {dl.error && (dl.restartFailed ? (
          <div className="mt-2 flex flex-wrap items-center gap-2.5">
            <p className="text-sm text-destructive">{dl.error}</p>
            <Button size="sm" variant="outline" onClick={() => void dl.restart()}>Restart the engine</Button>
          </div>
        ) : <p className="mt-2 text-sm text-destructive">{dl.error} — press Download to try again.</p>)}
        <p className="mt-2 text-xs text-muted-foreground">
          You can leave this page while it downloads — it keeps going. When it&apos;s done the engine restarts by itself to load the new models.
        </p>
      </Step>

      <Step n={4} title="Make your first picture" state={canGo ? 'active' : 'locked'}>
        <div className="flex flex-wrap items-center gap-3">
          <p className="min-w-[18rem] flex-1 rounded-lg border border-border bg-muted/40 px-3 py-2 text-[12.5px] text-muted-foreground">
            {target
              ? <>Opens Generate Image on <b className="text-foreground">{target.name}</b> with “{target.samplePrompt}” already filled in.</>
              : hasImageModel ? 'Opens Generate Image.' : 'Download a picture model first.'}
          </p>
          <Button className="h-10 px-5 text-sm font-bold" disabled={!canGo} onClick={() => go(false)}>Make my first picture →</Button>
          <Button className="h-10 px-5 text-sm" variant="outline" disabled={!canGo} onClick={() => go(true)}>Show me around first</Button>
        </div>
      </Step>
    </div>
  )
}

function Step({ n, title, state, children }: {
  n: number; title: string; state: 'done' | 'active' | 'idle' | 'locked'; children: React.ReactNode
}) {
  return (
    <section className={cn('grid grid-cols-[2.25rem_1fr] gap-3.5 rounded-2xl border border-border bg-card p-4', state === 'locked' && 'opacity-45')}>
      <span className={cn('grid h-8 w-8 place-items-center rounded-full text-sm font-bold',
        state === 'done' ? 'bg-green-500 text-background'
          : state === 'active' ? 'bg-gradient-to-br from-[#ffa64d] to-primary text-primary-foreground'
          : 'bg-muted text-muted-foreground')}>
        {state === 'done' ? <Check className="h-4 w-4" /> : n}
      </span>
      <div className="min-w-0">
        <h2 className="mb-2.5 mt-1 text-base font-semibold">{n} · {title}</h2>
        {children}
      </div>
    </section>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-muted/50 px-3 py-1.5">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="text-sm">{value}</p>
    </div>
  )
}

function Column({ group, hw, onDisk, ticked, locked, onToggle, onAdd }: {
  group: (typeof GROUPS)[number]; hw: Hardware | null; onDisk: Set<string> | null
  ticked: Set<string>; locked: boolean; onToggle: (id: string) => void; onAdd: () => void
}) {
  const models = STARTER_MODELS.filter((m) => m.group === group.id)
  const rec = hw ? recommendedFor(group.id, hw) : null
  const fits = models.filter((m) => !hw || !whyNot(m, hw)).sort((a, b) => Number(b.id === rec?.id) - Number(a.id === rec?.id))
  const tooBig = models.filter((m) => hw && whyNot(m, hw))
  const community = COMMUNITY_ROWS.filter((r) => r.group === group.id)
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-background/40">
      <div className="border-b border-border px-3 py-2.5">
        <h3 className="text-[15px] font-semibold">{group.title}</h3>
        <p className="text-xs text-muted-foreground">{group.blurb}</p>
      </div>
      {fits.map((m) => (
        <ModelRow key={m.id} m={m} hw={hw} onDisk={onDisk} rec={rec?.id === m.id} on={ticked.has(m.id)} locked={locked} onToggle={() => onToggle(m.id)} />
      ))}
      {community.map((r) => <CommunityModelRow key={r.id} row={r} onAdd={onAdd} />)}
      {fits.length === 0 && community.length === 0 && (
        <p className="px-3 py-2.5 text-xs text-muted-foreground">Nothing here fits this computer yet.</p>
      )}
      {tooBig.length > 0 && (
        <>
          <p className="border-y border-border bg-muted/30 px-3 py-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">Needs a bigger computer</p>
          {tooBig.map((m) => (
            <ModelRow key={m.id} m={m} hw={hw} onDisk={onDisk} rec={false} on={false} locked onToggle={() => {}} />
          ))}
        </>
      )}
    </div>
  )
}

function ModelRow({ m, hw, onDisk, rec, on, locked, onToggle }: {
  m: StarterModel; hw: Hardware | null; onDisk: Set<string> | null; rec: boolean; on: boolean; locked: boolean; onToggle: () => void
}) {
  const installed = !!onDisk && isInstalled(m, onDisk)
  const reason = hw ? whyNot(m, hw) : null
  const v = hw ? versionFor(m, hw) : null
  const sizeMb = (v ?? m.versions[0]).files.reduce((n, f) => n + f.sizeMb, 0)
  const checked = installed || on
  const disabled = installed || !!reason || locked || !v
  return (
    <button type="button" role="checkbox" aria-checked={checked} disabled={disabled} onClick={onToggle}
      className={cn('grid w-full grid-cols-[1.25rem_1fr_auto] items-start gap-2.5 border-b border-border px-3 py-2.5 text-left last:border-b-0',
        on && !installed && 'bg-primary/[0.07]', reason && 'opacity-50', !disabled && 'hover:bg-muted/40')}>
      <span className={cn('mt-0.5 grid h-5 w-5 place-items-center rounded-md border-2',
        installed ? 'border-green-500 bg-green-500 text-background'
          : on ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground')}>
        {checked && <Check className="h-3.5 w-3.5" />}
      </span>
      <span className="min-w-0">
        <span className="flex flex-wrap items-center gap-1.5 text-sm font-semibold">
          {m.name}
          {rec && <span className="rounded bg-gradient-to-r from-[#ffa64d] to-primary px-1.5 text-[10.5px] font-semibold text-primary-foreground">Recommended</span>}
          {installed && <span className="rounded bg-green-500/15 px-1.5 text-[10.5px] font-semibold text-green-500">Installed</span>}
        </span>
        <span className="mt-0.5 block text-[12.5px] text-muted-foreground">{m.blurb}</span>
        {v?.quant && <span className="mt-1 block text-xs text-sky-300">Compact version for your card (GGUF {v.quant})</span>}
        {reason && <span className="mt-1 block text-xs text-amber-400">{reason}</span>}
      </span>
      <span className="whitespace-nowrap text-xs tabular-nums text-muted-foreground">{fmtGb(sizeMb)} GB</span>
    </button>
  )
}

function CommunityModelRow({ row, onAdd }: { row: CommunityRow; onAdd: () => void }) {
  return (
    <div className="grid grid-cols-[1.25rem_1fr] gap-2.5 border-b border-border px-3 py-2.5 last:border-b-0">
      <span className="mt-0.5 h-5 w-5 rounded-md border-2 border-dashed border-muted-foreground/60" />
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-1.5 text-sm font-semibold">
          {row.name}
          <span className="rounded bg-sky-500/15 px-1.5 text-[10.5px] font-medium text-sky-300">from the community</span>
        </p>
        <p className="mt-0.5 text-[12.5px] text-muted-foreground">{row.blurb} These fit cards from 8 GB.</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {PORTAL_URL && <a href={PORTAL_URL} target="_blank" rel="noreferrer" className={chip}>Aria lineup on the Portal ↗</a>}
          <a href={CIVITAI_URL} target="_blank" rel="noreferrer" className={chip}>Browse Civitai ↗</a>
          <button type="button" onClick={onAdd} className={cn(chip, 'border-primary')}>Add a model file…</button>
        </div>
      </div>
    </div>
  )
}
