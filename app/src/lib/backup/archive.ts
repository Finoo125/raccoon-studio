import fs from 'fs'
import os from 'os'
import path from 'path'
import { runTar, scanDir, sha256OfFile, type TarResult } from './runner'
import {
  tarCreateArgs, tarAppendArgs, tarExtractArgs, tarListArgs, tarReadFileArgs,
  countFileEntries, normalizeVerboseLine,
} from './tar'
import { buildManifest, parseManifest, type BackupComponentEntry } from './manifest'
import type { BackupSource } from './components'

export interface BackupProgress {
  phase: 'archiving' | 'validating' | 'deleting' | 'restoring' | 'done'
  value: number
  label?: string
  /** Files processed so far / expected total — shown as "file N/M" in the UI.
   *  Approximate on Windows (bsdtar's -v counts directories too). */
  filesDone?: number
  filesTotal?: number
}

/** Reject with context if tar exited non-zero — or plainly if it was cancelled
 *  (an aborted signal kills tar, so exit codes are meaningless then). */
async function ok(p: Promise<TarResult>, what: string, signal?: AbortSignal): Promise<TarResult> {
  const r = await p
  if (signal?.aborted) throw new Error('Backup cancelled')
  if (r.code !== 0) {
    throw new Error(`tar failed while trying to ${what} (exit ${r.code}): ${r.stderr.trim().slice(0, 500)}`)
  }
  return r
}

/**
 * Build a validated backup archive at `destPath`. Scans each source, skips the
 * empty/missing ones, writes a manifest, appends every component (streaming
 * progress), verifies the archive reads cleanly with the expected file count,
 * and writes a `.sha256` sidecar. Returns the total file count and checksum.
 */
export async function createArchive(opts: {
  destPath: string
  sources: BackupSource[]
  includesModels: boolean
  platform: string
  onProgress?: (p: BackupProgress) => void
  /** Aborting kills the in-flight tar/checksum and rejects with "Backup cancelled". */
  signal?: AbortSignal
}): Promise<{ totalFiles: number; checksum: string; changedDuringBackup: number }> {
  const { destPath, sources, includesModels, platform, onProgress, signal } = opts

  const included: Array<{ source: BackupSource; files: number; bytes: number }> = []
  for (const source of sources) {
    if (!fs.existsSync(source.sourceDir)) continue
    const { files, bytes } = scanDir(source.sourceDir)
    if (files === 0) continue
    included.push({ source, files, bytes })
  }
  if (included.length === 0) {
    throw new Error('Nothing to back up — no gallery media, projects, or settings were found.')
  }

  // Refuse a destination inside any folder being backed up: tar would archive
  // the growing archive into itself, and a delete-after run would wipe the
  // freshly written backup. Checked against ALL planned sources (not just the
  // non-empty ones) because delete-after clears every planned source dir.
  const norm = (p: string) => (process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p))
  const dest = norm(destPath)
  for (const s of sources) {
    const src = norm(s.sourceDir)
    if (dest === src || dest.startsWith(src + path.sep)) {
      throw new Error(
        `The backup destination is inside "${s.label}", which is part of the backup. Choose a folder outside the studio's data folders.`,
      )
    }
  }

  // Pre-scan total drives the progress bar only; the authoritative file count
  // comes from what tar actually archives (below). A live directory tree can
  // change between scan and archive — a temp/thumbnail/lock file that ComfyUI or
  // the OS removes mid-backup — so we must not treat the pre-scan as ground truth.
  const scanTotal = included.reduce((n, c) => n + c.files, 0)
  const entries: BackupComponentEntry[] = included.map((c) => ({
    id: c.source.id, member: c.source.member, strip: c.source.strip, files: c.files, bytes: c.bytes,
  }))
  const manifest = buildManifest({ platform, includesModels, components: entries })

  fs.rmSync(destPath, { force: true })
  fs.rmSync(`${destPath}.sha256`, { force: true })
  fs.mkdirSync(path.dirname(destPath), { recursive: true })

  let archivedFiles = 0
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'raccoon-bk-manifest-'))
  try {
    fs.writeFileSync(path.join(stage, 'manifest.json'), JSON.stringify(manifest, null, 2))
    await ok(runTar(tarCreateArgs(destPath, stage, 'manifest.json'), undefined, signal), 'write the backup manifest', signal)

    for (const c of included) {
      await ok(
        runTar(tarAppendArgs(destPath, c.source.cwd, c.source.member), (line) => {
          if (normalizeVerboseLine(line)) {
            archivedFiles++
            onProgress?.({
              phase: 'archiving',
              value: Math.min(99, Math.round((archivedFiles / Math.max(1, scanTotal)) * 100)),
              label: c.source.label,
              filesDone: archivedFiles,
              filesTotal: scanTotal,
            })
          }
        }, signal),
        `archive ${c.source.label}`,
        signal,
      )
    }
  } finally {
    fs.rmSync(stage, { recursive: true, force: true })
  }

  // Validate: tar must read the whole archive cleanly — a truncated or corrupt
  // archive makes -tf exit non-zero — and the manifest must be present. The
  // listing is the authoritative file count: both GNU tar and bsdtar mark
  // directories with a trailing slash in -t mode, unlike -v create output
  // (Windows bsdtar omits the slash there), so the write-side verbose count is
  // progress-only and must never be compared against the listing.
  onProgress?.({ phase: 'validating', value: 99 })
  const list = await ok(runTar(tarListArgs(destPath), undefined, signal), 'validate the archive', signal)
  if (!list.stdout.split('\n').some((l) => l.trim() === 'manifest.json')) {
    throw new Error('Backup validation failed: the archive is missing its manifest.')
  }
  const totalFiles = countFileEntries(list.stdout) - 1 // minus manifest.json

  const checksum = await sha256OfFile(destPath, signal)
  fs.writeFileSync(`${destPath}.sha256`, `${checksum}  ${path.basename(destPath)}\n`)

  onProgress?.({ phase: 'done', value: 100 })
  // Positive when files present at scan time were gone by the time tar reached
  // them (temp/thumbnail/lock churn) — surfaced to the user, not treated as a
  // failure. The archive is internally consistent regardless.
  const changedDuringBackup = Math.max(0, scanTotal - totalFiles)
  return { totalFiles, checksum, changedDuringBackup }
}

