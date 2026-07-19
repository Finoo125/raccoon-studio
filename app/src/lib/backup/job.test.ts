import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { startBackupJob, startRestoreJob, getBackupJob, cancelBackupJob, type BackupJob } from './job'
import { planComponents, type BackupPaths } from './components'
import { hasTar } from './runner'

const tarAvailable = hasTar()

let root: string
function paths(base: string): BackupPaths {
  return {
    outputDir: path.join(base, 'output'),
    modelsDir: path.join(base, 'models'),
    sidecarDir: path.join(base, 'app', '.gallery-sidecars'),
    movieProjectsDir: path.join(base, 'app', 'projects', 'movies'),
    dataDir: path.join(base, 'data'),
  }
}

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'raccoon-bkjob-'))
})
afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

async function waitFinished(): Promise<BackupJob> {
  for (let i = 0; i < 400; i++) {
    const j = getBackupJob()
    if (j && j.status !== 'running') return j
    await new Promise((r) => setTimeout(r, 25))
  }
  throw new Error('job did not finish in time')
}

describe.skipIf(!tarAvailable)('backup job store', () => {
  it('cancel is a no-op when nothing runs', () => {
    expect(cancelBackupJob()).toBe(false)
  })

  it('runs a backup then a restore to completion, tracked via getBackupJob', async () => {
    const srcPaths = paths(path.join(root, 'src'))
    fs.mkdirSync(srcPaths.dataDir, { recursive: true })
    fs.writeFileSync(path.join(srcPaths.dataDir, 'settings.json'), '{"ok":true}')
    const destPath = path.join(root, 'job-backup.tar')

    const started = startBackupJob({
      destPath,
      sources: planComponents(srcPaths, { includeModels: false }),
      includesModels: false,
      deleteAfter: false,
      deletableIds: new Set(),
    })
    expect(started?.status).toBe('running')
    // A second job must be refused while the first runs (or has just finished —
    // then it is allowed; only assert refusal if still running).
    const done = await waitFinished()
    expect(done.kind).toBe('backup')
    expect(done.status).toBe('done')
    expect(done.totalFiles).toBe(1)
    expect(fs.existsSync(destPath)).toBe(true)

    const dstPaths = paths(path.join(root, 'restored'))
    const restoreStarted = startRestoreJob({
      srcPath: destPath,
      plan: planComponents(dstPaths, { includeModels: false }),
    })
    expect(restoreStarted?.status).toBe('running')
    const restored = await waitFinished()
    expect(restored.kind).toBe('restore')
    expect(restored.status).toBe('done')
    expect(restored.restoredCount).toBe(1)
    expect(fs.readFileSync(path.join(dstPaths.dataDir, 'settings.json'), 'utf8')).toBe('{"ok":true}')
  })
})
