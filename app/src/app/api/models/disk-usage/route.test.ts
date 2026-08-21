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

  // The face-swap models are all ONNX and were silently invisible here.
  it('counts .onnx models — the whole face-swap stack is ONNX', async () => {
    fs.mkdirSync(path.join(tmp, 'hyperswap'), { recursive: true })
    fs.mkdirSync(path.join(tmp, 'facerestore_models'), { recursive: true })
    fs.writeFileSync(path.join(tmp, 'hyperswap', 'hyperswap_1c_256.onnx'), Buffer.alloc(400))
    fs.writeFileSync(path.join(tmp, 'facerestore_models', 'GPEN-BFR-1024.onnx'), Buffer.alloc(285))
    const json = await (await GET()).json()
    expect(json.total.count).toBe(2)
    expect(json.total.sizeBytes).toBe(685)
    const hs = json.subfolders.find((s: { subfolder: string }) => s.subfolder === 'hyperswap')
    expect(hs.count).toBe(1)
  })

  it('returns empty when the dir is unset', async () => {
    delete process.env.COMFYUI_MODELS_DIR
    const json = await (await GET()).json()
    expect(json.modelsDir).toBeNull()
    expect(json.total.count).toBe(0)
  })
})
