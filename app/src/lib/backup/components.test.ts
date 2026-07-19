import { describe, it, expect } from 'vitest'
import path from 'path'
import { planComponents, type BackupPaths } from './components'

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
  it('lists gallery, sidecars, movie projects and data (no models) by default', () => {
    const c = planComponents(paths, { includeModels: false })
    expect(c.map((x) => x.id)).toEqual([
      'gallery-images', 'gallery-video', 'gallery-movies',
      'gallery-sidecars', 'movie-projects', 'app-data',
    ])
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
