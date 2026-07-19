/**
 * The `manifest.json` written as the first member of every backup archive. It
 * records which archive member maps to which logical component so restore can
 * send each payload to the correct destination — resolved from the *restoring*
 * machine's env, not the absolute paths of the machine the backup came from.
 */

export const BACKUP_FORMAT_VERSION = 1
export const BACKUP_APP_NAME = 'raccoon-studio'

export interface BackupComponentEntry {
  /** Stable component id (e.g. 'gallery-images', 'models'). */
  id: string
  /** Top-level path of this component inside the archive (e.g. 'projects/movies'). */
  member: string
  /** Path segments to strip on extract so the payload lands in the dest dir. */
  strip: number
  /** File count (excludes directories) — used for progress + validation. */
  files: number
  /** Total bytes of the component's files. */
  bytes: number
}

export interface BackupManifest {
  formatVersion: number
  appName: string
  createdAt: string
  platform: string
  includesModels: boolean
  components: BackupComponentEntry[]
}

export function buildManifest(input: {
  platform: string
  includesModels: boolean
  components: BackupComponentEntry[]
}): BackupManifest {
  return {
    formatVersion: BACKUP_FORMAT_VERSION,
    appName: BACKUP_APP_NAME,
    createdAt: new Date().toISOString(),
    platform: input.platform,
    includesModels: input.includesModels,
    components: input.components,
  }
}

export function parseManifest(json: string): BackupManifest {
  const raw = JSON.parse(json) as Partial<BackupManifest>
  if (raw.appName !== BACKUP_APP_NAME) {
    throw new Error('This file is not a Raccoon Studio backup.')
  }
  if (typeof raw.formatVersion !== 'number' || raw.formatVersion > BACKUP_FORMAT_VERSION) {
    throw new Error(
      `This backup was made by a newer version of Raccoon Studio (format ${raw.formatVersion}). Update the app to restore it.`,
    )
  }
  if (!Array.isArray(raw.components)) {
    throw new Error('Backup manifest is missing its components list — the archive may be corrupt.')
  }
  return raw as BackupManifest
}
