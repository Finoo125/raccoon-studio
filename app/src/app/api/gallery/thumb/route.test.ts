import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { execFileSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { NextRequest } from 'next/server'
import { imageId } from '@/lib/gallery/scanner'
import { thumbPath } from '@/lib/gallery/thumbs'
import { GET } from './route'

const hasFfmpeg = (() => {
  try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); return true } catch { return false }
})()

let tmp: string
const sub = 'video/H3/2026-06-12'
const get = (file: string) =>
  GET(new NextRequest(`http://localhost/api/gallery/thumb?id=${imageId(sub, file)}&v=1`))

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'raccoon-thumb-'))
  process.env.COMFYUI_OUTPUT_DIR = tmp
  process.env.RACCOON_THUMB_DIR = path.join(tmp, 'thumbs')
  const dir = path.join(tmp, sub)
  fs.mkdirSync(dir, { recursive: true })
  if (hasFfmpeg) {
    execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=red:s=640x360:d=0.2', '-pix_fmt', 'yuv420p', path.join(dir, 'clip.mp4')])
    execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=blue:s=768x1024', '-frames:v', '1', path.join(dir, 'pic.png')])
  }
  fs.writeFileSync(path.join(dir, 'broken.mp4'), 'not a video')
  fs.writeFileSync(path.join(dir, 'broken.png'), 'not a picture')
  fs.writeFileSync(path.join(dir, 'notes.txt'), 'x')
})
afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true })
  delete process.env.COMFYUI_OUTPUT_DIR
  delete process.env.RACCOON_THUMB_DIR
})

describe('/api/gallery/thumb', () => {
  it.skipIf(!hasFfmpeg)('answers a clip and a picture with a small, cacheable JPEG', async () => {
    for (const file of ['clip.mp4', 'pic.png']) {
      const res = await get(file)
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toBe('image/jpeg')
      expect(res.headers.get('cache-control')).toContain('immutable')
      expect(fs.existsSync(thumbPath(imageId(sub, file)))).toBe(true)
    }
  })

  it('sends a picture it cannot shrink to the original, and a clip to the tile fallback', async () => {
    const pic = await get('broken.png')
    expect(pic.status).toBe(307)
    expect(pic.headers.get('location')).toBe(`/api/gallery/image?filename=broken.png&subfolder=${encodeURIComponent(sub)}`)
    expect((await get('broken.mp4')).status).toBe(404)
  })

  it('serves gallery media only', async () => {
    expect((await get('notes.txt')).status).toBe(403)
    expect((await GET(new NextRequest('http://localhost/api/gallery/thumb?id=..%2F..'))).status).toBe(404)
  })
})
