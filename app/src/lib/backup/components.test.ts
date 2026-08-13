import { describe, it, expect } from 'vitest'
import path from 'path'
import { planComponents, type BackupPaths } from './components'
import { resolveBackupPaths } from './paths'
import { PRESETS_FILE, WILDCARDS_FILE } from '@/lib/prompts/store'
import { getDataDir } from '@/lib/system/paths'

// Use path.join for the OS-native filesystem paths so the expectations hold on
// both Windows (backslash) and Linux (forward slash). Archive `member` values
// are always '/'-joined and stay literal.
const j = (...p: string[]) => path.join(...p)
const paths: BackupPaths = {
  outputDir: j('/data', 'output'),
  modelsDir: j('/weights', 'models'),
  sidecarDir: j('/app', '.gallery-sidecars'),
  movieProjectsDir: j('/app', 'projects', 'movies'),
  dataDir: j('/root', 'data'),
}

describe('planComponents', () => {
  it('lists gallery, sidecars, movie projects, data and face models (no models) by default', () => {
    const c = planComponents(paths, { includeModels: false })
    expect(c.map((x) => x.id)).toEqual([
      'gallery-images', 'gallery-video', 'gallery-movies',
      'gallery-sidecars', 'movie-projects', 'app-data', 'face-models',
    ])
  })

  // The Generate form's prompt presets and wildcard lists are server-side JSON
  // in the app data dir, so `app-data` already carries them — but only for as
  // long as they live there. Planned from the live path resolver, not the
  // fixture above, so this compares where the store actually writes against
  // where the backup actually reads: move either file, or repoint `dataDir`,
  // and the label starts lying about what a backup holds.
  it('carries the prompt library, reading the very dir the prompt store writes to', () => {
    const live = planComponents(resolveBackupPaths(), { includeModels: false })
      .find((x) => x.id === 'app-data')!
    expect(live.label).toMatch(/prompt presets & wildcards/i)
    for (const file of [PRESETS_FILE, WILDCARDS_FILE]) {
      expect(path.dirname(path.join(getDataDir(), file))).toBe(live.sourceDir)
    }
  })

  it('carries the saved face models without the models folder', () => {
    const faces = planComponents(paths, { includeModels: false }).find((x) => x.id === 'face-models')!
    expect(faces).toMatchObject({
      sourceDir: j('/weights', 'models', 'reactor', 'faces'),
      cwd: j('/weights', 'models', 'reactor'),
      member: 'faces',
      strip: 1,
      destDir: j('/weights', 'models', 'reactor', 'faces'),
    })
  })

  it('still plans face models when models are included, so either archive restores', () => {
    // The restoring machine matches components by id and plans with models on;
    // dropping face-models there would silently skip it in a no-models archive.
    expect(planComponents(paths, { includeModels: true }).map((x) => x.id)).toContain('face-models')
  })

  it('skips face models when no models dir is configured', () => {
    const c = planComponents({ ...paths, modelsDir: '' }, { includeModels: false })
    expect(c.map((x) => x.id)).not.toContain('face-models')
  })

  it('appends models when requested', () => {
    const c = planComponents(paths, { includeModels: true })
    expect(c.map((x) => x.id)).toContain('models')
    const models = c.find((x) => x.id === 'models')!
    expect(models).toMatchObject({
      sourceDir: j('/weights', 'models'), cwd: j('/weights'), member: 'models', strip: 1, destDir: j('/weights', 'models'),
    })
  })

  it('derives a one-segment member for gallery images', () => {
    const img = planComponents(paths, { includeModels: false }).find((x) => x.id === 'gallery-images')!
    expect(img).toMatchObject({
      sourceDir: j('/data', 'output', 'images'), cwd: j('/data', 'output'), member: 'images', strip: 1, destDir: j('/data', 'output', 'images'),
    })
  })

  it('disambiguates movie projects with a two-segment member so it never clashes with gallery movies', () => {
    const mp = planComponents(paths, { includeModels: false }).find((x) => x.id === 'movie-projects')!
    expect(mp).toMatchObject({
      sourceDir: j('/app', 'projects', 'movies'), cwd: j('/app'), member: 'projects/movies', strip: 2, destDir: j('/app', 'projects', 'movies'),
    })
  })

  it('throws when two components would map to the same archive member', () => {
    const clashing: BackupPaths = { ...paths, modelsDir: j('/data', 'output', 'images') }
    expect(() => planComponents(clashing, { includeModels: true })).toThrow(/collide/i)
  })
})