/**
 * Restore a backup into the current machine. Verifies the checksum sidecar (if
 * present), reads the manifest, and extracts each component into the destination
 * resolved from the *current* machine's `plan` (matched by component id) — so a
 * backup restores even when the studio was reinstalled to a different path/OS.
 */
export async function restoreArchive(opts: {
  srcPath: string
  plan: BackupSource[]
  onProgress?: (p: BackupProgress) => void
}): Promise<{ restored: Array<{ id: string; files: number }>; skipped: string[] }> {
  const { srcPath, plan, onProgress } = opts
  if (!fs.existsSync(srcPath)) throw new Error(`Backup file not found: ${srcPath}`)

  const sidecar = `${srcPath}.sha256`
  if (fs.existsSync(sidecar)) {
    const expected = fs.readFileSync(sidecar, 'utf8').trim().split(/\s+/)[0]
    const actual = await sha256OfFile(srcPath)
    if (expected && expected !== actual) {
      throw new Error('Backup checksum does not match — the file may be corrupt or was modified after it was created.')
    }
  }

  const read = await ok(runTar(tarReadFileArgs(srcPath, 'manifest.json')), 'read the backup manifest')
  const manifest = parseManifest(read.stdout)

  const list = await ok(runTar(tarListArgs(srcPath)), 'inspect the archive')
  const totalFiles = Math.max(1, countFileEntries(list.stdout) - 1) // minus manifest.json

  const byId = new Map(plan.map((p) => [p.id, p]))
  const restored: Array<{ id: string; files: number }> = []
  const skipped: string[] = []
  let done = 0

  for (const comp of manifest.components) {
    const target = byId.get(comp.id)
    if (!target) {
      // Component this build doesn't know how to place — skip rather than guess.
      skipped.push(comp.id)
      continue
    }
    fs.mkdirSync(target.destDir, { recursive: true })
    await ok(
      runTar(tarExtractArgs(srcPath, target.destDir, comp.member, comp.strip), (line) => {
        if (normalizeVerboseLine(line)) {
          done++
          onProgress?.({
            phase: 'restoring',
            value: Math.min(99, Math.round((done / totalFiles) * 100)),
            label: target.label,
            filesDone: done,
            filesTotal: totalFiles,
          })
        }
      }),
      `restore ${target.label}`,
    )
    restored.push({ id: comp.id, files: comp.files })
  }

  onProgress?.({ phase: 'done', value: 100 })
  return { restored, skipped }
}

/**
 * Delete the *contents* of each backed-up source dir (keeping the now-empty dir
 * so the app still runs). Only ever called after a backup has validated.
 */
export function deleteSources(sources: BackupSource[]): void {
  for (const s of sources) {
    if (!fs.existsSync(s.sourceDir)) continue
    for (const entry of fs.readdirSync(s.sourceDir)) {
      fs.rmSync(path.join(s.sourceDir, entry), { recursive: true, force: true })
    }
  }
}
