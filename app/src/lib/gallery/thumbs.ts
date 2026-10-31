import { execFile } from 'child_process'
import { promisify } from 'util'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { ffmpegBin } from '@/lib/movies/ffmpeg-bin'

const execFileAsync = promisify(execFile)

/** Where gallery thumbnails are kept. Env-overridable for tests, like the sidecar dir. */
export function getThumbDir(): string {
  return process.env.RACCOON_THUMB_DIR ?? path.join(process.cwd(), '.gallery-thumbs')
}

/** Hashed, because an id (base64 of folder + name) can outgrow Windows' path limit. */
export function thumbPath(id: string): string {
  return path.join(getThumbDir(), `${crypto.createHash('sha1').update(id).digest('hex')}.jpg`)
}

// The grid asks for every tile at once (121 on a first video page). A browser on
// HTTP/1.1 caps that at 6, but nothing does over HTTP/2 (RunPod's proxy), so
// ffmpeg itself is capped here.
const MAX_RUNNING = 4
let running = 0
const waiting: (() => void)[] = []
const inflight = new Map<string, Promise<boolean>>()

async function withSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (running < MAX_RUNNING) running++
  else await new Promise<void>((resolve) => waiting.push(resolve)) // a finishing call hands its slot over
  try {
    return await fn()
  } finally {
    const next = waiting.shift()
    if (next) next()
    else running--
  }
}

/**
 * Makes, once, a small JPEG of a picture or of a clip's first frame (512 px on
 * the short side, enough for a tile at 2x). A thumb older than its source is
 * made again. False when ffmpeg can't do it (not installed, unreadable file);
 * the caller then falls back to the original.
 */
export function ensureThumb(id: string, src: string, srcMtimeMs: number): Promise<boolean> {
  const out = thumbPath(id)
  const made = fs.statSync(out, { throwIfNoEntry: false })
  if (made && made.mtimeMs >= srcMtimeMs) return Promise.resolve(true)

  let job = inflight.get(out)
  if (!job) {
    job = withSlot(async () => {
      fs.mkdirSync(getThumbDir(), { recursive: true })
      const tmp = `${out}.${process.pid}.tmp.jpg` // renamed in whole: a half-written thumb is never served
      try {
        await execFileAsync(ffmpegBin(), [
          '-v', 'error', '-y', '-i', src, '-frames:v', '1', '-update', '1',
          '-vf', 'scale=512:512:force_original_aspect_ratio=increase', '-q:v', '4', tmp,
        ], { timeout: 30_000, windowsHide: true })
        fs.renameSync(tmp, out)
        return true
      } catch {
        fs.rmSync(tmp, { force: true })
        return false
      }
    }).finally(() => inflight.delete(out))
    inflight.set(out, job)
  }
  return job
}
