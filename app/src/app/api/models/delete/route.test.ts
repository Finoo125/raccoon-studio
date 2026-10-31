import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
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
  it('deletes by folder + name under the models dir', async () => {
    const p = path.join(tmp, 'vae', 'b.safetensors')
    fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, 'x')
    expect((await post({ folder: 'vae', name: 'b.safetensors' })).status).toBe(200)
    expect(fs.existsSync(p)).toBe(false)
  })
  it('a file that cannot be deleted (held open by ComfyUI on Windows) answers 500 with a reason, not a crash', async () => {
    const p = path.join(tmp, 'vae', 'held.safetensors')
    fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, 'x')
    const spy = vi.spyOn(fs, 'unlinkSync').mockImplementation(() => { throw Object.assign(new Error('resource busy or locked'), { code: 'EBUSY' }) })
    try {
      const res = await post({ folder: 'vae', name: 'held.safetensors' })
      expect(res.status).toBe(500)
      expect((await res.json()).error).toMatch(/busy|locked|in use/i)
    } finally { spy.mockRestore() }
  })
  it('rejects a folder + name that climbs out of the models dir', async () => {
    expect((await post({ folder: '..', name: 'secret.txt' })).status).toBe(403)
    expect((await post({ folder: 'vae', name: '../../x' })).status).toBe(403)
  })
})
