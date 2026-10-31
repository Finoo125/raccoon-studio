import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { forgetImages } from './scanner'

describe('forgetImages', () => {
  let tmp: string
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'raccoon-cache-'))
    process.env.RACCOON_GALLERY_CACHE = path.join(tmp, 'cache.json')
  })
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true })
    delete process.env.RACCOON_GALLERY_CACHE
  })

  it('takes deleted items out of the scan cache, so the next load does not bring them back', () => {
    const file = process.env.RACCOON_GALLERY_CACHE!
    fs.writeFileSync(file, JSON.stringify({ version: 4, scannedAt: new Date().toISOString(), images: [{ id: 'a' }, { id: 'b' }] }))
    forgetImages(['a'])
    expect(JSON.parse(fs.readFileSync(file, 'utf8')).images).toEqual([{ id: 'b' }])
  })
  it('does nothing without a cache', () => {
    expect(() => forgetImages(['a'])).not.toThrow()
    expect(fs.existsSync(process.env.RACCOON_GALLERY_CACHE!)).toBe(false)
  })
})
