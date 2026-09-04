'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { FolderOpen, Loader2, Check, X } from 'lucide-react'
import type { ModelFolder } from '@/lib/models/detect-folder'

/** Everything ComfyUI's loaders read, in the order people reach for them. */
const FOLDERS = ['loras', 'checkpoints', 'diffusion_models', 'vae', 'text_encoders'] as const
type Folder = (typeof FOLDERS)[number]

interface Row { name: string; folder: Folder; status: 'importing' | 'done' | 'error'; error?: string }

/**
 * Import any LoRA or checkpoint from anywhere on disk.
 *
 * Replaces the Patreon-branded panel, which accepted a file only if its name
 * contained `muscgi`, `muscgro` or `aria`. That gate lived entirely on the
 * client — `/api/models/copy-local` has always accepted every model extension
 * and every folder in its allow-list — so lifting it needed no server change.
 *
 * `onBegin`/`onEnd` are the restart-prompt counter's pair, so a run of imports
 * asks to restart ComfyUI once, when the last one settles, alongside downloads.
 */
export default function ImportPanel({
  onBegin,
  onEnd,
}: {
  onBegin?: () => void
  onEnd?: (imported: boolean) => void
}) {
  const [rows, setRows] = useState<Row[]>([])
  const [override, setOverride] = useState<Folder | 'auto'>('auto')
  const [localPath, setLocalPath] = useState('')
  const [busy, setBusy] = useState(false)

  const patch = (name: string, p: Partial<Row>) =>
    setRows((prev) => prev.map((r) => (r.name === name ? { ...r, ...p } : r)))

  /**
   * Header-read destination, with the user's override winning when set. An
   * unreadable file falls back to `loras` — overwhelmingly the common import,
   * and the row shows the destination before anything is copied, so a wrong
   * guess is visible rather than silent.
   */
  const resolveFolder = async (sourcePath: string): Promise<Folder> => {
    if (override !== 'auto') return override
    try {
      const res = await fetch('/api/models/detect-folder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourcePath }),
      })
      const { folder } = (await res.json()) as { folder: ModelFolder | null }
      return folder ?? 'loras'
    } catch {
      return 'loras'
    }
  }

  const importFromPath = async (sourcePath: string) => {
    const name = sourcePath.split(/[/\\]/).pop() ?? sourcePath
    if (rows.some((r) => r.name === name && r.status === 'importing')) return

    setBusy(true)
    onBegin?.()
    const folder = await resolveFolder(sourcePath)
    setRows((prev) => [{ name, folder, status: 'importing' }, ...prev.filter((r) => r.name !== name)])

    try {
      const res = await fetch('/api/models/copy-local', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourcePath, subfolder: folder }),
      })
      const json = (await res.json()) as { replaced?: boolean; error?: string }
      if (!res.ok) throw new Error(json.error ?? res.statusText)
      patch(name, { status: 'done' })
      toast.success(`${name} ${json.replaced ? 'replaced' : 'imported'} into ${folder}/`)
      onEnd?.(true)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      patch(name, { status: 'error', error: msg })
      toast.error(`Could not import ${name}: ${msg}`)
      onEnd?.(false)
    } finally {
      setBusy(false)
    }
  }

  const browse = async () => {
    try {
      const res = await fetch('/api/models/pick-file', { method: 'POST' })
      const json = (await res.json()) as { path?: string | null; error?: string }
      if (!res.ok) throw new Error(json.error ?? res.statusText)
      if (json.path) void importFromPath(json.path) // null = the user cancelled
    } catch (e) {
      toast.error(`Could not open the file picker: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="px-4 py-3 border-b border-border">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
          Import models
        </h2>
        <p className="text-xs text-muted-foreground mt-1">
          Any LoRA or checkpoint, from anywhere on this machine. The destination is read from the
          file itself; override it below if you disagree.
        </p>
      </div>

      <div className="px-4 py-3 flex items-center gap-2 flex-wrap">
        <Button
          size="sm" variant="outline" className="h-8 gap-1.5"
          disabled={busy} onClick={() => void browse()}
        >
          <FolderOpen className="h-3.5 w-3.5" /> Browse…
        </Button>
        <input
          type="text"
          value={localPath}
          onChange={(e) => setLocalPath(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && localPath.trim()) {
              void importFromPath(localPath.trim())
              setLocalPath('')
            }
          }}
          placeholder="…or paste a full path and press Enter"
          className="h-8 flex-1 min-w-64 rounded-md border border-input bg-background px-3 text-xs font-mono placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-ring"
        />
        <select
          value={override}
          onChange={(e) => setOverride(e.target.value as Folder | 'auto')}
          className="h-8 rounded-md border border-input bg-background px-2 text-xs"
          aria-label="Destination folder"
        >
          <option value="auto">Detect automatically</option>
          {FOLDERS.map((f) => <option key={f} value={f}>{f}/</option>)}
        </select>
      </div>

      {rows.length > 0 && (
        <div className="px-4 pb-3 space-y-1">
          {rows.map((r) => (
            <div key={r.name} className="flex items-center gap-2 rounded-lg bg-muted/40 px-2.5 py-1.5">
              {r.status === 'importing' && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground shrink-0" />}
              {r.status === 'done' && <Check className="h-3.5 w-3.5 text-primary shrink-0" />}
              {r.status === 'error' && <X className="h-3.5 w-3.5 text-destructive shrink-0" />}
              <p className="text-xs font-mono truncate flex-1">{r.name}</p>
              <span className="text-[11px] text-muted-foreground shrink-0">
                {r.status === 'error' ? r.error : `→ ${r.folder}/`}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
