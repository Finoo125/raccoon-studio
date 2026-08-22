import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

// Only the destination-picking is under test here; the archiving itself has its
// own coverage. Capturing startBackupJob is what makes the chosen path visible.
const startBackupJob = vi.fn((opts: { destPath: string }) => ({
  kind: 'backup', status: 'running', destPath: opts.destPath,
}))
vi.mock('@/lib/backup/job', () => ({
  startBackupJob: (o: { destPath: string }) => startBackupJob(o),
}))
vi.mock('@/lib/backup/components', () => ({ planComponents: () => [] }))

const { POST } = await import('./route')

const post = (body: unknown) =>
  POST(new Request('http://localhost/api/backup/create', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as Parameters<typeof POST>[0])

let dataDir: string

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'raccoon-data-'))
  process.env.RACCOON_DATA_DIR = dataDir
  process.env.COMFYUI_OUTPUT_DIR = path.join(dataDir, 'output')
})

afterEach(() => {
  delete process.env.RACCOON_KIOSK
  delete process.env.RACCOON_DATA_DIR
  delete process.env.COMFYUI_OUTPUT_DIR
  fs.rmSync(dataDir, { recursive: true, force: true })
  startBackupJob.mockClear()
})

describe('POST /api/backup/create — choosing a destination', () => {
  // A desktop install reaches this route only after the native dialog returned
  // a path, so an empty destination there is a real bug and must not be papered
  // over by silently inventing somewhere to write gigabytes.
  it('400s with no destination on a desktop install', async () => {
    const res = await post({ includeModels: false })
    expect(res.status).toBe(400)
    expect(startBackupJob).not.toHaveBeenCalled()
  })

  // On a pod there is no desktop for a dialog to open on, which is what
  // produced "No native file dialog found. Install zenity or kdialog." The
  // server names the file instead and the browser downloads it afterwards.
  it('picks a path under the data dir on a hosted pod', async () => {
    process.env.RACCOON_KIOSK = '1'
    const res = await post({ includeModels: false })
    expect(res.status).toBe(200)
    expect(startBackupJob).toHaveBeenCalledTimes(1)
    const { destPath } = startBackupJob.mock.calls[0][0]
    expect(destPath.startsWith(path.join(dataDir, 'backups'))).toBe(true)
    expect(destPath).toMatch(/raccoon-backup-\d{8}-\d{6}\.tar$/)
    // The directory has to exist before the archiver opens a write stream in it.
    expect(fs.existsSync(path.join(dataDir, 'backups'))).toBe(true)
  })

  // The pod path must not hijack an explicit choice — the same route still
  // serves a desktop install, and a hotkey'd pod deploy could set both.
  it('still honours an explicit destination on a pod', async () => {
    process.env.RACCOON_KIOSK = '1'
    const explicit = path.join(dataDir, 'chosen.tar')
    const res = await post({ destPath: explicit, includeModels: false })
    expect(res.status).toBe(200)
    const { destPath } = startBackupJob.mock.calls[0][0]
    expect(destPath).toBe(explicit)
  })
})
