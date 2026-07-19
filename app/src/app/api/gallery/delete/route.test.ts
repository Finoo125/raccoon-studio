import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { NextRequest } from 'next/server'
import { imageId } from '@/lib/gallery/scanner'
import { POST } from './route'

let tmp: string
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'raccoon-del-'))
  process.env.COMFYUI_OUTPUT_DIR = tmp
})
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true })
  delete process.env.COMFYUI_OUTPUT_DIR
})

const post = (body: unknown) =>
  POST(new NextRequest('http://localhost/api/gallery/delete', {
    method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' },
  }))

describe('/api/gallery/delete', () => {
  it('deletes an existing file and reports it deleted', async () => {
    const sub = 'images/ZIT/2026-06-20'
    fs.mkdirSync(path.join(tmp, sub), { recursive: true })
    fs.writeFileSync(path.join(tmp, sub, 'a.png'), 'x')
    const id = imageId(sub, 'a.png')
    const res = await post({ ids: [id] })
    expect((await res.json()).deleted).toEqual([id])
    expect(fs.existsSync(path.join(tmp, sub, 'a.png'))).toBe(false)
  })

  it('treats a missing file as deleted (idempotent)', async () => {
    const id = imageId('images/ZIT/2026-06-20', 'gone.png')
    expect((await (await post({ ids: [id] })).json()).deleted).toEqual([id])
  })

  it('rejects a traversal id without deleting outside the root', async () => {
    const id = imageId('../../etc', 'passwd')
    const res = await post({ ids: [id] })
    const json = await res.json()
    expect(json.failed).toEqual([id])
    expect(json.deleted).toEqual([])
  })
})
