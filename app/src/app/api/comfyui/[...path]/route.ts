import { NextRequest, NextResponse } from 'next/server'
import { guard } from '@/lib/system/request-guard'
import { getComfyUIBase } from '@/lib/comfyui/server-state'
import { isFeatureUnlocked } from '@/lib/addons/entitlement'
import { videoWriterRefusal } from '@/lib/addons/video-writer-gate'
import { log, type LogCategory } from '@/lib/logging/logger'

// Classify a proxied path so the Logs tab can be filtered by what the traffic
// actually is (generation submissions vs. health polling vs. everything else).
function categorize(pathStr: string): LogCategory {
  if (pathStr.startsWith('prompt')) return 'generation'
  if (pathStr.startsWith('system_stats') || pathStr.startsWith('queue') || pathStr.startsWith('history')) return 'status'
  return 'comfyui'
}

// Headers we must NOT forward verbatim to ComfyUI:
// - origin/host/referer: ComfyUI rejects requests whose Origin host doesn't
//   match its own Host (returns 403), so a browser Origin of localhost:3000
//   against ComfyUI's 127.0.0.1:8188 would always be blocked. fetch sets the
//   right Host itself; dropping Origin/Referer makes the request same-origin.
// - content-length/connection: hop-by-hop / recomputed by fetch from the body.
const STRIPPED_HEADERS = new Set(['origin', 'host', 'referer', 'content-length', 'connection'])

function forwardHeaders(req: NextRequest): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of req.headers) {
    if (!STRIPPED_HEADERS.has(key.toLowerCase())) out[key] = value
  }
  return out
}

// The only request headers a GET carries upstream. ComfyUI's /view is an
// aiohttp FileResponse that answers Range with 206, and a <video> element can
// only seek when its source does: without these, Chromium saw 200 + chunked
// with no Accept-Ranges and treated every proxied clip as non-seekable — a
// `currentTime` set past 0 fired `seeked` with the clip still at 0.000, so a
// "last frame" grab silently returned the first frame.
const RANGE_REQUEST_HEADERS = ['range', 'if-range'] as const
// And the response headers that make the answer usable as a seekable source.
const RANGE_RESPONSE_HEADERS = ['content-range', 'content-length', 'accept-ranges', 'etag', 'last-modified'] as const

export async function GET(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const refused = guard(req)
  if (refused) return refused
  const { path } = await params
  const pathStr = path.join('/')
  const target = `${getComfyUIBase()}/${pathStr}${req.nextUrl.search}`
  const category = categorize(pathStr)
  const started = Date.now()
  try {
    const up: Record<string, string> = {}
    for (const h of RANGE_REQUEST_HEADERS) {
      const v = req.headers.get(h)
      if (v) up[h] = v
    }
    const res = await fetch(target, { cache: 'no-store', headers: up })
    const ms = Date.now() - started
    // Health polling is high-frequency — keep it at debug to avoid drowning the log.
    log(res.ok ? (category === 'status' ? 'debug' : 'info') : 'warn', category,
      `GET ${pathStr} → ${res.status} (${ms}ms)`)
    const headers: Record<string, string> = {
      'Content-Type': res.headers.get('Content-Type') ?? 'application/octet-stream',
    }
    // fetch decodes a compressed body transparently, so the upstream length
    // would describe bytes the client never receives.
    const decoded = res.headers.has('content-encoding')
    for (const h of RANGE_RESPONSE_HEADERS) {
      const v = res.headers.get(h)
      if (v && !(decoded && h === 'content-length')) headers[h] = v
    }
    // Streamed, not buffered: a clip is served as it arrives, and a byte-range
    // reply keeps the exact length its Content-Range promised.
    return new NextResponse(res.body, { status: res.status, headers })
  } catch (e) {
    log('error', category, `GET ${pathStr} failed: ${String(e)}`)
    return NextResponse.json({ error: 'ComfyUI unreachable', detail: String(e) }, { status: 502 })
  }
}

async function forwardBodyMethod(
  req: NextRequest,
  method: 'POST' | 'PATCH',
  path: string[],
) {
  const pathStr = path.join('/')
  const target = `${getComfyUIBase()}/${pathStr}`
  const category = categorize(pathStr)
  const body = await req.arrayBuffer()
  const locked = await videoWriterRefusal(pathStr, body, isFeatureUnlocked)
  if (locked) return locked
  const started = Date.now()
  try {
    const res = await fetch(target, { method, headers: forwardHeaders(req), body })
    const contentType = res.headers.get('Content-Type') ?? 'application/json'

    // SSE (the video prompt enhance stream, /rvn/*): pipe the body through
    // unbuffered. arrayBuffer() would wait for the whole stream to finish and
    // defeat live token streaming.
    if (contentType.includes('text/event-stream')) {
      log(res.ok ? 'info' : 'warn', category, `${method} ${pathStr} → ${res.status} (stream)`)
      return new NextResponse(res.body, {
        status: res.status,
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'X-Accel-Buffering': 'no',
        },
      })
    }

    const resBody = await res.arrayBuffer()
    const ms = Date.now() - started
    log(res.ok ? 'info' : 'warn', category, `${method} ${pathStr} → ${res.status} (${ms}ms)`)
    return new NextResponse(resBody, {
      status: res.status,
      headers: { 'Content-Type': contentType },
    })
  } catch (e) {
    log('error', category, `${method} ${pathStr} failed: ${String(e)}`)
    return NextResponse.json({ error: 'ComfyUI unreachable', detail: String(e) }, { status: 502 })
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const refused = guard(req)
  if (refused) return refused
  const { path } = await params
  return forwardBodyMethod(req, 'POST', path)
}

// PATCH is used by the system monitor to enable ComfyUI-Crystools' stream.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const refused = guard(req)
  if (refused) return refused
  const { path } = await params
  return forwardBodyMethod(req, 'PATCH', path)
}
