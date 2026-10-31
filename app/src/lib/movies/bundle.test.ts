import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import AdmZip from 'adm-zip'
import fs from 'fs'
import os from 'os'
import path from 'path'
import type { MovieProject } from '@/types/movie'
import { buildBundle, parseBundle, importBundle, BUNDLE_FORMAT_VERSION } from './bundle'
import { assetsDir, deleteProject, loadProject } from './projects'

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
  // Movie media lives in ComfyUI's output (gallery clips) or the projects folder.
  process.env.COMFYUI_OUTPUT_DIR = tmpDir
})

afterAll(() => {
  delete process.env.COMFYUI_OUTPUT_DIR
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
    // a non-bundled asset outside the studio's media folders loses its path (see below)
    const a2 = imported.assets.find((a) => a.id === 'a2')!
    expect(a2.path).toBe('')
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

describe('untrusted bundles', () => {
  // AdmZip normalises names on write; bundles from other zip tools keep backslashes,
  // and AdmZip hands them back verbatim on read. Patch a same-length placeholder in.
  const evilId = ['..', '..', '..', 'abc'].join(String.fromCharCode(92))
  function evilBundle(): Buffer {
    const p = project()
    p.assets = [{ ...p.assets[0], id: evilId }]
    p.tracks[0].clips[0].assetId = evilId
    const zip = new AdmZip()
    zip.addFile('manifest.json', Buffer.from(JSON.stringify({ formatVersion: BUNDLE_FORMAT_VERSION })))
    zip.addFile('project.json', Buffer.from(JSON.stringify(p)))
    zip.addFile('assets/AAAAAAAAAAAA/clip.mp4', Buffer.from('evil'))
    return Buffer.from(zip.toBuffer().toString('latin1').split('AAAAAAAAAAAA').join(evilId), 'latin1')
  }

  it('extracts media inside the new project whatever the asset id says', () => {
    const buf = evilBundle()
    expect([...parseBundle(buf).media.keys()]).toEqual([evilId])
    const imported = importBundle(buf)
    importedIds.push(imported.id)
    const file = imported.assets[0].path
    expect(path.dirname(path.resolve(file))).toBe(path.resolve(assetsDir(imported.id)))
    expect(fs.readFileSync(file).toString()).toBe('evil')
  })

  it('keeps a non-bundled path only inside the media folders, so a bundle cannot point at other files', () => {
    const p = project()
    const inOutput = path.join(tmpDir, 'gallery', 'kept.mp4')
    p.assets = [
      { ...p.assets[1], id: 'out', path: inOutput },
      { ...p.assets[1], id: 'elsewhere', path: path.join(os.homedir(), 'Documents', 'private.mp4') },
    ]
    const imported = importBundle(buildBundle(p, false))
    importedIds.push(imported.id)
    expect(imported.assets.find((a) => a.id === 'out')!.path).toBe(inOutput)
    expect(imported.assets.find((a) => a.id === 'elsewhere')).toMatchObject({ path: '', offline: true })
  })

  it('never packs a file from outside the media folders into a bundle', () => {
    const outside = fs.mkdtempSync(path.join(os.homedir(), 'rsmovie-outside-'))
    try {
      const secret = path.join(outside, 'secret.mp4')
      fs.writeFileSync(secret, 'secret')
      const p = project()
      p.assets = [{ ...p.assets[0], id: 'x', path: secret }]
      expect(parseBundle(buildBundle(p, true)).media.size).toBe(0)
    } finally {
      fs.rmSync(outside, { recursive: true, force: true })
    }
  })
})
