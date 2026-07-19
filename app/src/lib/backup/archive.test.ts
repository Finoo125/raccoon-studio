import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { createArchive, restoreArchive } from './archive'
import { planComponents, type BackupPaths } from './components'
import { hasTar, sha256OfFile } from './runner'

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

function write(file: string, content: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, content)
}

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'raccoon-backup-'))
})
afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

describe.skipIf(!tarAvailable)('backup archive round-trip', () => {
  it('creates a validated archive and restores every file into a fresh location', async () => {
    const src = path.join(root, 'src')
    const srcPaths = paths(src)
    // Seed a couple of components with real files (including a nested dir).
    write(path.join(srcPaths.outputDir, 'images', 'a.png'), 'PNG-A')
    write(path.join(srcPaths.outputDir, 'images', 'sub', 'b.png'), 'PNG-B')
    write(path.join(srcPaths.dataDir, 'settings.json'), '{"ok":true}')
    write(path.join(srcPaths.movieProjectsDir, 'proj1', 'project.json'), '{"id":"proj1"}')

    const destPath = path.join(root, 'backup.tar')
    const summary = await createArchive({
      destPath,
      sources: planComponents(srcPaths, { includeModels: false }),
      includesModels: false,
      platform: process.platform,
    })

    // 5 files across the non-empty components (video/movies/sidecars are absent).
    expect(summary.totalFiles).toBe(4)
    expect(fs.existsSync(destPath)).toBe(true)
    expect(fs.existsSync(`${destPath}.sha256`)).toBe(true)
    expect(await sha256OfFile(destPath)).toBe(summary.checksum)

    // Restore into a DIFFERENT base — proves paths are re-resolved, not baked in.
    const dst = path.join(root, 'restored')
    const dstPaths = paths(dst)
    const result = await restoreArchive({
      srcPath: destPath,
      plan: planComponents(dstPaths, { includeModels: false }),
    })
    expect(result.restored.map((r) => r.id).sort()).toEqual(
      ['app-data', 'gallery-images', 'movie-projects'],
    )

    expect(fs.readFileSync(path.join(dstPaths.outputDir, 'images', 'a.png'), 'utf8')).toBe('PNG-A')
    expect(fs.readFileSync(path.join(dstPaths.outputDir, 'images', 'sub', 'b.png'), 'utf8')).toBe('PNG-B')
    expect(fs.readFileSync(path.join(dstPaths.dataDir, 'settings.json'), 'utf8')).toBe('{"ok":true}')
    expect(fs.readFileSync(path.join(dstPaths.movieProjectsDir, 'proj1', 'project.json'), 'utf8')).toBe('{"id":"proj1"}')
  })

  it('rejects a destination inside a folder that is being backed up', async () => {
    const src = path.join(root, 'src3')
    const srcPaths = paths(src)
    write(path.join(srcPaths.dataDir, 'settings.json'), 'hello')
    await expect(
      createArchive({
        // outputDir/images is a planned (empty) source dir — delete-after would
        // wipe the archive parked there even though nothing was archived from it.
        destPath: path.join(srcPaths.outputDir, 'images', 'backup.tar'),
        sources: planComponents(srcPaths, { includeModels: false }),
        includesModels: false,
        platform: process.platform,
      }),
    ).rejects.toThrow(/inside/i)
  })

  it('rejects with "cancelled" when the signal is already aborted', async () => {
    const src = path.join(root, 'src4')
    const srcPaths = paths(src)
    write(path.join(srcPaths.dataDir, 'settings.json'), 'hello')
    await expect(
      createArchive({
        destPath: path.join(root, 'cancelled.tar'),
        sources: planComponents(srcPaths, { includeModels: false }),
        includesModels: false,
        platform: process.platform,
        signal: AbortSignal.abort(),
      }),
    ).rejects.toThrow(/cancelled/i)
  })

  it('rejects a restore when the checksum sidecar does not match', async () => {
    const src = path.join(root, 'src2')
    const srcPaths = paths(src)
    write(path.join(srcPaths.dataDir, 'settings.json'), 'hello')
    const destPath = path.join(root, 'backup2.tar')
    await createArchive({
      destPath,
      sources: planComponents(srcPaths, { includeModels: false }),
      includesModels: false,
      platform: process.platform,
    })
    // Corrupt the sidecar checksum.
    fs.writeFileSync(`${destPath}.sha256`, 'deadbeef')
    await expect(
      restoreArchive({ srcPath: destPath, plan: planComponents(paths(path.join(root, 'r2')), { includeModels: false }) }),
    ).rejects.toThrow(/checksum/i)
  })
})
