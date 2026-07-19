import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { NextRequest } from 'next/server'
import { POST } from './route'

let tmp: string
beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'raccoon-mdel-')); process.env.COMFYUI_MODELS_DIR = tmp })
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); delete process.env.COMFYUI_MODELS_DIR })

const post = (body: unknown) =>
  POST(new NextRequest('http://localhost/api/models/delete', {
    method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' },
  }))

describe('/api/models/delete', () => {
  it('deletes a file under the models dir', async () => {
    const p = path.join(tmp, 'loras', 'a.safetensors')
    fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, 'x')
    expect((await post({ path: p })).status).toBe(200)
    expect(fs.existsSync(p)).toBe(false)
  })
  it('rejects a path outside the models dir with 403', async () => {
    expect((await post({ path: '/etc/passwd' })).status).toBe(403)
  })
  it('returns 404 for a missing file under the root', async () => {
    expect((await post({ path: path.join(tmp, 'loras', 'gone.safetensors') })).status).toBe(404)
  })
})
