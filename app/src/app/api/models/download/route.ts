import { NextRequest } from 'next/server'
import fs from 'fs'
import path from 'path'
import https from 'https'
import http from 'http'
import { describeDownloadError } from '@/lib/models/download-error'

const MODELS_DIR = process.env.COMFYUI_MODELS_DIR ?? ''

/**
 * No bytes for this long and the transfer is dead — give up so the user sees an
 * error instead of a progress bar that never moves again.
 *
 * A connection that opens and then delivers nothing is not a *failure*: node's
 * https.get has no idle timeout, so it waits forever, and this route's 15 s SSE
 * heartbeat keeps the client looking healthy the whole time. install-linux.sh
 * hit exactly this and got `--speed-limit 2048 --speed-time 60` in aa86077;
 * this route is its sibling and never got the same guard.
 *
 * Note the installer's guard is a *rate* floor and this is a *zero-byte* one,
 * deliberately. A pod download that looked stalled turned out to be running at
 * 2.5 MB/s — 10-20x slower than its neighbours but very much alive — and
 * killing that would be wrong. Only a transfer delivering literally nothing is
 * unambiguously dead.
 *
 * It matters most on a hosted pod, where this route is the ONLY way in: the
 * edge rejects request bodies over ~500 MiB, so there is no upload fallback.
 *
 * The env override exists so the stall can be tested in milliseconds.
 */
const STALL_MS = Number(process.env.RACCOON_DOWNLOAD_STALL_MS ?? 60_000)

type SSEEvent =
  | { type: 'progress'; value?: number; receivedBytes: number; totalBytes: number }
  | { type: 'done'; alreadyExists?: boolean }
  | { type: 'error'; message: string }

