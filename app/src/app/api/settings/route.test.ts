import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { NextRequest } from 'next/server'
import { GET, PUT } from './route'

let tmp: string
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'raccoon-route-'))
  process.env.RACCOON_DATA_DIR = tmp
})
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true })
  delete process.env.RACCOON_DATA_DIR
})

const put = (body: unknown) =>
  PUT(new NextRequest('http://localhost/api/settings', {
    method: 'PUT',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  }))

describe('/api/settings', () => {
  it('GET returns settings and a paths block', async () => {
    const res = await GET()
    const json = await res.json()
    expect(json.settings.comfyuiBaseUrl).toBeTruthy()
    expect(json).toHaveProperty('paths')
  })

  it('PUT applies a valid patch', async () => {
    const res = await put({ ollamaNumCtx: 2048 })
    expect(res.status).toBe(200)
    expect((await res.json()).settings.ollamaNumCtx).toBe(2048)
  })

  it('PUT rejects a non-URL base url', async () => {
    const res = await put({ ollamaBaseUrl: 'not a url' })
    expect(res.status).toBe(400)
  })

  it('PUT rejects a non-positive timeout', async () => {
    const res = await put({ ollamaTimeoutMs: -5 })
    expect(res.status).toBe(400)
  })
})
