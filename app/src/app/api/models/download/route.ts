import { NextRequest } from 'next/server'
import fs from 'fs'
import path from 'path'
import https from 'https'
import http from 'http'

const MODELS_DIR = process.env.COMFYUI_MODELS_DIR ?? ''

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
            proto.get(targetUrl, { signal: abort.signal }, (res) => {
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

              res.on('data', (chunk: Buffer) => {
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
              res.on('error', reject)
            }).on('error', reject)
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
