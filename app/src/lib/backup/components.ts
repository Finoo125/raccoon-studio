import fs from 'fs'
import os from 'os'
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
    // The whole app data dir in one member: settings, the Generate form's prompt
    // presets and wildcard lists, and queue history. Named for what is actually
    // in it — "App settings" read as if the prompt library was not covered, which
    // is the sort of doubt that makes someone skip a backup.
    oneDeep('app-data', 'Settings, prompt presets & wildcards', paths.dataDir),
  ]

  // ReActor's saved face models. A few KB each, so they always travel with a
  // backup rather than riding on the tens-of-GB models component. Listed even
  // when models are included (they overlap harmlessly, and the restoring
  // machine matches components by id — dropping it here would make an archive
  // built without models unrestorable).
  if (paths.modelsDir) {
    sources.push(oneDeep('face-models', 'Face models', path.join(paths.modelsDir, 'reactor', 'faces')))
  }

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

/**
 * Is `dest` inside one of the folders being backed up?
 *
 * Shared with `createArchive`'s refusal so the two can never disagree. tar would
 * otherwise archive the growing archive into itself, and a delete-after run
 * would wipe the backup it just wrote.
 */
export function insideAnySource(dest: string, sources: BackupSource[]): BackupSource | null {
  const norm = (p: string) => (process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p))
  const d = norm(dest)
  return sources.find((s) => {
    const src = norm(s.sourceDir)
    return d === src || d.startsWith(src + path.sep)
  }) ?? null
}

/**
 * Where a hosted pod puts archives it writes for itself — both the backup it is
 * about to create and an upload being staged for restore.
 *
 * On a pod nobody picks a path, so the server has to, and the obvious choice is
 * wrong: the app data dir IS a component ("Settings, prompt presets &
 * wildcards"), so writing there makes the backup contain itself and
 * `createArchive` rightly refuses. Hence a SIBLING of the data dir — on a pod
 * that is the volume root, which is roomy and survives a restart.
 *
 * The candidate is then checked against the same rule that would reject it,
 * rather than assumed safe, because the layout is env-driven and a future
 * install could nest these differently. Falls back to the OS temp dir, which is
 * never inside the studio's folders — smaller and wiped on restart, but a
 * working backup beats a correct-looking error.
 */
export function stagingDir(dataDir: string, sources: BackupSource[]): string {
  const candidates = [
    path.join(path.dirname(dataDir), 'raccoon-backups'),
    path.join(os.tmpdir(), 'raccoon-backups'),
  ]
  const safe = candidates.find((c) => !insideAnySource(c, sources)) ?? candidates[1]
  fs.mkdirSync(safe, { recursive: true })
  return safe
}
