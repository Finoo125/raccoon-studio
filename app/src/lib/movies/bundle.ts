import AdmZip from 'adm-zip'
import fs from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'
import type { MovieProject } from '@/types/movie'
import { assetsDir, saveProject } from './projects'

export const BUNDLE_FORMAT_VERSION = 1
export const BUNDLE_EXTENSION = '.rsmovie'

export interface BundleManifest {
  formatVersion: number
  exportedAt: string
  appName: string
}

export interface ParsedBundle {
  manifest: BundleManifest
  project: MovieProject
  media: Map<string, { filename: string; data: Buffer }>
}

/** Build a shareable .rsmovie zip. With media, every non-offline asset file is embedded. */
export function buildBundle(project: MovieProject, includeMedia: boolean): Buffer {
  const zip = new AdmZip()
  const manifest: BundleManifest = {
    formatVersion: BUNDLE_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    appName: 'raccoon-studio',
  }
  zip.addFile('manifest.json', Buffer.from(JSON.stringify(manifest, null, 2)))
  zip.addFile('project.json', Buffer.from(JSON.stringify(project, null, 2)))
  if (includeMedia) {
    for (const asset of project.assets) {
      if (asset.offline) continue
      let data: Buffer
      try {
        data = fs.readFileSync(asset.path)
      } catch {
        continue
      }
      zip.addFile(`assets/${asset.id}/${asset.filename}`, data)
    }
  }
  return zip.toBuffer()
}

/** Parse and validate a .rsmovie buffer. Throws with a user-facing message when invalid. */
export function parseBundle(buffer: Buffer): ParsedBundle {
  let zip: AdmZip
  try {
    zip = new AdmZip(buffer)
  } catch {
    throw new Error('Not a valid .rsmovie file (unreadable archive)')
  }
  const read = (name: string): Buffer => {
    const entry = zip.getEntry(name)
    if (!entry) throw new Error(`Not a valid .rsmovie file (missing ${name})`)
    return entry.getData()
  }
  let manifest: BundleManifest
  let project: MovieProject
  try {
    manifest = JSON.parse(read('manifest.json').toString()) as BundleManifest
    project = JSON.parse(read('project.json').toString()) as MovieProject
  } catch (err) {
    if (err instanceof Error && err.message.includes('.rsmovie')) throw err
    throw new Error('Not a valid .rsmovie file (corrupt metadata)')
  }
  if (typeof manifest.formatVersion !== 'number' || manifest.formatVersion > BUNDLE_FORMAT_VERSION) {
    throw new Error(
      `Unsupported bundle format version ${manifest.formatVersion} — update Raccoon Studio to import this file`,
    )
  }
  if (!project.id || !Array.isArray(project.tracks) || !Array.isArray(project.assets)) {
    throw new Error('Not a valid .rsmovie file (malformed project document)')
  }
  const media = new Map<string, { filename: string; data: Buffer }>()
  for (const entry of zip.getEntries()) {
    const m = /^assets\/([^/]+)\/(.+)$/.exec(entry.entryName)
    if (m && !entry.isDirectory) media.set(m[1], { filename: m[2], data: entry.getData() })
  }
  return { manifest, project, media }
}

/**
 * Import a bundle as a brand-new project: fresh project id, bundled media
 * extracted into the new project's assets dir (paths rewritten, source
 * becomes 'imported'); assets without bundled media keep their original
 * path and rely on offline-flagging at load.
 */
export function importBundle(buffer: Buffer): MovieProject {
  const { project, media } = parseBundle(buffer)
  const id = randomUUID()
  const dir = assetsDir(id)
  fs.mkdirSync(dir, { recursive: true })

  const assets = project.assets.map((asset) => {
    const file = media.get(asset.id)
    if (!file) return { ...asset, offline: undefined }
    const safeName = file.filename.replace(/[^\w.\-()\s]/g, '_')
    const dest = path.join(dir, `${asset.id}-${safeName}`)
    fs.writeFileSync(dest, file.data)
    return { ...asset, path: dest, source: 'imported' as const, offline: undefined }
  })

  return saveProject({
    ...project,
    id,
    createdAt: new Date().toISOString(),
    assets,
  })
}
