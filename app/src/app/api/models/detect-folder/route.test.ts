import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { NextRequest } from 'next/server'
import { POST } from './route'

let tmp: string
beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'raccoon-detect-')) })
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }) })

/** Minimal but real safetensors: 8-byte LE header length, then that much JSON. */
function writeSafetensors(file: string, header: Record<string, unknown>): void {
  const json = Buffer.from(JSON.stringify(header), 'utf8')
  const len = Buffer.alloc(8)
  len.writeBigUInt64LE(BigInt(json.length))
  fs.writeFileSync(file, Buffer.concat([len, json, Buffer.alloc(16)]))
}

const post = (body: unknown) =>
  POST(new NextRequest('http://localhost/api/models/detect-folder', {
    method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' },
  }))

describe('/api/models/detect-folder', () => {
  it('detects a LoRA', async () => {
    const p = path.join(tmp, 'a.safetensors')
    writeSafetensors(p, { 'diffusion_model.blocks.0.mlp.fc1.lora_A.weight': { dtype: 'BF16', shape: [16, 32] } })
    const res = await post({ sourcePath: p })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ folder: 'loras' })
  })

  it('detects a full checkpoint', async () => {
    const p = path.join(tmp, 'b.safetensors')
    writeSafetensors(p, {
      'model.diffusion_model.input_blocks.0.0.weight': { dtype: 'F16', shape: [320, 4, 3, 3] },
      'first_stage_model.encoder.conv_in.weight': { dtype: 'F16', shape: [128, 3, 3, 3] },
    })
    expect(await (await post({ sourcePath: p })).json()).toEqual({ folder: 'checkpoints' })
  })

  it('returns folder null for a file it cannot read', async () => {
    const p = path.join(tmp, 'not-a-model.txt')
    fs.writeFileSync(p, 'hello')
    expect(await (await post({ sourcePath: p })).json()).toEqual({ folder: null })
  })

  it('rejects a missing sourcePath with 400', async () => {
    expect((await post({})).status).toBe(400)
  })
})
