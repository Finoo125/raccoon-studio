import path from 'path'
import { getDataDir } from '@/lib/system/paths'
import type { BackupPaths } from './components'

/**
 * Resolve the studio's on-disk locations at runtime. Everything here is derived
 * from env / process paths so a restored backup lands wherever the *current*
 * install keeps its data — never the absolute paths of the machine the backup
 * came from. Mirrors the resolution used by the gallery scanner and movie store.
 */
export function resolveBackupPaths(): BackupPaths {
  return {
    outputDir: process.env.COMFYUI_OUTPUT_DIR ?? '',
    modelsDir: process.env.COMFYUI_MODELS_DIR ?? '',
    sidecarDir: process.env.RACCOON_SIDECAR_DIR ?? path.join(process.cwd(), '.gallery-sidecars'),
    movieProjectsDir: path.join(process.cwd(), 'projects', 'movies'),
    dataDir: getDataDir(),
  }
}

/** Source dirs whose contents may be wiped after a verified backup (space-heavy
 *  media + models only — settings, tags and project files are left intact). */
export const DELETABLE_COMPONENT_IDS = new Set([
  'gallery-images', 'gallery-video', 'gallery-movies', 'models',
])
