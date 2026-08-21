/**
 * A download that connects and then delivers nothing must fail, not hang.
 *
 * This is the failure install-linux.sh was hardened against in aa86077
 * (--speed-limit/--speed-time); this route is its sibling and had no guard, so
 * a stalled transfer sat forever behind a 15 s SSE heartbeat that kept the
 * client looking healthy. Reproduced live on a RunPod pod with a 5.1 GB LoRA.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { NextRequest } from 'next/server'

let server: http.Server
let url: string
let tmp: string

beforeAll(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'raccoon-stall-'))
  process.env.COMFYUI_MODELS_DIR = tmp
  // Milliseconds, not the shipped 60s — otherwise the test takes a minute.
  process.env.RACCOON_DOWNLOAD_STALL_MS = '250'

  server = http.createServer((_req, res) => {
    // Headers say a big file is coming, then we send nothing at all. This is
    // exactly the shape node's https.get waits on forever.
    res.writeHead(200, { 'content-length': '5000000000' })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const addr = server.address() as { port: number }
  url = `http://127.0.0.1:${addr.port}/model.safetensors`
})

afterAll(() => {
  server.close()
  fs.rmSync(tmp, { recursive: true, force: true })
  delete process.env.COMFYUI_MODELS_DIR
  delete process.env.RACCOON_DOWNLOAD_STALL_MS
})

async function readEvents(res: Response): Promise<string> {
  const reader = res.body!.getReader()
  const dec = new TextDecoder()
  let out = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    out += dec.decode(value, { stream: true })
  }
  return out
}

describe('/api/models/download stall guard', () => {
  it('fails a transfer that connects and then sends nothing', async () => {
    const { POST } = await import('./route')
    const req = new NextRequest('http://localhost/api/models/download', {
      method: 'POST',
      body: JSON.stringify({ url, path: 'loras', name: 'model.safetensors' }),
    })
    const body = await readEvents(await POST(req))
    expect(body).toMatch(/"type":"error"/)
    expect(body).toMatch(/stalled/i)
    // and it must not leave a half-written file behind
    expect(fs.existsSync(path.join(tmp, 'loras', 'model.safetensors'))).toBe(false)
    expect(fs.readdirSync(path.join(tmp, 'loras')).filter((f) => f.endsWith('.tmp'))).toHaveLength(0)
  }, 20_000)
})
