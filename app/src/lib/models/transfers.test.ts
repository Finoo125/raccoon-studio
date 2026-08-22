/**
 * The download engine: the stall watchdog from both sides, and the ownership
 * rules that make a transfer survive the page that started it.
 *
 * A transfer that connects and then delivers nothing must fail rather than hang
 * — that is the failure install-linux.sh was hardened against in aa86077, and
 * this code had no guard at all, so a dead download sat forever.
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
import type { Transfer } from './transfers'

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

/** Start a transfer and wait for it to settle, as the poll endpoint would. */
async function run(url: string, name: string): Promise<Transfer> {
  const { startTransfer, getTransfer } = await import('./transfers')
  const { transfer, error } = startTransfer({ url, path: 'loras', name })
  if (error || !transfer) throw new Error(error ?? 'no transfer returned')
  const deadline = Date.now() + 25_000
  for (;;) {
    if (Date.now() > deadline) throw new Error(`${name} never settled`)
    await new Promise((r) => setTimeout(r, 50))
    const t = getTransfer(transfer.key)!
    if (t.status !== 'running') return t
  }
}

describe('download watchdog', () => {
  it('fails a transfer that connects and then sends nothing', async () => {
    const t = await run(silentUrl, 'dead.safetensors')
    expect(t.status).toBe('error')
    expect(t.error).toMatch(/stalled/i)
    // and it must not leave a half-written file behind
    expect(fs.existsSync(path.join(tmp, 'loras', 'dead.safetensors'))).toBe(false)
    expect(fs.readdirSync(path.join(tmp, 'loras')).filter((f) => f.endsWith('.tmp'))).toHaveLength(0)
  }, 20_000)

  // The regression that shipped in 1.2.4: total elapsed time here is 3x the
  // stall window, but data never stops arriving, so the download must complete.
  it('does NOT kill a slow transfer that is still delivering', async () => {
    const t = await run(trickleUrl, 'slow.safetensors')
    expect(t.error, 'a progressing download was killed as stalled').toBeUndefined()
    expect(t.status).toBe('done')
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
    const t = await run(redirectUrl, 'redirected.safetensors')
    expect(t.error, 'the abandoned pre-redirect request killed the download').toBeUndefined()
    expect(t.status).toBe('done')
  }, 30_000)
})

describe('transfers outlive the page that started them', () => {
  it('lists a running transfer, so a revisit can show its progress', async () => {
    const { startTransfer, listTransfers, cancelTransfer } = await import('./transfers')
    const { transfer } = startTransfer({ url: trickleUrl, path: 'loras', name: 'listed.safetensors' })
    // The whole point: nothing about the caller going away is communicated to
    // the transfer, so it is still there to be found afterwards.
    expect(listTransfers().find((t) => t.key === transfer!.key)?.status).toBe('running')
    cancelTransfer(transfer!.key)
  }, 20_000)

  it('joins an in-flight transfer instead of racing it for the same file', async () => {
    const { startTransfer, cancelTransfer } = await import('./transfers')
    const a = startTransfer({ url: trickleUrl, path: 'loras', name: 'shared.safetensors' })
    const b = startTransfer({ url: trickleUrl, path: 'loras', name: 'shared.safetensors' })
    // Two presets can list the same file; both must land on one download rather
    // than two writers on one .tmp.
    expect(b.transfer).toBe(a.transfer)
    cancelTransfer(a.transfer!.key)
  }, 20_000)

  it('cancels only when asked, and cleans up the partial file', async () => {
    const { startTransfer, cancelTransfer, getTransfer } = await import('./transfers')
    const { transfer } = startTransfer({ url: trickleUrl, path: 'loras', name: 'stopped.safetensors' })
    await new Promise((r) => setTimeout(r, 300))
    expect(cancelTransfer(transfer!.key)).toBe(true)
    const deadline = Date.now() + 10_000
    while (getTransfer(transfer!.key)!.status === 'running') {
      if (Date.now() > deadline) throw new Error('cancel did not settle')
      await new Promise((r) => setTimeout(r, 50))
    }
    expect(getTransfer(transfer!.key)!.status).toBe('cancelled')
    expect(fs.existsSync(path.join(tmp, 'loras', 'stopped.safetensors'))).toBe(false)
    expect(fs.readdirSync(path.join(tmp, 'loras')).filter((f) => f.startsWith('stopped'))).toHaveLength(0)
  }, 20_000)

  it('reports a file already on disk without fetching it', async () => {
    const { startTransfer } = await import('./transfers')
    fs.mkdirSync(path.join(tmp, 'vae'), { recursive: true })
    fs.writeFileSync(path.join(tmp, 'vae', 'here.safetensors'), 'x')
    // http://0.0.0.0:1 would fail instantly if it were ever contacted.
    const { transfer } = startTransfer({ url: 'http://127.0.0.1:1/nope', path: 'vae', name: 'here.safetensors' })
    expect(transfer!.status).toBe('done')
    expect(transfer!.alreadyExists).toBe(true)
  })

  it('refuses a destination outside the models folder', async () => {
    const { startTransfer } = await import('./transfers')
    const { error, transfer } = startTransfer({ url: trickleUrl, path: '../../etc', name: 'passwd' })
    expect(transfer).toBeUndefined()
    expect(error).toMatch(/outside the models folder/i)
  })
})
