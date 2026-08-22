'use client'

import { useEffect, useRef, useState } from 'react'
import { DownloadCloud, UploadCloud, Loader2, HardDriveDownload, ShieldAlert, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import { useKiosk } from '@/app/providers'
import { restartComfyUI } from '@/lib/comfyui/restart'
import type { BackupJob } from '@/lib/backup/job'

interface InspectResult {
  manifest: {
    createdAt: string
    platform: string
    includesModels: boolean
    components: Array<{ id: string; label: string; files: number; bytes: number }>
  }
  sizeBytes: number
  hasChecksum: boolean
}

/** Current server-side job; `undefined` on a transient fetch failure (keep the last known state). */
async function fetchJob(): Promise<BackupJob | null | undefined> {
  try {
    const res = await fetch('/api/backup/job', { cache: 'no-store' })
    return ((await res.json()) as { job: BackupJob | null }).job
  } catch {
    return undefined
  }
}

/**
 * Tools-tab panel: snapshot the whole studio (gallery media, favorites/tags,
 * movie projects, settings, optionally models) into one uncompressed .tar, and
 * restore it into a fresh install. Jobs run server-side and are followed by
 * polling /api/backup/job, so a backup keeps going — and the panel reattaches —
 * across tab closes and reloads.
 */
export default function BackupRestore() {
  const kiosk = useKiosk()
  /** Upload percent while an archive is being sent up to a pod, else null. */
  const [uploading, setUploading] = useState<number | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const [includeModels, setIncludeModels] = useState(false)
  const [deleteAfter, setDeleteAfter] = useState(false)
  const [job, setJob] = useState<BackupJob | null>(null)
  const [starting, setStarting] = useState(false)
  // Delete-after confirmation holds the picked destination until confirmed.
  const [confirmDest, setConfirmDest] = useState<string | null>(null)
  // Restore preview holds the picked archive + its manifest until confirmed.
  const [preview, setPreview] = useState<(InspectResult & { srcPath: string }) | null>(null)
  // Offered once a restore lands: restored models + shared-model paths are only
  // read by ComfyUI at startup.
  const [restartOpen, setRestartOpen] = useState(false)

  const running = job?.status === 'running'
  // An upload counts as busy: it ends in a restore, and starting a second one
  // mid-transfer would fight over the same staged file.
  const busy = running || starting || uploading !== null

  // Reattach to an in-flight (or just-finished) job on mount.
  useEffect(() => {
    void fetchJob().then((j) => { if (j !== undefined) setJob(j) })
  }, [])

  // Poll while a job is running.
  useEffect(() => {
    if (!running) return
    const t = setInterval(() => {
      void fetchJob().then((j) => { if (j !== undefined) setJob(j) })
    }, 600)
    return () => clearInterval(t)
  }, [running])

  // Fire completion toasts exactly once, on the running → finished transition.
  const prevStatus = useRef<BackupJob['status'] | null>(null)
  useEffect(() => {
    const status = job?.status ?? null
    if (prevStatus.current === 'running' && job && status !== 'running') {
      if (job.status === 'done' && job.kind === 'backup') {
        const churn = job.changedDuringBackup ?? 0
        toast.success(
          `Backup complete — ${job.totalFiles ?? 0} files saved${job.deleted ? ', originals deleted' : ''}.` +
          (churn > 0 ? ` ${churn} file${churn === 1 ? '' : 's'} changed during the backup and ${churn === 1 ? 'was' : 'were'} not archived.` : ''),
        )
      } else if (job.status === 'done' && job.kind === 'restore') {
        const skippedNote = job.skipped && job.skipped.length > 0 ? ` (${job.skipped.length} unknown skipped)` : ''
        toast.success(`Restore complete — ${job.restoredCount ?? 0} sections restored${skippedNote}.`)
        if (job.settingsWarning) toast.warning(job.settingsWarning)
        // Reacting to an external system (the polled server job) crossing into
        // "done", exactly like the toasts above — not derived render state.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setRestartOpen(true)
      } else if (job.status === 'cancelled') {
        toast.info('Backup cancelled — the partial archive was removed.')
      } else if (job.status === 'error') {
        toast.error(`${job.kind === 'backup' ? 'Backup' : 'Restore'} failed: ${job.error ?? 'Unknown error'}`)
      }
    }
    prevStatus.current = status
  }, [job])

  async function startJob(url: string, payload: unknown) {
    setStarting(true)
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = (await res.json()) as { job?: BackupJob; error?: string }
      if (!res.ok || !data.job) {
        toast.error(data.error ?? 'Could not start the job.')
        return
      }
      prevStatus.current = 'running'
      setJob(data.job)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setStarting(false)
    }
  }

  async function backup() {
    // On a hosted pod there is no desktop for the native dialog to open on, and
    // it would be choosing a path on the server anyway — the person is in a
    // browser somewhere else entirely. Asking produced "No native file dialog
    // found. Install zenity or kdialog.", which reads as a missing package when
    // the real answer is that the question does not apply. So: let the server
    // name the file, and download it when the job finishes.
    if (kiosk) {
      // '' rather than a path: the confirm dialog opens on `!== null`, and the
      // destination genuinely is not known yet.
      if (deleteAfter) { setConfirmDest(''); return }
      await startJob('/api/backup/create', { includeModels, deleteAfter: false })
      return
    }

    // Choose the destination with a native "save as" dialog.
    const pick = await fetch('/api/backup/pick-save', { method: 'POST' })
    const { path, error } = (await pick.json()) as { path?: string | null; error?: string }
    if (error) { toast.error(error); return }
    if (!path) return // cancelled

    if (deleteAfter) {
      setConfirmDest(path)
      return
    }
    await startJob('/api/backup/create', { destPath: path, includeModels, deleteAfter: false })
  }

  /**
   * Send the chosen archive up to the pod, then hand its server-side path to
   * the normal restore flow.
   *
   * Chunked deliberately: RunPod's edge 413s any body over ~500 MiB, before our
   * code sees it, and a backup with gallery media clears that easily. 64 MiB
   * keeps every request far under the ceiling and gives a usable progress
   * readout on what can be a long upload.
   */
  async function uploadAndPreview(file: File) {
    const CHUNK = 64 * 1024 * 1024
    setUploading(0)
    let serverPath = ''
    try {
      for (let offset = 0; offset < file.size; offset += CHUNK) {
        const res = await fetch(
          `/api/backup/upload?name=${encodeURIComponent(file.name)}&offset=${offset}`,
          { method: 'POST', body: file.slice(offset, offset + CHUNK) },
        )
        const data = (await res.json()) as { path?: string; size?: number; error?: string }
        if (!res.ok) throw new Error(data.error ?? `Upload failed (HTTP ${res.status})`)
        serverPath = data.path ?? serverPath
        setUploading(Math.round(((offset + CHUNK) / file.size) * 100))
      }
      // Size is the cheap end-to-end check that every chunk landed: a truncated
      // upload would otherwise only surface as a confusing tar error, partway
      // into a restore that has already started overwriting things.
      const sizeRes = await fetch(`/api/backup/upload?name=${encodeURIComponent(file.name)}&offset=${file.size}`, {
        method: 'POST', body: new Blob([]),
      })
      const sized = (await sizeRes.json()) as { size?: number; error?: string }
      if (sized.size !== file.size) {
        throw new Error(`Upload incomplete — ${sized.size ?? 0} of ${file.size} bytes arrived.`)
      }
      await inspectAndPreview(serverPath)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setUploading(null)
    }
  }

  async function inspectAndPreview(srcPath: string) {
    const res = await fetch('/api/backup/inspect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ srcPath }),
    })
    const data = (await res.json()) as (InspectResult & { error?: string })
    if (!res.ok) { toast.error(data.error ?? 'Could not read the backup.'); return }
    setPreview({ ...data, srcPath })
  }

  async function restore() {
    // On a pod the "open file" dialog would open on the server, which has no
    // desktop — the same reason "save as" could not be used for backup. The
    // archive comes up from the user's own machine instead.
    if (kiosk) { fileInput.current?.click(); return }

    const pick = await fetch('/api/backup/pick-file', { method: 'POST' })
    const { path, error } = (await pick.json()) as { path?: string | null; error?: string }
    if (error) { toast.error(error); return }
    if (!path) return

    // Show what the archive actually contains before touching anything.
    await inspectAndPreview(path)
  }

  async function cancel() {
    await fetch('/api/backup/cancel', { method: 'POST' })
    const j = await fetchJob()
    if (j !== undefined) setJob(j)
  }

  const statusText = !job ? '' : job.status === 'running'
    ? phaseLabel(job.phase, job.label) +
      (job.filesTotal ? ` — file ${(job.filesDone ?? 0).toLocaleString()} / ${job.filesTotal.toLocaleString()}` : '')
    // A pod's path is on the server, so quoting it tells the user nothing about
    // where their backup *is* — it is still in the container. Point at the
    // download instead, and say the archive is safe on the volume meanwhile.
    : job.status === 'done' && job.kind === 'backup' && kiosk
      ? 'Backup ready — saved on this pod’s volume. Download it to keep a copy.'
    : job.status === 'done' && job.kind === 'backup' ? `Saved to ${job.destPath}`
    : job.status === 'done' ? 'Restore complete. Restart the app if pages look stale.'
    : job.status === 'cancelled' ? 'Backup cancelled.'
    : `Failed: ${job.error ?? 'Unknown error'}`

  return (
    // No header of its own: this panel has a page now, and that page's header
    // already names it. It kept one when it was a card among others on Tools.
    <div className="rounded-2xl border border-border bg-card p-5 space-y-4">
      {/* Options */}
      <div className="space-y-2.5 rounded-xl border border-border bg-muted/20 p-4">
        <label className="flex items-start gap-2.5 text-sm">
          <input
            type="checkbox"
            checked={includeModels}
            onChange={(e) => setIncludeModels(e.target.checked)}
            disabled={busy}
            className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
          />
          <span>
            <span className="font-semibold">Include models</span>
            <span className="block text-xs text-muted-foreground">
              Adds every file under your models folder. Can be tens of GB and take a while.
            </span>
          </span>
        </label>

        <label className="flex items-start gap-2.5 text-sm">
          <input
            type="checkbox"
            checked={deleteAfter}
            onChange={(e) => setDeleteAfter(e.target.checked)}
            disabled={busy}
            className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
          />
          <span>
            <span className="font-semibold text-amber-400">Delete originals after a verified backup</span>
            <span className="block text-xs text-muted-foreground">
              Frees space for a clean reinstall by wiping gallery media{includeModels ? ' and models' : ''} once the
              archive passes validation. Settings, tags and projects are kept.
            </span>
          </span>
        </label>
      </div>

      {/* Actions */}
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        <button
          type="button"
          onClick={() => void backup()}
          disabled={busy}
          className="flex items-center justify-center gap-2 rounded-xl bg-gradient-to-b from-[#ffa64d] to-[#f5811e] px-4 py-2.5 text-sm font-bold text-primary-foreground shadow-lg shadow-primary/25 transition-shadow hover:shadow-primary/40 disabled:opacity-50 disabled:shadow-none"
        >
          {running && job?.kind === 'backup' ? <Loader2 className="h-4 w-4 animate-spin" /> : <DownloadCloud className="h-4 w-4" />}
          Create backup…
        </button>
        <button
          type="button"
          onClick={() => void restore()}
          disabled={busy}
          className="flex items-center justify-center gap-2 rounded-xl border border-border bg-background px-4 py-2.5 text-sm font-semibold hover:bg-muted disabled:opacity-50"
        >
          {running && job?.kind === 'restore' ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
          Restore…
        </button>
      </div>

      {/* Upload progress — its own row, because it happens BEFORE any job
          exists and so has nothing to report through the job poll. */}
      {uploading !== null && (
        <div className="space-y-1.5">
          <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-gradient-to-r from-[#ffa64d] to-[#f5811e] transition-[width] duration-200"
              style={{ width: `${Math.min(uploading, 100)}%` }}
            />
          </div>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <UploadCloud className="h-3.5 w-3.5 shrink-0 text-primary" />
            <span className="flex-1 truncate">Uploading backup to this pod — {Math.min(uploading, 100)}%</span>
          </div>
        </div>
      )}

      {/* Progress */}
      {job && (
        <div className="space-y-1.5">
          <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-gradient-to-r from-[#ffa64d] to-[#f5811e] transition-[width] duration-200"
              style={{ width: `${job.status === 'running' ? job.value : 100}%` }}
            />
          </div>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <HardDriveDownload className="h-3.5 w-3.5 shrink-0 text-primary" />
            <span className="flex-1 truncate">{statusText}</span>
            {running && job.kind === 'backup' && (
              <button
                type="button"
                onClick={() => void cancel()}
                className="flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-destructive hover:bg-destructive/10"
              >
                <XCircle className="h-3.5 w-3.5" />
                Cancel
              </button>
            )}
            {/* A plain link, not a fetch: the browser streams it straight to
                disk with a progress bar of its own, where reading a multi-GB
                archive into JS first would blow the tab's memory. */}
            {kiosk && job.status === 'done' && job.kind === 'backup' && (
              <a
                href="/api/backup/download"
                className="flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-primary hover:bg-primary/10"
              >
                <DownloadCloud className="h-3.5 w-3.5" />
                Download
              </a>
            )}
          </div>
        </div>
      )}

      {/* The icon is a flex item; the prose is not. As one flex container the
          inline <span>s each became their own column and the sentence broke
          into ragged blocks — only obvious once this panel had a page to
          itself and room to be wide. */}
      <div className="flex items-start gap-1.5">
        <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
        <p className="text-xs text-muted-foreground">
          Backups are a single uncompressed <span className="font-medium text-foreground">.tar</span> written to the
          location you choose, with a matching <span className="font-medium text-foreground">.sha256</span> checked on
          restore. Backups keep running even if you close this page — come back any time to check on them.
        </p>
      </div>

      {/* The pod's stand-in for the native open dialog. Hidden and driven by
          the Restore button so the button keeps behaving identically on both. */}
      <input
        ref={fileInput}
        type="file"
        accept=".tar"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          // Cleared so choosing the SAME file twice still fires onChange —
          // otherwise a failed upload cannot be retried without picking
          // something else first.
          e.target.value = ''
          if (f) void uploadAndPreview(f)
        }}
      />

      {/* Delete-after confirmation */}
      <ConfirmDialog
        open={confirmDest !== null}
        onOpenChange={(v) => { if (!v) setConfirmDest(null) }}
        title="Delete originals after backup?"
        description={
          `After the backup is verified, the original gallery media${includeModels ? ' and models' : ''} will be ` +
          'permanently deleted to free space. Settings, tags and projects are kept.'
        }
        confirmLabel="Back up & delete"
        destructive
        onConfirm={() => {
          const dest = confirmDest
          // `!== null`, not truthiness: on a pod the destination is '' because
          // the server picks it, and a truthy check would silently do nothing —
          // the worst outcome here, since the user asked to delete originals.
          if (dest !== null) {
            void startJob('/api/backup/create', {
              destPath: dest || undefined, includeModels, deleteAfter: true,
            })
          }
        }}
      />

      {/* Restore preview: what the archive contains, before touching anything */}
      <Dialog open={preview !== null} onOpenChange={(v) => { if (!v) setPreview(null) }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Restore this backup?</DialogTitle>
            {preview && (
              <DialogDescription>
                Created {new Date(preview.manifest.createdAt).toLocaleString()} on {preview.manifest.platform}
                {' · '}{fmtBytes(preview.sizeBytes)}
                {preview.hasChecksum ? ' · checksum verified before restoring' : ' · no checksum sidecar found'}
              </DialogDescription>
            )}
          </DialogHeader>
          {preview && (
            <div className="divide-y divide-border rounded-lg border border-border text-sm">
              {preview.manifest.components.map((c) => (
                <div key={c.id} className="flex items-center justify-between gap-3 px-3 py-2">
                  <span className="truncate">{c.label}</span>
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                    {c.files.toLocaleString()} files · {fmtBytes(c.bytes)}
                  </span>
                </div>
              ))}
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            Restoring merges these into your current studio, overwriting files with the same name.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPreview(null)}>Cancel</Button>
            <Button onClick={() => {
              const src = preview?.srcPath
              setPreview(null)
              if (src) void startJob('/api/backup/restore', { srcPath: src })
            }}>
              Restore
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Restore done: settings were re-applied server-side, but ComfyUI reads
          its model folders and shared-model paths only at startup. */}
      <ConfirmDialog
        open={restartOpen}
        onOpenChange={setRestartOpen}
        title="Restart ComfyUI to finish the restore?"
        description={
          'Your settings have been applied already. ComfyUI reads its model folders and shared-model ' +
          'paths only when it starts, so restart it now for the restored models and paths to show up.'
        }
        confirmLabel="Restart ComfyUI"
        onConfirm={() => void restartComfyUI()}
      />
    </div>
  )
}

function phaseLabel(phase?: string, label?: string): string {
  switch (phase) {
    case 'archiving': return label ? `Archiving ${label}…` : 'Archiving…'
    case 'verifying': return 'Verifying backup…'
    case 'validating': return 'Validating archive…'
    case 'deleting': return 'Deleting originals…'
    case 'restoring': return label ? `Restoring ${label}…` : 'Restoring…'
    case 'done': return 'Done'
    default: return label ?? 'Working…'
  }
}

function fmtBytes(n: number): string {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)} GB`
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(0)} MB`
  return `${Math.round(n / 1024)} KB`
}