export async function POST(req: NextRequest) {
  const encoder = new TextEncoder()
  // enqueue throws once the client disconnects; progress events fire from inside
  // the response 'data' handler where a throw would be an uncaught exception.
  const send = (ctrl: ReadableStreamDefaultController, event: SSEEvent) => {
    try {
      ctrl.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
    } catch { /* client gone */ }
  }

  const body = (await req.json()) as { url: string; path: string; name: string }

  // Cancel plumbing: aborting destroys the upstream request and removes the
  // partial .tmp. Fired by the client aborting its fetch (Cancel button), by a
  // closed tab (the stream's cancel() below), or by req.signal.
  const abort = new AbortController()
  req.signal.addEventListener('abort', () => abort.abort(), { once: true })

  const stream = new ReadableStream({
    async start(controller) {
      let tmpFile: string | undefined
      let fileStream: fs.WriteStream | undefined

      // A hosted pod sits behind a reverse proxy that kills any connection with
      // no bytes for ~125 s (measured on RunPod, undocumented) — and that clock
      // runs after the headers, not just before them, so "the stream already
      // started" is no protection. This stream can legitimately go quiet for
      // longer: progress fires once per whole percent, and 1% of a 42 GB model
      // set is 420 MB. An SSE comment costs nothing and EventSource ignores it.
      const heartbeat = setInterval(() => {
        try { controller.enqueue(encoder.encode(': ping\n\n')) } catch { /* client gone */ }
      }, 15_000)

      try {
        if (!MODELS_DIR) {
          send(controller, { type: 'error', message: 'COMFYUI_MODELS_DIR is not set in .env.local' })
          return
        }

        const { url, path: modelPath, name } = body
        const safeName = path.basename(name)
        const root = path.resolve(MODELS_DIR)
        const destDir = path.resolve(root, modelPath)
        if (destDir !== root && !destDir.startsWith(root + path.sep)) {
          send(controller, { type: 'error', message: 'Destination is outside the models folder.' })
          return
        }
        const destFile = path.join(destDir, safeName)
        tmpFile = destFile + '.tmp'

        if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true })

        if (fs.existsSync(destFile)) {
          send(controller, { type: 'done', alreadyExists: true })
          return
        }

        const out = fs.createWriteStream(tmpFile)
        fileStream = out

        await new Promise<void>((resolve, reject) => {
          const doRequest = (targetUrl: string, hops = 0) => {
            if (hops > 5) { reject(new Error('Too many redirects')); return }

            const proto = targetUrl.startsWith('https') ? https : http

            // Armed BEFORE the response, because the response callback is not
            // guaranteed to fire: a server that accepts the connection and
            // never flushes headers would otherwise be watched by nothing.
            // Re-stamped from the bytes below, so "slow" and "dead" stay
            // distinguishable — see the comment on STALL_MS.
            let lastDataAt = Date.now()
            let watchdog: ReturnType<typeof setInterval> | undefined
            const stopWatchdog = () => { if (watchdog) clearInterval(watchdog) }

            const req = proto.get(targetUrl, { signal: abort.signal }, (res) => {
              const { statusCode, headers } = res

              if (statusCode === 301 || statusCode === 302 || statusCode === 307 || statusCode === 308) {
                // Location may be relative — resolve it against the current URL.
                if (headers.location) { doRequest(new URL(headers.location, targetUrl).toString(), hops + 1) }
                else reject(new Error('Redirect without Location header'))
                return
              }

              if (statusCode !== 200) {
                reject(new Error(`HTTP ${statusCode}`))
                return
              }

              const total = parseInt(headers['content-length'] ?? '0', 10)
              let received = 0
              let lastPct = -1
              let lastSentBytes = 0

              res.on('end', stopWatchdog)
              res.on('close', stopWatchdog)
              res.on('error', stopWatchdog)

              res.on('data', (chunk: Buffer) => {
                lastDataAt = Date.now()
                received += chunk.length
                if (total > 0) {
                  const pct = Math.round((received / total) * 100)
                  if (pct !== lastPct) {
                    lastPct = pct
                    send(controller, { type: 'progress', value: pct, receivedBytes: received, totalBytes: total })
                  }
                } else if (received - lastSentBytes >= 8 * 1024 * 1024) {
                  // No content-length (chunked CDN response): report bytes so the
                  // UI can show "N MB" instead of a dead progress bar.
                  lastSentBytes = received
                  send(controller, { type: 'progress', receivedBytes: received, totalBytes: 0 })
                }
              })

              res.pipe(out)
              out.on('finish', () => {
                out.close()
                fs.renameSync(tmpFile!, destFile)
                tmpFile = undefined
                resolve()
              })
              out.on('error', reject)
              // Both network paths report which host failed: a bare
              // "connect ETIMEDOUT <ip>" cannot tell a blocked HuggingFace from a
              // dead link in our own catalogue. `targetUrl` is the hop that
              // failed, so a blocked CDN is distinguishable from a blocked
              // huggingface.co.
              res.on('error', (err) => reject(new Error(describeDownloadError(err, targetUrl))))
            })
            req.on('error', (err) => { stopWatchdog(); reject(new Error(describeDownloadError(err, targetUrl))) })
            watchdog = setInterval(() => {
              if (Date.now() - lastDataAt < STALL_MS) return
              stopWatchdog()
              // Settle explicitly rather than relying on destroy() to surface
              // the error: with a response in flight it may land on `res`, on
              // `req`, or be swallowed, and an unsettled promise here is the
              // original hang all over again. reject() after settling is a
              // no-op, so doing both is safe.
              const err = new Error(
                `Download stalled — no data for ${Math.round(STALL_MS / 1000)}s (${targetUrl})`,
              )
              req.destroy(err)
              reject(err)
            }, Math.max(250, Math.floor(STALL_MS / 4)))
          }

          doRequest(url)
        })

        send(controller, { type: 'done' })
      } catch (e) {
        if (tmpFile) {
          // Windows refuses to unlink a file with an open handle — close first.
          fileStream?.destroy()
          try { fs.unlinkSync(tmpFile) } catch { /* ignore */ }
        }
        // A cancelled download is not an error — and the client is gone anyway.
        if (!abort.signal.aborted) {
          send(controller, { type: 'error', message: e instanceof Error ? e.message : String(e) })
        }
      } finally {
        clearInterval(heartbeat)
        try { controller.close() } catch { /* already closed by disconnect */ }
      }
    },
    cancel() {
      // The response consumer went away: Cancel button or closed tab.
      abort.abort()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  })
}
