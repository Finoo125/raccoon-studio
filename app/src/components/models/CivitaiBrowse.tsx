'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Search, ArrowLeft, Download, Check, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  folderForType, stillImages, CIVITAI_SORTS, CIVITAI_BASE_MODELS, type CivitaiModel,
} from '@/lib/civitai/types'
import type { Transfer } from '@/lib/models/transfers'

/** Civitai descriptions are third-party HTML. Flatten to text — never render
 *  them with dangerouslySetInnerHTML. */
const asText = (html: string | null): string =>
  (html ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()

const fmtMB = (kb: number): string =>
  kb >= 1024 * 1024 ? `${(kb / 1024 / 1024).toFixed(1)} GB` : `${Math.round(kb / 1024)} MB`

const fmtBytes = (n: number): string =>
  n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(1)} GB` : `${Math.round(n / 1024 ** 2)} MB`

/**
 * Browse Civitai and download into ComfyUI. Layout A: a card grid, and clicking
 * a card replaces the grid with a detail view.
 *
 * Every call goes through `/api/civitai/*` rather than straight to Civitai, so
 * the OAuth token stays on the server and one entitlement check covers the whole
 * surface.
 */
export default function CivitaiBrowse({
  activeTransfers = [],
  onStarted,
}: {
  activeTransfers?: Transfer[]
  onStarted?: (t: Transfer) => void
}) {
  const [query, setQuery] = useState('')
  const [types, setTypes] = useState('LORA')
  const [items, setItems] = useState<CivitaiModel[]>([])
  const [selected, setSelected] = useState<CivitaiModel | null>(null)
  const [installed, setInstalled] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)
  /** Cursor for the next page; absent once Civitai stops offering one. */
  const [cursor, setCursor] = useState<string>()
  /** Civitai's own default ordering is by download count. */
  const [sort, setSort] = useState<string>('Most Downloaded')
  /** '' = every base model. */
  const [base, setBase] = useState<string>('')

  /**
   * Which search is the current one.
   *
   * Two searches are routinely in flight at once — StrictMode double-invokes the
   * mount effect, and typing then pressing Enter starts another before the first
   * lands. Without this the *slower* response wins, so a stale default listing
   * can overwrite the results you just asked for, which reads as "search does
   * nothing". Measured 2026-08-27: the mount effect fires two identical Civitai
   * calls every time.
   */
  const runId = useRef(0)

  // Filenames already on disk, so a version you have shows as installed instead
  // of offering a redundant download.
  const loadInstalled = useCallback(async () => {
    try {
      const u = await fetch('/api/models/disk-usage', { cache: 'no-store' })
        .then((r) => r.json() as Promise<{ subfolders: { files: { name: string }[] }[] }>)
      setInstalled(new Set(u.subfolders.flatMap((g) => g.files.map((f) => f.name))))
    } catch { /* the badge is a nicety; browsing works without it */ }
  }, [])

  /**
   * Run a search. `more` appends the next cursor page instead of replacing.
   *
   * `types` is passed in rather than read from state so the type picker can
   * search with the value it just set, without waiting a render for it.
   */
  const search = useCallback(async (
    opts: { more?: boolean; types?: string; sort?: string; base?: string } = {},
  ) => {
    const mine = ++runId.current
    setLoading(true)
    try {
      const p = new URLSearchParams({ types: opts.types ?? types })
      if (query) p.set('query', query)
      // `?? sort` rather than `|| sort`, so a filter cleared to '' this render
      // is honoured instead of falling back to the value it just replaced.
      const s = opts.sort ?? sort
      const b = opts.base ?? base
      if (s) p.set('sort', s)
      if (b) p.set('baseModels', b)
      if (opts.more && cursor) p.set('cursor', cursor)
      const res = await fetch(`/api/civitai/search?${p.toString()}`)
      const j = (await res.json()) as
        { items?: CivitaiModel[]; nextCursor?: string; error?: string }
      if (mine !== runId.current) return // superseded — drop it silently
      if (!res.ok) throw new Error(j.error ?? res.statusText)
      // Dedupe on append: a cursor page can repeat a model when the underlying
      // ordering shifts between requests, and React would warn on the key.
      setItems((prev) => {
        if (!opts.more) return j.items ?? []
        const seen = new Set(prev.map((m) => m.id))
        return [...prev, ...(j.items ?? []).filter((m) => !seen.has(m.id))]
      })
      setCursor(j.nextCursor)
      setSearched(true)
    } catch (e) {
      if (mine !== runId.current) return
      // Keep the previous results on screen. Blanking the grid on a transient
      // failure says "there is nothing", which is a different message entirely.
      toast.error(`Civitai search failed: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      if (mine === runId.current) setLoading(false)
    }
  }, [query, types, sort, base, cursor])

  /** StrictMode double-invokes the mount effect, and `runId` only decides which
   *  RESPONSE wins — both requests are still sent. This stops the second one
   *  leaving the browser at all. */
  const mounted = useRef(false)

  useEffect(() => {
    if (mounted.current) return
    mounted.current = true
    void search()
    void loadInstalled()
    // Deliberately once: `search` changes with every keystroke, and re-running
    // on each would hammer Civitai. The button and Enter drive it after this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** A download that just landed makes the installed set stale, and the badge
   *  it drives would otherwise revert to a Download button once the server
   *  stops retaining the finished transfer. */
  const settled = activeTransfers.filter((t) => t.status === 'done').length
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetches, then refreshes the installed set
    if (settled) void loadInstalled()
  }, [settled, loadInstalled])

  const download = async (m: CivitaiModel, versionId: number, filename: string) => {
    const folder = folderForType(m.type)
    try {
      const res = await fetch('/api/civitai/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ versionId, filename, folder }),
      })
      const j = (await res.json()) as { ok?: boolean; transfer?: Transfer; error?: string }
      if (!res.ok || !j.transfer) throw new Error(j.error ?? res.statusText)

      if (j.transfer.status === 'done') {
        toast.info(`${filename} is already on disk`)
      } else {
        toast.info(`Downloading ${filename} into ${folder}/…`)
      }
      // The POST returns the moment the server job is registered, NOT when the
      // bytes land — so the page only arms the restart prompt here and its poll
      // decides when the transfer actually settled.
      onStarted?.(j.transfer)
    } catch (e) {
      toast.error(`Could not start download: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const cancel = async (key: string) => {
    try {
      await fetch('/api/models/download/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key }),
      })
    } catch (e) {
      toast.error(`Could not cancel: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  /**
   * The live transfer for a file, if one is running or just settled.
   *
   * Matched on folder *and* name, because a transfer's identity is `dir/name` —
   * a LoRA and a checkpoint sharing a basename would otherwise drive each
   * other's progress bar.
   */
  const transferFor = (folder: string, filename: string): Transfer | undefined =>
    activeTransfers.find((t) => t.dir === folder && t.name === filename)

  if (selected) {
    const dest = folderForType(selected.type)
    return (
      <div className="rounded-lg border border-border bg-card">
        <button
          className="flex items-center gap-2 px-4 py-3 border-b border-border text-xs text-muted-foreground w-full text-left"
          onClick={() => setSelected(null)}
        >
          <ArrowLeft className="h-3.5 w-3.5 text-primary" /> Back to results
        </button>

        <div className="grid lg:grid-cols-2 gap-5 p-4">
          <div className="grid grid-cols-2 gap-2 self-start">
            {stillImages(selected.modelVersions[0]?.images ?? []).slice(0, 4).map((img) => (
              // Plain <img>: next.config.ts declares no `images` config, so
              // next/image would fail on a remote host.
              // eslint-disable-next-line @next/next/no-img-element
              <img key={img.url} src={img.url} alt="" className="rounded-lg w-full object-cover" />
            ))}
          </div>

          <div>
            <h3 className="font-heading font-bold text-lg">{selected.name}</h3>
            <p className="text-xs text-muted-foreground mt-1 mb-3">
              by {selected.creator?.username ?? 'unknown'} · {selected.type}
              {selected.stats ? ` · ${selected.stats.downloadCount.toLocaleString()} downloads` : ''}
            </p>
            <p className="text-sm text-muted-foreground mb-4 line-clamp-6">
              {asText(selected.description)}
            </p>

            <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-2">
              Versions
            </p>
            <div className="space-y-1.5">
              {selected.modelVersions.map((v) => {
                const file = v.files.find((f) => f.type === 'Model') ?? v.files[0]
                const have = file ? installed.has(file.name) : false
                return (
                  <div
                    key={v.id}
                    className="flex items-center gap-3 rounded-lg border border-border bg-background px-3 py-2"
                  >
                    <span className="text-xs font-semibold w-16 shrink-0">{v.name}</span>
                    <span className="text-[11px] text-muted-foreground flex-1 truncate">{v.baseModel}</span>
                    <span className="text-[11px] text-muted-foreground tabular-nums shrink-0">
                      {file ? fmtMB(file.sizeKB) : '—'}
                    </span>
                    {(() => {
                      const tr = file ? transferFor(dest, file.name) : undefined
                      if (tr && tr.status === 'running') {
                        return (
                          <span className="flex items-center gap-2 shrink-0 w-52">
                            <span className="h-1.5 flex-1 rounded-full bg-muted overflow-hidden">
                              <span
                                className="block h-full bg-primary transition-[width] duration-300"
                                style={{ width: `${tr.value}%` }}
                              />
                            </span>
                            <span className="text-[10px] font-mono text-muted-foreground tabular-nums">
                              {tr.totalBytes
                                ? `${fmtBytes(tr.receivedBytes)}/${fmtBytes(tr.totalBytes)}`
                                : fmtBytes(tr.receivedBytes)}
                            </span>
                            {/* A multi-gigabyte checkpoint started by mistake had
                                no stop control in this pane at all. */}
                            <button
                              className="text-muted-foreground hover:text-destructive shrink-0"
                              title={`Cancel ${tr.name}`}
                              onClick={() => void cancel(tr.key)}
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </span>
                        )
                      }
                      if (have || tr?.status === 'done') {
                        return (
                          <span className="text-[11px] text-primary flex items-center gap-1 shrink-0">
                            <Check className="h-3 w-3" /> Installed
                          </span>
                        )
                      }
                      return (
                        <Button
                          size="sm" className="h-7 text-[11px] shrink-0" disabled={!file}
                          onClick={() => file && void download(selected, v.id, file.name)}
                        >
                          <Download className="h-3 w-3 mr-1" /> Download
                        </Button>
                      )
                    })()}
                  </div>
                )
              })}
            </div>

            <p className="text-[11px] font-mono text-muted-foreground mt-3">
              Saves to <span className="text-primary">models/{dest}/</span> · you will be asked to
              restart ComfyUI when downloads finish
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border flex-wrap">
        <div className="flex items-center gap-2 flex-1 min-w-48 rounded-md border border-input bg-background px-3 h-8">
          <Search className="h-3.5 w-3.5 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { setCursor(undefined); void search() } }}
            placeholder="Search Civitai…"
            className="flex-1 bg-transparent text-xs focus:outline-none"
          />
        </div>
        <select
          value={types}
          onChange={(e) => {
            // Search immediately: leaving the old results up under a changed
            // filter shows LoRAs to someone who just asked for checkpoints, and
            // every card's destination folder is then wrong for what they picked.
            setTypes(e.target.value)
            setCursor(undefined)
            void search({ types: e.target.value })
          }}
          className="h-8 rounded-md border border-input bg-background px-2 text-xs"
          aria-label="Type"
        >
          {/* One value per option, never a comma-joined list: `types=LORA,LoCon`
              is accepted and returns ZERO items, which reads as "nothing
              matched". LoCon and DoRA are adapters and land in loras/ like a
              LoRA; LyCORIS is not a Civitai type at all (their API ZodErrors on
              it), so it is deliberately absent. */}
          <option value="LORA">LoRA</option>
          <option value="LoCon">LoCon</option>
          <option value="DoRA">DoRA</option>
          <option value="Checkpoint">Checkpoint</option>
        </select>
        <select
          value={base}
          onChange={(e) => {
            setBase(e.target.value)
            setCursor(undefined)
            void search({ base: e.target.value })
          }}
          className="h-8 rounded-md border border-input bg-background px-2 text-xs max-w-44"
          aria-label="Base model"
        >
          <option value="">All base models</option>
          {CIVITAI_BASE_MODELS.map((g) => (
            <optgroup key={g.group} label={g.group}>
              {g.models.map((m) => <option key={m} value={m}>{m}</option>)}
            </optgroup>
          ))}
        </select>

        <select
          value={sort}
          onChange={(e) => {
            setSort(e.target.value)
            setCursor(undefined)
            void search({ sort: e.target.value })
          }}
          className="h-8 rounded-md border border-input bg-background px-2 text-xs"
          aria-label="Sort"
        >
          {CIVITAI_SORTS.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>

        <Button
          size="sm" className="h-8" disabled={loading}
          onClick={() => { setCursor(undefined); void search() }}
        >
          Search
        </Button>
      </div>

      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground py-10 text-center">
          {loading ? 'Searching…' : searched ? 'No models matched.' : ''}
        </p>
      ) : (
        <>
        {/* Eight across at full width. The card text shrinks with the column,
            so the name gets two lines and the meta line one — anything more and
            the tiles stop being scannable at this density. */}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-2 p-4">
          {items.map((m) => {
            const img = stillImages(m.modelVersions[0]?.images ?? [])[0]?.url
            return (
              <button
                key={m.id}
                onClick={() => setSelected(m)}
                className="rounded-lg border border-border bg-background overflow-hidden text-left hover:border-primary/50 focus:outline-none focus:ring-1 focus:ring-ring"
              >
                <div className="aspect-[3/4] bg-muted">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {img && <img src={img} alt="" className="w-full h-full object-cover" />}
                </div>
                <div className="p-2">
                  <p className="text-[11px] font-semibold leading-tight line-clamp-2">{m.name}</p>
                  <p className="text-[9px] font-mono text-muted-foreground mt-1 truncate">
                    {m.modelVersions[0]?.baseModel} · {m.modelVersions.length} ver
                  </p>
                </div>
              </button>
            )
          })}
        </div>
        {/* Civitai paginates by cursor, not page number, so "more" is the only
            direction available — and without this the grid stopped dead at 24
            results that looked like the whole answer. */}
        {cursor && (
          <div className="px-4 pb-4">
            <Button
              variant="outline" size="sm" className="w-full h-8 text-xs"
              disabled={loading}
              onClick={() => void search({ more: true })}
            >
              {loading ? 'Loading…' : 'Load more'}
            </Button>
          </div>
        )}
        </>
      )}
    </div>
  )
}
