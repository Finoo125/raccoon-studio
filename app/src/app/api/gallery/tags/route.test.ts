import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { NextRequest } from 'next/server'
import { imageId, readAllSidecars } from '@/lib/gallery/scanner'
import { POST } from './route'

let tmp: string
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'raccoon-tag-'))
  process.env.RACCOON_SIDECAR_DIR = tmp
})
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true })
  delete process.env.RACCOON_SIDECAR_DIR
})

const post = (body: unknown) =>
  POST(new NextRequest('http://localhost/api/gallery/tags', {
    method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' },
  }))

describe('/api/gallery/tags', () => {
  it('adds a tag (deduped) to each id', async () => {
    const id = imageId('images/ZIT/d', 'a.png')
    await post({ ids: [id], add: 'portrait' })
    await post({ ids: [id], add: 'portrait' }) // dupe ignored
    expect(readAllSidecars().get(id)?.tags).toEqual(['portrait'])
  })
  it('removes a tag', async () => {
    const id = imageId('images/ZIT/d', 'a.png')
    await post({ ids: [id], add: 'wip' })
    await post({ ids: [id], remove: 'wip' })
    expect(readAllSidecars().get(id)?.tags).toEqual([])
  })
})
