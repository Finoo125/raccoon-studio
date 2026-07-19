import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { GET } from './route'

let tmp: string
beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'raccoon-disk-')); process.env.COMFYUI_MODELS_DIR = tmp })
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); delete process.env.COMFYUI_MODELS_DIR })

describe('/api/models/disk-usage', () => {
  it('groups files by subfolder with sizes and a grand total', async () => {
    fs.mkdirSync(path.join(tmp, 'loras'), { recursive: true })
    fs.mkdirSync(path.join(tmp, 'vae'), { recursive: true })
    fs.writeFileSync(path.join(tmp, 'loras', 'a.safetensors'), Buffer.alloc(100))
    fs.writeFileSync(path.join(tmp, 'vae', 'b.safetensors'), Buffer.alloc(50))
    fs.writeFileSync(path.join(tmp, 'loras', 'notes.txt'), 'ignore me')
    const json = await (await GET()).json()
    expect(json.total.count).toBe(2)
    expect(json.total.sizeBytes).toBe(150)
    const loras = json.subfolders.find((s: { subfolder: string }) => s.subfolder === 'loras')
    expect(loras.count).toBe(1)
    expect(loras.sizeBytes).toBe(100)
  })

  it('returns empty when the dir is unset', async () => {
    delete process.env.COMFYUI_MODELS_DIR
    const json = await (await GET()).json()
    expect(json.modelsDir).toBeNull()
    expect(json.total.count).toBe(0)
  })
})
