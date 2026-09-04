'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Trash2, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import type { LoraFamily } from '@/lib/models/lora-family'

interface DiskFile { name: string; path: string; sizeBytes: number; mtime: string }
interface DiskGroup { subfolder: string; files: DiskFile[]; sizeBytes: number; count: number }
interface DiskUsage {
  modelsDir: string | null
  total: { sizeBytes: number; count: number }
  subfolders: DiskGroup[]
}

const fmt = (n: number): string => {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)} GB`
  if (n >= 1024 ** 2) return `${Math.round(n / 1024 ** 2)} MB`
  // Bytes below 1 KB, not a rounded-to-zero "0 KB" — `krea2_projector_scale`
  // is a real 268-byte file and reading "0 KB" makes it look truncated.
  if (n >= 1024) return `${Math.round(n / 1024)} KB`
  return `${n} B`
}

/**
 * Everything installed, by folder, with delete.
 *
 * Both endpoints already existed: `/api/models/disk-usage` for the files and
 * `/api/models/lora-arch` for the family badge — which means a badge is **read
 * out of each file's safetensors header**, never guessed from its name. That
 * matters because a Civitai download lands as whatever the uploader called it.
 */
export default function LibraryGrid() {
  const [usage, setUsage] = useState<DiskUsage | null>(null)
  const [families, setFamilies] = useState<Record<string, LoraFamily | null>>({})
  const [folder, setFolder] = useState('loras')
  const [filter, setFilter] = useState('')
  const [family, setFamily] = useState<LoraFamily | 'all'>('all')
  const [pending, setPending] = useState<DiskFile | null>(null)
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const [u, f] = await Promise.all([
        fetch('/api/models/disk-usage', { cache: 'no-store' }).then((r) => r.json() as Promise<DiskUsage>),
        fetch('/api/models/lora-arch').then(
          (r) => r.json() as Promise<{ families: Record<string, LoraFamily | null> }>,
        ),
      ])
      setUsage(u)
      setFamilies(f.families ?? {})
    } catch {
      toast.error('Could not read what is installed')
    } finally {
      setLoading(false)
    }
  }, [])

  // eslint-disable-next-line react-hooks/set-state-in-effect -- load what is on disk once on mount
  useEffect(() => { void refresh() }, [refresh])

  const doDelete = async (file: DiskFile) => {
    try {
      const res = await fetch('/api/models/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: file.path }),
      })
      if (!res.ok) throw new Error(await res.text())
      toast.success(`Deleted ${file.name}`)
      await refresh()
    } catch (e) {
      toast.error(`Could not delete ${file.name}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const group = usage?.subfolders.find((g) => g.subfolder === folder)
  const inFolder = group?.files ?? []

  /**
   * Families actually present in this folder, so the picker never offers one
   * that would empty the grid. Derived rather than listed: the badge is read
   * from each safetensors header, so only what is genuinely installed appears —
   * and folders the classifier does not cover (checkpoints, vae) simply get no
   * picker instead of a dead control.
   */
  const presentFamilies = [...new Set(
    inFolder.map((f) => families[f.name]).filter((x): x is LoraFamily => !!x),
  )].sort()

  const files = inFolder.filter((f) =>
    f.name.toLowerCase().includes(filter.toLowerCase()) &&
    (family === 'all' || families[f.name] === family),
  )

  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border flex-wrap">
        <select
          value={folder}
          // Reset the family: the folder you switch to rarely holds the family
          // you were filtering by, and a stale one shows an empty grid that
          // reads as "nothing installed here".
          onChange={(e) => { setFolder(e.target.value); setFamily('all') }}
          className="h-8 rounded-md border border-input bg-background px-2 text-xs"
          aria-label="Folder"
        >
          {(usage?.subfolders ?? []).map((g) => (
            <option key={g.subfolder} value={g.subfolder}>{g.subfolder}/ ({g.count})</option>
          ))}
        </select>

        {presentFamilies.length > 1 && (
          <select
            value={family}
            onChange={(e) => setFamily(e.target.value as LoraFamily | 'all')}
            className="h-8 rounded-md border border-input bg-background px-2 text-xs uppercase"
            aria-label="Base model"
          >
            <option value="all">All base models</option>
            {presentFamilies.map((f) => (
              <option key={f} value={f}>
                {f} ({inFolder.filter((x) => families[x.name] === f).length})
              </option>
            ))}
          </select>
        )}
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter installed…"
          className="h-8 flex-1 min-w-48 rounded-md border border-input bg-background px-3 text-xs"
        />
        <span className="text-xs text-muted-foreground tabular-nums">
          {usage ? `${fmt(usage.total.sizeBytes)} · ${usage.total.count} files` : ''}
        </span>
        <Button
          size="sm" variant="outline" className="h-8 gap-1.5"
          disabled={loading} onClick={() => void refresh()}
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </Button>
      </div>

      {/* `usage === null` is "not answered yet", NOT "not configured". Reading a
          null `usage` as a missing models dir made every mount flash a
          configuration error at people whose setup is fine — invisible while
          this lived behind the Civitai connect gate and mounted once, obvious
          the moment it became a tab you switch back to. */}
      {usage === null ? (
        <p className="text-sm text-muted-foreground py-10 text-center">Reading what is installed…</p>
      ) : !usage.modelsDir ? (
        <p className="text-xs text-primary p-4">
          Set <code>COMFYUI_MODELS_DIR</code> in <code>.env.local</code> to enable this.
        </p>
      ) : files.length === 0 ? (
        <p className="text-sm text-muted-foreground py-10 text-center">Nothing here yet.</p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 p-4">
          {files.map((f) => (
            <div key={f.path} className="rounded-lg border border-border bg-background p-3 flex flex-col gap-2">
              <p className="text-xs font-mono break-all line-clamp-3" title={f.name}>{f.name}</p>
              <div className="flex items-center gap-2 mt-auto">
                {families[f.name] && (
                  <span className="text-[10px] font-mono uppercase rounded border border-border bg-muted px-1.5 py-0.5">
                    {families[f.name]}
                  </span>
                )}
                <span className="text-[11px] text-muted-foreground tabular-nums">{fmt(f.sizeBytes)}</span>
                <button
                  className="ml-auto text-destructive/80 hover:text-destructive"
                  title={`Delete ${f.name}`}
                  onClick={() => setPending(f)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(v) => { if (!v) setPending(null) }}
        title={pending ? `Delete ${pending.name}?` : ''}
        description={pending ? `This permanently removes ${fmt(pending.sizeBytes)} from disk and cannot be undone.` : ''}
        confirmLabel="Delete"
        destructive
        onConfirm={() => { if (pending) void doDelete(pending); setPending(null) }}
      />
    </div>
  )
}
