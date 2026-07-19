import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { setSettings } from '@/lib/settings/settings'
import { ffmpegBin, ffprobeBin, friendlyFfmpegError } from './ffmpeg-bin'

let tmp: string
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'raccoon-ffbin-'))
  process.env.RACCOON_DATA_DIR = tmp
  delete process.env.FFMPEG_PATH
})
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true })
  delete process.env.RACCOON_DATA_DIR
})

describe('ffmpeg binary resolution', () => {
  it('falls back to PATH commands when unconfigured', () => {
    expect(ffmpegBin()).toBe('ffmpeg')
    expect(ffprobeBin()).toBe('ffprobe')
  })

  it('uses the configured path and resolves ffprobe next to it', () => {
    const ff = path.join(tmp, 'bin', 'ffmpeg.exe')
    setSettings({ ffmpegPath: ff })
    expect(ffmpegBin()).toBe(ff)
    expect(ffprobeBin()).toBe(path.join(tmp, 'bin', 'ffprobe.exe'))
  })

  it('maps ENOENT to an actionable message and passes other errors through', () => {
    expect(friendlyFfmpegError(new Error('spawn ffmpeg ENOENT'), 'ffmpeg')).toMatch(/Settings/)
    expect(friendlyFfmpegError(new Error('boom'), 'ffmpeg')).toBe('boom')
  })
})
