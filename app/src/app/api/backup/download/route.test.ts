import { describe, it, expect, vi, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import type { BackupJob } from '@/lib/backup/job'

// The route reads the job record rather than any request input — that is the
// whole security property — so the job module is what has to be controlled.
const getBackupJob = vi.fn<() => BackupJob | null>(() => null)
vi.mock('@/lib/backup/job', () => ({ getBackupJob: () => getBackupJob() }))

const { GET } = await import('./route')

const doneJob = (destPath: string) =>
  ({ kind: 'backup', status: 'done', phase: 'done', value: 100, destPath } as unknown as BackupJob)

const tmp: string[] = []
function tarOnDisk(bytes = 'raccoon'): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'raccoon-dl-'))
  const file = path.join(dir, 'raccoon-backup-20260822-120000.tar')
  fs.writeFileSync(file, bytes)
  tmp.push(dir)
  return file
}

afterEach(() => {
  getBackupJob.mockReset()
  getBackupJob.mockReturnValue(null)
  for (const d of tmp.splice(0)) fs.rmSync(d, { recursive: true, force: true })
})

describe('GET /api/backup/download', () => {
  it('404s when no backup has been made', async () => {
    const res = await GET()
    expect(res.status).toBe(404)
  })

  it('404s while a backup is still running, rather than serving a partial tar', async () => {
    const file = tarOnDisk('half-written')
    getBackupJob.mockReturnValue({ ...doneJob(file), status: 'running' } as BackupJob)
    const res = await GET()
    expect(res.status).toBe(404)
  })

  it('404s for a finished RESTORE — its srcPath is the user\'s own file, not ours', async () => {
    const file = tarOnDisk()
    getBackupJob.mockReturnValue({ ...doneJob(file), kind: 'restore' } as BackupJob)
    expect((await GET()).status).toBe(404)
  })

  it('streams the finished archive as an attachment', async () => {
    const file = tarOnDisk('raccoon-tar-bytes')
    getBackupJob.mockReturnValue(doneJob(file))
    const res = await GET()
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/x-tar')
    expect(res.headers.get('content-length')).toBe(String('raccoon-tar-bytes'.length))
    expect(res.headers.get('content-disposition')).toContain('raccoon-backup-20260822-120000.tar')
    expect(await res.text()).toBe('raccoon-tar-bytes')
  })

  // A 0-byte "success" is the dangerous outcome: it looks like a backup right
  // up until the day someone tries to restore it.
  it('410s when the job says done but the file is gone', async () => {
    getBackupJob.mockReturnValue(doneJob(path.join(os.tmpdir(), 'raccoon-not-here.tar')))
    const res = await GET()
    expect(res.status).toBe(410)
    expect((await res.json()).error).toMatch(/no longer on disk/i)
  })
})
