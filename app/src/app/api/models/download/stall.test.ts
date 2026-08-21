/**
 * The download watchdog, from both sides.
 *
 * A transfer that connects and then delivers nothing must fail rather than hang
 * — that is the failure install-linux.sh was hardened against in aa86077, and
 * this route had no guard at all, so a dead download sat forever behind a 15 s
 * SSE heartbeat that kept the client looking healthy.
 *
 * But the first attempt at that guard used `req.setTimeout`, which is
 * documented as socket inactivity and behaved as a hard cap on total duration:
 * on a pod it killed a download running at a steady 49-74 MB/s after exactly
 * 60 s, 3.39 GB in, breaking every model that takes over a minute. So the
 * second test here matters as much as the first — a guard that cannot tell
 * "slow" from "dead" is worse than no guard.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { NextRequest } from 'next/server'

let silent: http.Server
let trickle: http.Server
let redirector: http.Server
let silentUrl: string
let trickleUrl: string
let redirectUrl: string
let tmp: string
const TRICKLE_CHUNKS = 15
const TRICKLE_GAP_MS = 200

beforeAll(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'raccoon-stall-'))
  process.env.COMFYUI_MODELS_DIR = tmp
  // Seconds, not the shipped 60 — otherwise these take minutes.
  process.env.RACCOON_DOWNLOAD_STALL_MS = '1000'

  // Headers promising a big file, then nothing at all: the shape node's
  // https.get waits on forever.
  silent = http.createServer((_req, res) => { res.writeHead(200, { 'content-length': '5000000000' }) })
  await new Promise<void>((r) => silent.listen(0, '127.0.0.1', r))
  silentUrl = `http://127.0.0.1:${(silent.address() as { port: number }).port}/model.safetensors`

  // Alive but slow: a chunk every 200 ms for 3 s, i.e. three times the stall
  // window in total elapsed time but never a gap anywhere near it.
  trickle = http.createServer((_req, res) => {
    const chunk = Buffer.alloc(1024, 7)
    res.writeHead(200, { 'content-length': String(chunk.length * TRICKLE_CHUNKS) })
    let n = 0
    const t = setInterval(() => {
      if (n++ >= TRICKLE_CHUNKS) { clearInterval(t); res.end(); return }
      res.write(chunk)
    }, TRICKLE_GAP_MS)
  })
  await new Promise<void>((r) => trickle.listen(0, '127.0.0.1', r))
  trickleUrl = `http://127.0.0.1:${(trickle.address() as { port: number }).port}/slow.safetensors`

  // Every HuggingFace URL 302s to a CDN, so the redirect path IS the normal
  // path for real downloads — and it is where both shipped guards leaked.
  redirector = http.createServer((_req, res) => {
    res.writeHead(302, { location: trickleUrl })
    res.end()
  })
  await new Promise<void>((r) => redirector.listen(0, '127.0.0.1', r))
  redirectUrl = `http://127.0.0.1:${(redirector.address() as { port: number }).port}/redirected.safetensors`
})

afterAll(() => {
  silent.close()
  trickle.close()
  redirector.close()
  fs.rmSync(tmp, { recursive: true, force: true })
  delete process.env.COMFYUI_MODELS_DIR
  delete process.env.RACCOON_DOWNLOAD_STALL_MS
})

async function run(url: string, name: string): Promise<string> {
  const { POST } = await import('./route')
  const req = new NextRequest('http://localhost/api/models/download', {
    method: 'POST',
    body: JSON.stringify({ url, path: 'loras', name }),
  })
  const reader = (await POST(req)).body!.getReader()
  const dec = new TextDecoder()
  let out = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    out += dec.decode(value, { stream: true })
  }
  return out
}

describe('/api/models/download watchdog', () => {
  it('fails a transfer that connects and then sends nothing', async () => {
    const body = await run(silentUrl, 'dead.safetensors')
    expect(body).toMatch(/"type":"error"/)
    expect(body).toMatch(/stalled/i)
    // and it must not leave a half-written file behind
    expect(fs.existsSync(path.join(tmp, 'loras', 'dead.safetensors'))).toBe(false)
    expect(fs.readdirSync(path.join(tmp, 'loras')).filter((f) => f.endsWith('.tmp'))).toHaveLength(0)
  }, 20_000)

  // The regression that shipped in 1.2.4: total elapsed time here is 3x the
  // stall window, but data never stops arriving, so the download must complete.
  it('does NOT kill a slow transfer that is still delivering', async () => {
    const body = await run(trickleUrl, 'slow.safetensors')
    expect(body, 'a progressing download was killed as stalled').not.toMatch(/stalled/i)
    expect(body).toMatch(/"type":"done"/)
    expect(fs.statSync(path.join(tmp, 'loras', 'slow.safetensors')).size)
      .toBe(1024 * TRICKLE_CHUNKS)
  }, 30_000)

  /**
   * The bug that shipped TWICE, in 1.2.4 and again in 1.2.5.
   *
   * `doRequest` recurses on a redirect, and the abandoned request kept its
   * armed guard. That guard watched a timestamp nothing could refresh — the
   * redirect response was all it would ever see — so it shot the live transfer
   * down at exactly STALL_MS. Only files slower than that window died, which is
   * why small models were fine and every large one failed.
   *
   * Both earlier tests pass without a redirect in sight, which is exactly how
   * this reached production twice.
   */
  it('survives a redirect into a slow transfer', async () => {
    const body = await run(redirectUrl, 'redirected.safetensors')
    expect(body, 'the abandoned pre-redirect request killed the download').not.toMatch(/stalled/i)
    expect(body).toMatch(/"type":"done"/)
    expect(fs.statSync(path.join(tmp, 'loras', 'redirected.safetensors')).size)
      .toBe(1024 * TRICKLE_CHUNKS)
  }, 30_000)
})
