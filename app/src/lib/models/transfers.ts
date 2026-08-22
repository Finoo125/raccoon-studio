import fs from 'fs'
import path from 'path'
import https from 'https'
import http from 'http'
import { describeDownloadError } from '@/lib/models/download-error'

/**
 * Server-side registry of model downloads.
 *
 * Downloads used to be driven by the browser: the page held the fetch, the
 * route streamed SSE back, and the stream's `cancel()` killed the transfer.
 * That made leaving the Models page — switching tabs, following a link — abort
 * whatever was downloading and delete the partial file, which is not something
 * anyone asked for and is very expensive on a 42 GB model set.
 *
 * So a transfer now belongs to the server, exactly as a backup job does. The
 * browser starts one and then only *observes* it; closing the tab is not a
 * cancellation, and coming back shows whatever is still running. Cancelling is
 * an explicit act with its own endpoint.
 *
 * State lives on `globalThis` because Next gives each route module its own
 * module registry — a plain module-level Map would give POST and GET separate,
 * invisible copies of it.
 */

export interface Transfer {
  /** `<dir>/<name>` — the file's identity, so two presets sharing a file share
   *  its download instead of racing each other for the same destination. */
  key: string
  name: string
  dir: string
  status: 'running' | 'done' | 'error' | 'cancelled'
  receivedBytes: number
  totalBytes: number
  /** 0-100; stays 0 while the CDN sends no content-length. */
  value: number
  error?: string
  /** The file was already on disk, so nothing was fetched and ComfyUI has seen it. */
  alreadyExists?: boolean
  startedAt: number
  endedAt?: number
}

interface Entry {
  transfer: Transfer
  abort: AbortController
}

/**
 * No bytes for this long and the transfer is dead — give up so the user sees an
 * error instead of a progress bar that never moves again.
 *
 * A connection that opens and then delivers nothing is not a *failure*: node's
 * https.get has no idle timeout, so it waits forever.
 *
 * Note this is a *zero-byte* guard, not a rate floor. A pod download that
 * looked stalled turned out to be running at 2.5 MB/s — far slower than its
 * neighbours but very much alive — and killing that would be wrong.
 */
const STALL_MS = Number(process.env.RACCOON_DOWNLOAD_STALL_MS ?? 60_000)

/** How long a settled transfer stays listable, so a page opened after the fact
 *  still shows what happened rather than silently forgetting it. */
const RETAIN_MS = 10 * 60_000

const store: Map<string, Entry> =
  ((globalThis as unknown as { __raccoonTransfers?: Map<string, Entry> }).__raccoonTransfers ??=
    new Map())

export const transferKey = (dir: string, name: string) => `${dir}/${path.basename(name)}`

/** Drop settled transfers nobody is going to ask about again. */
function prune() {
  const now = Date.now()
  for (const [key, e] of store) {
    if (e.transfer.status !== 'running' && now - (e.transfer.endedAt ?? now) > RETAIN_MS) {
      store.delete(key)
    }
  }
}

export function listTransfers(): Transfer[] {
  prune()
  return [...store.values()].map((e) => e.transfer)
}

export function getTransfer(key: string): Transfer | undefined {
  return store.get(key)?.transfer
}

export function cancelTransfer(key: string): boolean {
  const e = store.get(key)
  if (!e || e.transfer.status !== 'running') return false
  e.abort.abort()
  return true
}

export interface StartResult {
  transfer?: Transfer
  error?: string
}

/**
 * Begin a download, or hand back the one already running for this file.
 *
 * Returns as soon as the transfer is registered — the bytes keep moving after
 * the request that started them has been answered, which is the entire point.
 */
export function startTransfer(opts: { url: string; path: string; name: string }): StartResult {
  const modelsDir = process.env.COMFYUI_MODELS_DIR ?? ''
  if (!modelsDir) return { error: 'COMFYUI_MODELS_DIR is not set in .env.local' }

  const safeName = path.basename(opts.name)
  const root = path.resolve(modelsDir)
  const destDir = path.resolve(root, opts.path)
  if (destDir !== root && !destDir.startsWith(root + path.sep)) {
    return { error: 'Destination is outside the models folder.' }
  }
  const destFile = path.join(destDir, safeName)
  const key = transferKey(opts.path, safeName)

  const existing = store.get(key)
  if (existing?.transfer.status === 'running') return { transfer: existing.transfer }

  if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true })

  const transfer: Transfer = {
    key, name: safeName, dir: opts.path,
    status: 'running', receivedBytes: 0, totalBytes: 0, value: 0,
    startedAt: Date.now(),
  }

  if (fs.existsSync(destFile)) {
    transfer.status = 'done'
    transfer.value = 100
    transfer.alreadyExists = true
    transfer.endedAt = Date.now()
    store.set(key, { transfer, abort: new AbortController() })
    return { transfer }
  }

  const abort = new AbortController()
  store.set(key, { transfer, abort })
  // Deliberately not awaited: the caller gets its answer now and the bytes keep
  // arriving afterwards.
  void run(opts.url, destFile, transfer, abort)
  return { transfer }
}

