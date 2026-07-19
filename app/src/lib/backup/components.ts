import path from 'path'

/**
 * Resolves the set of backup components (what goes in the archive and where each
 * piece is restored) from the studio's on-disk paths. Pure: callers pass already
 * resolved paths so this is unit-testable without env or a filesystem. The route
 * layer scans each candidate and drops the ones that don't exist / are empty.
 */

export interface BackupPaths {
  /** COMFYUI_OUTPUT_DIR — holds images/, video/, movies/. */
  outputDir: string
  /** COMFYUI_MODELS_DIR. */
  modelsDir: string
  /** Favorites/tags sidecar dir (app/.gallery-sidecars). */
  sidecarDir: string
  /** Movie Maker / Director projects (app/projects/movies). */
  movieProjectsDir: string
  /** App data dir (settings, presets, wildcards, queue history). */
  dataDir: string
}

export interface BackupSource {
  id: string
  label: string
  /** Absolute source dir on disk. */
  sourceDir: string
  /** Directory tar runs from (`-C`); `member` is relative to it. */
  cwd: string
  /** Member path inside the archive. */
  member: string
  /** Segments to strip on restore so the payload lands in `destDir`. */
  strip: number
  /** Destination dir on restore, resolved from the current machine's paths. */
  destDir: string
}

/** A component whose archive member is `basename(dir)`, one directory deep. */
function oneDeep(id: string, label: string, dir: string): BackupSource {
  return {
    id, label,
    sourceDir: dir,
    cwd: path.dirname(dir),
    member: path.basename(dir),
    strip: 1,
    destDir: dir,
  }
}

export function planComponents(paths: BackupPaths, opts: { includeModels: boolean }): BackupSource[] {
  const sources: BackupSource[] = [
    oneDeep('gallery-images', 'Gallery images', path.join(paths.outputDir, 'images')),
    oneDeep('gallery-video', 'Gallery videos', path.join(paths.outputDir, 'video')),
    oneDeep('gallery-movies', 'Gallery movies', path.join(paths.outputDir, 'movies')),
    oneDeep('gallery-sidecars', 'Favorites & tags', paths.sidecarDir),
    // Movie projects deliberately use a two-segment member (`projects/movies`) so
    // they never collide with the gallery `movies` member above.
    {
      id: 'movie-projects', label: 'Movie projects',
      sourceDir: paths.movieProjectsDir,
      cwd: path.dirname(path.dirname(paths.movieProjectsDir)),
      member: `${path.basename(path.dirname(paths.movieProjectsDir))}/${path.basename(paths.movieProjectsDir)}`,
      strip: 2,
      destDir: paths.movieProjectsDir,
    },
    oneDeep('app-data', 'App settings & presets', paths.dataDir),
  ]

  if (opts.includeModels) {
    sources.push(oneDeep('models', 'Models', paths.modelsDir))
  }

  const seen = new Map<string, string>()
  for (const s of sources) {
    const clash = seen.get(s.member)
    if (clash) {
      throw new Error(
        `Backup components "${clash}" and "${s.id}" would collide on archive member "${s.member}". ` +
        `Move one of the source folders so their names differ.`,
      )
    }
    seen.set(s.member, s.id)
  }

  return sources
}
