'use client'

import { useCallback, useEffect, useState } from 'react'
import { ScrollText, RefreshCw, Search, X } from 'lucide-react'
import type { LogLevel } from '@/lib/logging/logger'

interface LogEntry {
  ts: string
  level: LogLevel
  category: string
  message: string
  meta?: Record<string, unknown>
}

const LEVELS: { id: LogLevel | 'all'; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'debug', label: 'Debug' },
  { id: 'info', label: 'Info' },
  { id: 'warn', label: 'Warn' },
  { id: 'error', label: 'Error' },
]

const CATEGORIES = [
  'comfyui', 'comfyui-server', 'generation', 'status', 'nextjs', 'system', 'gallery',
]

// Level → colour token for the badge + row tint.
const LEVEL_STYLES: Record<LogLevel, string> = {
  debug: 'text-muted-foreground bg-muted/40',
  info: 'text-action bg-action/10',
  warn: 'text-[#ffa64d] bg-[#ffa64d]/10',
  error: 'text-destructive bg-destructive/10',
}

export default function LogsPage() {
  const [entries, setEntries] = useState<LogEntry[]>([])
  const [level, setLevel] = useState<LogLevel | 'all'>('all')
  const [category, setCategory] = useState<string>('all')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const [autoRefresh, setAutoRefresh] = useState(false)

  // `load` carries the current filters in its deps, so the effects below simply
  // depend on `load` — no ref juggling.
  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (level !== 'all') params.set('level', level)
      if (category !== 'all') params.set('category', category)
      if (search.trim()) params.set('search', search.trim())
      const res = await fetch(`/api/logs?${params}`, { cache: 'no-store' })
      const data = (await res.json()) as { entries?: LogEntry[] }
      // Newest first for quick scanning.
      setEntries((data.entries ?? []).slice().reverse())
    } catch {
      /* leave the last good list on a transient failure */
    } finally {
      setLoading(false)
    }
  }, [level, category, search])

  // Reload whenever a filter changes (debounced for the search box).
  useEffect(() => {
    const t = setTimeout(() => void load(), search ? 250 : 0)
    return () => clearTimeout(t)
  }, [load, search])

  // Optional live tail.
  useEffect(() => {
    if (!autoRefresh) return
    const id = setInterval(() => void load(), 3000)
    return () => clearInterval(id)
  }, [autoRefresh, load])

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header + filters */}
      <div className="shrink-0 border-b border-border bg-card/40 px-6 py-4 space-y-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/15 ring-1 ring-primary/25">
            <ScrollText className="h-5 w-5 text-primary" />
          </div>
          <div className="flex-1">
            <h1 className="font-heading text-xl font-bold tracking-tight leading-none">Logs</h1>
            <p className="text-xs text-muted-foreground mt-1">Recent application activity (last 7 days)</p>
          </div>
          <button
            type="button"
            onClick={() => setAutoRefresh((v) => !v)}
            className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
              autoRefresh ? 'border-primary/40 bg-primary/10 text-foreground' : 'border-border text-muted-foreground hover:bg-muted'
            }`}
          >
            {autoRefresh ? 'Live: on' : 'Live: off'}
          </button>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted disabled:opacity-60"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Level */}
          <div className="flex items-center gap-1 rounded-lg border border-border bg-muted/20 p-1">
            {LEVELS.map((l) => (
              <button
                key={l.id}
                type="button"
                onClick={() => setLevel(l.id)}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                  level === l.id ? 'bg-primary/15 text-foreground ring-1 ring-primary/30' : 'text-muted-foreground hover:bg-muted/50'
                }`}
              >
                {l.label}
              </button>
            ))}
          </div>

          {/* Category */}
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="h-8 rounded-lg border border-border bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="all">All categories</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>

          {/* Search */}
          <div className="relative flex-1 min-w-[12rem] max-w-md">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter messages…"
              className="h-8 w-full rounded-lg border border-border bg-background pl-8 pr-7 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <span className="ml-auto text-xs tabular-nums text-muted-foreground">{entries.length} entries</span>
        </div>
      </div>

      {/* Log list */}
      <div className="flex-1 overflow-y-auto px-6 py-3 font-mono text-xs">
        {entries.length === 0 ? (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            {loading ? 'Loading…' : 'No log entries match these filters.'}
          </div>
        ) : (
          <div className="space-y-0.5">
            {entries.map((e, i) => (
              <div
                key={`${e.ts}-${i}`}
                className="flex items-baseline gap-3 rounded-md px-2 py-1 hover:bg-muted/30"
              >
                <span className="shrink-0 tabular-nums text-muted-foreground/80">{e.ts.replace('T', ' ').replace('Z', '').slice(5, 23)}</span>
                <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${LEVEL_STYLES[e.level] ?? ''}`}>
                  {e.level}
                </span>
                <span className="shrink-0 text-primary/80">{e.category}</span>
                <span className="min-w-0 flex-1 break-words text-foreground/90">
                  {e.message}
                  {e.meta && Object.keys(e.meta).length > 0 && (
                    <span className="ml-2 text-muted-foreground/70">{JSON.stringify(e.meta)}</span>
                  )}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