/**
 * Mark a transfer finished-badly.
 *
 * Deliberately called only once cleanup is done, never from the abort listener:
 * a status that flips the instant Cancel is pressed is visible to the poll while
 * the partial file is still on disk, so the UI would say "cancelled" over a
 * .tmp that has not been removed yet.
 */
function settleError(transfer: Transfer, cancelled: boolean, message: string) {
  transfer.status = cancelled ? 'cancelled' : 'error'
  if (!cancelled) transfer.error = message
  transfer.endedAt = Date.now()
}

async function run(url: string, destFile: string, transfer: Transfer, abort: AbortController) {
  const tmpFile = destFile + '.tmp'
  let fileStream: fs.WriteStream | undefined

  try {
    const out = fs.createWriteStream(tmpFile)
    fileStream = out

    await new Promise<void>((resolve, reject) => {
      // ONE watchdog for the whole transfer, owned here rather than by each hop.
      // Per-hop guards are what shipped broken twice: `doRequest` recurses on a
      // redirect, and the abandoned request kept an armed guard watching a
      // timestamp nothing could refresh, so it shot the live transfer down at
      // exactly STALL_MS. Every HuggingFace URL redirects to a CDN, so that was
      // the normal path, not an edge case.
      let lastDataAt = Date.now()
      let watchdog: ReturnType<typeof setInterval> | undefined
      const stopWatchdog = () => { if (watchdog) { clearInterval(watchdog); watchdog = undefined } }
      const settle = (fn: () => void) => { stopWatchdog(); fn() }

      const doRequest = (targetUrl: string, hops = 0) => {
        if (hops > 5) { settle(() => reject(new Error('Too many redirects'))); return }

        const proto = targetUrl.startsWith('https') ? https : http

        const req = proto.get(targetUrl, { signal: abort.signal }, (res) => {
          const { statusCode, headers } = res

          if (statusCode === 301 || statusCode === 302 || statusCode === 307 || statusCode === 308) {
            // The shared watchdog keeps running across the hop and is re-stamped
            // by the CDN's bytes; a redirect that never leads anywhere therefore
            // still trips it.
            lastDataAt = Date.now()
            if (headers.location) { doRequest(new URL(headers.location, targetUrl).toString(), hops + 1) }
            else settle(() => reject(new Error('Redirect without Location header')))
            return
          }

          if (statusCode !== 200) {
            settle(() => reject(new Error(`HTTP ${statusCode}`)))
            return
          }

          transfer.totalBytes = parseInt(headers['content-length'] ?? '0', 10)

          res.on('end', stopWatchdog)
          res.on('close', stopWatchdog)
          res.on('error', stopWatchdog)

          res.on('data', (chunk: Buffer) => {
            lastDataAt = Date.now()
            transfer.receivedBytes += chunk.length
            if (transfer.totalBytes > 0) {
              transfer.value = Math.round((transfer.receivedBytes / transfer.totalBytes) * 100)
            }
          })

          res.pipe(out)
          out.on('finish', () => {
            out.close()
            fs.renameSync(tmpFile, destFile)
            settle(resolve)
          })
          out.on('error', (err) => settle(() => reject(err)))
          // Both network paths report which host failed: a bare
          // "connect ETIMEDOUT <ip>" cannot tell a blocked HuggingFace from a
          // dead link in our own catalogue.
          res.on('error', (err) => settle(() => reject(new Error(describeDownloadError(err, targetUrl)))))
        })
        req.on('error', (err) => settle(() => reject(new Error(describeDownloadError(err, targetUrl)))))

        // Armed before the response, because the response callback is not
        // guaranteed to fire at all: a server that accepts the connection and
        // never flushes headers is exactly the hang this exists to catch, and an
        // in-response guard would never arm for it.
        stopWatchdog()
        watchdog = setInterval(() => {
          if (Date.now() - lastDataAt < STALL_MS) return
          const err = new Error(
            `Download stalled — no data for ${Math.round(STALL_MS / 1000)}s (${targetUrl})`,
          )
          settle(() => { req.destroy(err); reject(err) })
        }, Math.max(250, Math.floor(STALL_MS / 4)))
      }

      doRequest(url)
    })

    transfer.status = 'done'
    transfer.value = 100
    transfer.endedAt = Date.now()
  } catch (e) {
    // Windows refuses to unlink a file with an open handle, and `destroy()`
    // only *starts* the close — unlinking on the next line loses the race and
    // strands a .tmp, which is what a cancelled download left behind until the
    // cancel test caught it. Wait for 'close', with a cap so cleanup can never
    // become its own hang.
    if (fileStream && !fileStream.closed) {
      await new Promise<void>((resolve) => {
        const done = () => resolve()
        fileStream!.once('close', done)
        fileStream!.destroy()
        setTimeout(done, 2_000)
      })
    }
    try { fs.unlinkSync(tmpFile) } catch { /* already gone */ }
    settleError(transfer, abort.signal.aborted, e instanceof Error ? e.message : String(e))
  }
}
