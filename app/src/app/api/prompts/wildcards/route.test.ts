import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'; import path from 'path'; import os from 'os'
import { NextRequest } from 'next/server'
import { GET, PUT, DELETE } from './route'

let tmp: string
beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'raccoon-wc-')); process.env.RACCOON_DATA_DIR = tmp })
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); delete process.env.RACCOON_DATA_DIR })

const put = (b: unknown) => PUT(new NextRequest('http://localhost/api/prompts/wildcards', { method: 'PUT', body: JSON.stringify(b), headers: { 'content-type': 'application/json' } }))

describe('/api/prompts/wildcards', () => {
  it('PUT creates then GET returns it', async () => {
    await put({ name: 'colors', items: ['red', 'blue'] })
    expect((await (await GET()).json()).wildcards.colors).toEqual(['red', 'blue'])
  })
  it('PUT rejects empty name', async () => {
    expect((await put({ name: '  ', items: ['x'] })).status).toBe(400)
  })
  it('DELETE removes by name', async () => {
    await put({ name: 'colors', items: ['red'] })
    const res = await DELETE(new NextRequest('http://localhost/api/prompts/wildcards?name=colors', { method: 'DELETE' }))
    expect((await res.json()).wildcards).toEqual({})
  })
})
