import { describe, it, expect } from 'vitest'
import { buildManifest, parseManifest, BACKUP_FORMAT_VERSION } from './manifest'

const entries = [
  { id: 'gallery-images', member: 'images', strip: 1, files: 3, bytes: 100 },
  { id: 'models', member: 'models', strip: 1, files: 2, bytes: 999 },
]

describe('buildManifest', () => {
  it('stamps version, app name, platform, and component list', () => {
    const m = buildManifest({ platform: 'win32', includesModels: true, components: entries })
    expect(m.formatVersion).toBe(BACKUP_FORMAT_VERSION)
    expect(m.appName).toBe('raccoon-studio')
    expect(m.platform).toBe('win32')
    expect(m.includesModels).toBe(true)
    expect(m.components).toEqual(entries)
    expect(() => new Date(m.createdAt).toISOString()).not.toThrow()
  })
})

describe('parseManifest', () => {
  it('round-trips a built manifest', () => {
    const m = buildManifest({ platform: 'linux', includesModels: false, components: entries })
    const parsed = parseManifest(JSON.stringify(m))
    expect(parsed).toEqual(m)
  })

  it('rejects a manifest from an unknown app', () => {
    const bad = JSON.stringify({ formatVersion: 1, appName: 'not-us', components: [] })
    expect(() => parseManifest(bad)).toThrow(/not a Raccoon Studio backup/i)
  })

  it('rejects a newer, unsupported format version', () => {
    const bad = JSON.stringify({ formatVersion: 99, appName: 'raccoon-studio', components: [] })
    expect(() => parseManifest(bad)).toThrow(/newer version/i)
  })

  it('rejects malformed JSON', () => {
    expect(() => parseManifest('{ not json')).toThrow()
  })

  it('rejects a manifest missing its component list', () => {
    const bad = JSON.stringify({ formatVersion: 1, appName: 'raccoon-studio' })
    expect(() => parseManifest(bad)).toThrow(/components/i)
  })
})
