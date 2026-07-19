import fs from 'fs'
import { createArchive, restoreArchive, deleteSources, type BackupProgress } from './archive'
import type { BackupSource } from './components'

/**
 * Server-side backup/restore job state. The job runs to completion regardless
 * of the browser — the UI polls GET /api/backup/job and can reattach after a
 * reload. One job at a time (backup and restore contend for the same trees).
 * Stashed on globalThis so every route bundle sees the same instance.
 */
export interface BackupJob {
  kind: 'backup' | 'restore'
  status: 'running' | 'done' | 'error' | 'cancelled'
  phase: string
  value: number
  label?: string
  filesDone?: number
  filesTotal?: number
  startedAt: string
  endedAt?: string
  error?: string
  // Backup results
  destPath?: string
  totalFiles?: number
  checksum?: string
  deleted?: boolean
  changedDuringBackup?: number
  // Restore results
  restoredCount?: number
  skipped?: string[]
}

interface Slot {
  job: BackupJob | null
  abort: AbortController | null
}

const slot: Slot = ((globalThis as typeof globalThis & { __raccoonBackupJob?: Slot }).__raccoonBackupJob ??= {
  job: null,
  abort: null,
})

export function getBackupJob(): BackupJob | null {
  return slot.job
}

function isRunning(): boolean {
  return slot.job?.status === 'running'
}

function applyProgress(job: BackupJob, p: BackupProgress) {
  job.phase = p.phase
  job.value = p.value
  job.label = p.label
  if (p.filesDone !== undefined) job.filesDone = p.filesDone
  if (p.filesTotal !== undefined) job.filesTotal = p.filesTotal
}

/** Start a backup. Returns null when another job is already running. */
export function startBackupJob(opts: {
  destPath: string
  sources: BackupSource[]
  includesModels: boolean
  deleteAfter: boolean
  deletableIds: Set<string>
}): BackupJob | null {
  if (isRunning()) return null
  const abort = new AbortController()
  const job: BackupJob = {
    kind: 'backup', status: 'running', phase: 'archiving', value: 0,
    startedAt: new Date().toISOString(), destPath: opts.destPath,
  }
  slot.job = job
  slot.abort = abort

  void (async () => {
    try {
      const result = await createArchive({
        destPath: opts.destPath,
        sources: opts.sources,
        includesModels: opts.includesModels,
        platform: process.platform,
        signal: abort.signal,
        onProgress: (p) => applyProgress(job, p),
      })
      if (opts.deleteAfter) {
        job.phase = 'deleting'
        job.value = 99
        deleteSources(opts.sources.filter((s) => opts.deletableIds.has(s.id)))
        job.deleted = true
      }
      Object.assign(job, {
        status: 'done', phase: 'done', value: 100,
        totalFiles: result.totalFiles, checksum: result.checksum,
        changedDuringBackup: result.changedDuringBackup,
      })
    } catch (e) {
      if (abort.signal.aborted) {
        // A cancelled archive is unusable — remove it and its sidecar.
        fs.rmSync(opts.destPath, { force: true })
        fs.rmSync(`${opts.destPath}.sha256`, { force: true })
        job.status = 'cancelled'
        job.phase = 'cancelled'
      } else {
        job.status = 'error'
        job.error = e instanceof Error ? e.message : String(e)
      }
    } finally {
      job.endedAt = new Date().toISOString()
      slot.abort = null
    }
  })()
  return job
}

/** Start a restore. Returns null when another job is already running.
 *  Deliberately not cancellable — a half-restored tree is worse than waiting. */
export function startRestoreJob(opts: { srcPath: string; plan: BackupSource[] }): BackupJob | null {
  if (isRunning()) return null
  const job: BackupJob = {
    kind: 'restore', status: 'running', phase: 'verifying', value: 0,
    startedAt: new Date().toISOString(),
  }
  slot.job = job
  slot.abort = null

  void (async () => {
    try {
      const result = await restoreArchive({
        srcPath: opts.srcPath,
        plan: opts.plan,
        onProgress: (p) => applyProgress(job, p),
      })
      Object.assign(job, {
        status: 'done', phase: 'done', value: 100,
        restoredCount: result.restored.length, skipped: result.skipped,
      })
    } catch (e) {
      job.status = 'error'
      job.error = e instanceof Error ? e.message : String(e)
    } finally {
      job.endedAt = new Date().toISOString()
    }
  })()
  return job
}

/** Cancel the running backup (restores are not cancellable). */
export function cancelBackupJob(): boolean {
  if (slot.job?.kind === 'backup' && slot.job.status === 'running' && slot.abort) {
    slot.abort.abort()
    return true
  }
  return false
}
