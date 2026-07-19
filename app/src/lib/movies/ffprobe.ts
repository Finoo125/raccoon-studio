import { execFile } from 'child_process'
import { promisify } from 'util'
import { ffprobeBin, friendlyFfmpegError } from './ffmpeg-bin'

const execFileAsync = promisify(execFile)

export interface ProbeResult {
  durationSec: number
  width?: number
  height?: number
  hasAudio: boolean
  hasVideo: boolean
}

export async function probeMedia(filePath: string): Promise<ProbeResult> {
  const bin = ffprobeBin()
  let stdout: string
  try {
    ({ stdout } = await execFileAsync(bin, [
      '-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', filePath,
    ]))
  } catch (e) {
    throw new Error(friendlyFfmpegError(e, bin))
  }
  const data = JSON.parse(stdout) as {
    format?: { duration?: string }
    streams?: Array<{ codec_type?: string; width?: number; height?: number; duration?: string }>
  }
  const streams = data.streams ?? []
  const video = streams.find((s) => s.codec_type === 'video')
  const audio = streams.find((s) => s.codec_type === 'audio')
  return {
    durationSec: parseFloat(data.format?.duration ?? video?.duration ?? audio?.duration ?? '0') || 0,
    width: video?.width,
    height: video?.height,
    hasAudio: Boolean(audio),
    hasVideo: Boolean(video),
  }
}
