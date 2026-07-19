import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'; import path from 'path'; import os from 'os'
import { NextRequest } from 'next/server'
import { GET, POST, DELETE } from './route'

let tmp: string
beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'raccoon-pr-')); process.env.RACCOON_DATA_DIR = tmp })
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); delete process.env.RACCOON_DATA_DIR })

const post = (b: unknown) => POST(new NextRequest('http://localhost/api/prompts/presets', { method: 'POST', body: JSON.stringify(b), headers: { 'content-type': 'application/json' } }))

describe('/api/prompts/presets', () => {
  it('POST adds then GET returns it', async () => {
    await post({ name: 'A', prompt: 'x' })
    const json = await (await GET()).json()
    expect(json.presets).toHaveLength(1)
  })
  it('POST rejects empty name', async () => {
    expect((await post({ name: '', prompt: 'x' })).status).toBe(400)
  })
  it('DELETE removes by id', async () => {
    const { presets } = await (await post({ name: 'A', prompt: 'x' })).json()
    const res = await DELETE(new NextRequest(`http://localhost/api/prompts/presets?id=${presets[0].id}`, { method: 'DELETE' }))
    expect((await res.json()).presets).toEqual([])
  })
})
