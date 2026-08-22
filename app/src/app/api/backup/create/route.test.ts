import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { planComponents, insideAnySource } from '@/lib/backup/components'
import { resolveBackupPaths } from '@/lib/backup/paths'

// Only destination-picking is under test; archiving has its own coverage.
// `planComponents` is deliberately NOT mocked — the bug this guards is that the
// chosen destination sat inside a real component, so a stubbed component list
// would have happily passed while production failed.
const startBackupJob = vi.fn((opts: { destPath: string }) => ({
  kind: 'backup', status: 'running', destPath: opts.destPath,
}))
vi.mock('@/lib/backup/job', () => ({
  startBackupJob: (o: { destPath: string }) => startBackupJob(o),
}))

const { POST } = await import('./route')

const post = (body: unknown) =>
  POST(new Request('http://localhost/api/backup/create', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as Parameters<typeof POST>[0])

let root: string

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'raccoon-bk-'))
  // Mirrors the pod's own layout (runpod/entrypoint.sh): everything a sibling
  // under one workspace root.
  process.env.RACCOON_DATA_DIR = path.join(root, 'data')
  process.env.COMFYUI_OUTPUT_DIR = path.join(root, 'output')
  process.env.RACCOON_SIDECAR_DIR = path.join(root, 'sidecars')
  fs.mkdirSync(process.env.RACCOON_DATA_DIR, { recursive: true })
})

afterEach(() => {
  delete process.env.RACCOON_KIOSK
  delete process.env.RACCOON_DATA_DIR
  delete process.env.COMFYUI_OUTPUT_DIR
  delete process.env.RACCOON_SIDECAR_DIR
  fs.rmSync(root, { recursive: true, force: true })
  startBackupJob.mockClear()
})

const chosen = () => (startBackupJob.mock.calls[0][0] as { destPath: string }).destPath

describe('POST /api/backup/create — choosing a destination', () => {
  // A desktop install reaches this route only after the native dialog returned
  // a path, so an empty destination there is a real bug and must not be papered
  // over by silently inventing somewhere to write gigabytes.
  it('400s with no destination on a desktop install', async () => {
    const res = await post({ includeModels: false })
    expect(res.status).toBe(400)
    expect(startBackupJob).not.toHaveBeenCalled()
  })

  /**
   * The bug reported from a live pod: the destination was
   * `<dataDir>/backups`, and the data dir IS a component ("Settings, prompt
   * presets & wildcards"). `createArchive` refused it — correctly — so backup
   * on a pod failed outright with a message about choosing another folder,
   * which is impossible when the server is the one choosing.
   */
  it('picks a destination OUTSIDE every folder being backed up', async () => {
    process.env.RACCOON_KIOSK = '1'
    const res = await post({ includeModels: false })
    expect(res.status).toBe(200)
    const sources = planComponents(resolveBackupPaths(), { includeModels: false })
    const clash = insideAnySource(chosen(), sources)
    expect(clash, `destination sits inside "${clash?.label}", which is part of the backup`).toBeNull()
  })

  it('is still outside everything when models are included', async () => {
    process.env.RACCOON_KIOSK = '1'
    process.env.COMFYUI_MODELS_DIR = path.join(root, 'models')
    const res = await post({ includeModels: true })
    expect(res.status).toBe(200)
    const sources = planComponents(resolveBackupPaths(), { includeModels: true })
    expect(insideAnySource(chosen(), sources)).toBeNull()
    delete process.env.COMFYUI_MODELS_DIR
  })

  it('names it as a .tar and creates the directory to write into', async () => {
    process.env.RACCOON_KIOSK = '1'
    await post({ includeModels: false })
    expect(chosen()).toMatch(/raccoon-backup-\d{8}-\d{6}\.tar$/)
    expect(fs.existsSync(path.dirname(chosen()))).toBe(true)
  })

  // The pod path must not hijack an explicit choice — the same route still
  // serves desktop installs.
  it('still honours an explicit destination on a pod', async () => {
    process.env.RACCOON_KIOSK = '1'
    const explicit = path.join(root, 'chosen.tar')
    const res = await post({ destPath: explicit, includeModels: false })
    expect(res.status).toBe(200)
    expect(chosen()).toBe(explicit)
  })
})
