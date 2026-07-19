import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import AdmZip from 'adm-zip'
import fs from 'fs'
import os from 'os'
import path from 'path'
import type { MovieProject } from '@/types/movie'
import { buildBundle, parseBundle, importBundle, BUNDLE_FORMAT_VERSION } from './bundle'
import { deleteProject, loadProject } from './projects'

let tmpDir: string
let videoPath: string
const importedIds: string[] = []

function project(): MovieProject {
  return {
    id: 'src-project', name: 'Shared movie', createdAt: '2026-06-11T00:00:00.000Z', modifiedAt: '2026-06-11T00:00:00.000Z',
    settings: { width: 1280, height: 720, fps: 24 },
    assets: [
      { id: 'a1', kind: 'video', source: 'gallery', path: videoPath, filename: 'clip.mp4', durationSec: 3, hasAudio: true },
      { id: 'a2', kind: 'video', source: 'imported', path: '/nonexistent/missing.mp4', filename: 'missing.mp4', durationSec: 5, hasAudio: false, offline: true },
    ],
    tracks: [
      { id: 't1', kind: 'video', clips: [{ id: 'c1', assetId: 'a1', startSec: 0, inSec: 0, outSec: 3, volume: 1 }] },
      { id: 't2', kind: 'video', clips: [] },
      { id: 't3', kind: 'audio', clips: [] },
    ],
  }
}

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rsmovie-test-'))
  videoPath = path.join(tmpDir, 'clip.mp4')
  fs.writeFileSync(videoPath, Buffer.from('fake-video-bytes'))
})

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
  for (const id of importedIds) deleteProject(id)
})

describe('buildBundle / parseBundle', () => {
  it('round-trips the project document without media', () => {
    const buf = buildBundle(project(), false)
    const parsed = parseBundle(buf)
    expect(parsed.manifest.formatVersion).toBe(BUNDLE_FORMAT_VERSION)
    expect(parsed.project.name).toBe('Shared movie')
    expect(parsed.project.tracks).toHaveLength(3)
    expect(parsed.media.size).toBe(0)
  })

  it('bundles media for non-offline assets only', () => {
    const parsed = parseBundle(buildBundle(project(), true))
    expect(parsed.media.size).toBe(1)
    expect(parsed.media.get('a1')!.filename).toBe('clip.mp4')
    expect(parsed.media.get('a1')!.data.toString()).toBe('fake-video-bytes')
  })

  it('rejects garbage and missing entries', () => {
    expect(() => parseBundle(Buffer.from('not a zip'))).toThrow()
    expect(() => parseBundle(buildBundle(project(), false).subarray(0, 10))).toThrow()
  })

  it('rejects unsupported future format versions', () => {
    const buf = buildBundle(project(), false)
    // Rewrite the manifest to a future version
    const zip = new AdmZip(buf)
    zip.updateFile('manifest.json', Buffer.from(JSON.stringify({ formatVersion: 99 })))
    expect(() => parseBundle(zip.toBuffer())).toThrow(/version/i)
  })
})

describe('importBundle', () => {
  it('creates a fresh project with extracted media and rewritten paths', () => {
    const imported = importBundle(buildBundle(project(), true))
    importedIds.push(imported.id)
    expect(imported.id).not.toBe('src-project')
    expect(imported.name).toBe('Shared movie')
    expect(imported.tracks).toHaveLength(3)
    const a1 = imported.assets.find((a) => a.id === 'a1')!
    expect(a1.path).not.toBe(videoPath)
    expect(a1.source).toBe('imported')
    expect(fs.readFileSync(a1.path).toString()).toBe('fake-video-bytes')
    // non-bundled asset keeps its original path
    const a2 = imported.assets.find((a) => a.id === 'a2')!
    expect(a2.path).toBe('/nonexistent/missing.mp4')
    // persisted on disk and loadable
    expect(loadProject(imported.id)?.name).toBe('Shared movie')
  })

  it('imports twice as two distinct projects', () => {
    const buf = buildBundle(project(), false)
    const p1 = importBundle(buf)
    const p2 = importBundle(buf)
    importedIds.push(p1.id, p2.id)
    expect(p1.id).not.toBe(p2.id)
  })
})
