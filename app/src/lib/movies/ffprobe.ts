import { execFile } from 'child_process'
import { promisify } from 'util'
import { ffprobeBin, friendlyFfmpegError } from './ffmpeg-bin'

const execFileAsync = promisify(execFile)

export interface ProbeResult {
  durationSec: number
  /** The video stream's own duration — the container's can include audio overhang. */
  videoDurationSec: number
  /** CODED size: a portrait phone clip reports 1920×1080 here, see `rotation`. */
  width?: number
  height?: number
  /** Display rotation in degrees (Display Matrix or the legacy `rotate` tag), 0 when none. */
  rotation: number
  hasAudio: boolean
  hasVideo: boolean
}

type ProbeJson = {
  format?: { duration?: string }
  streams?: Array<{
    codec_type?: string; width?: number; height?: number; duration?: string
    side_data_list?: Array<{ rotation?: number }>; tags?: { rotate?: string }
  }>
}

/** The fields we read off `ffprobe -show_format -show_streams` JSON. */
export function parseProbe(data: ProbeJson): ProbeResult {
  const streams = data.streams ?? []
  const video = streams.find((s) => s.codec_type === 'video')
  const audio = streams.find((s) => s.codec_type === 'audio')
  const durationSec = parseFloat(data.format?.duration ?? video?.duration ?? audio?.duration ?? '0') || 0
  const matrix = video?.side_data_list?.find((d) => typeof d.rotation === 'number')?.rotation
  return {
    durationSec,
    videoDurationSec: parseFloat(video?.duration ?? '') || durationSec,
    width: video?.width,
    height: video?.height,
    rotation: matrix ?? (parseFloat(video?.tags?.rotate ?? '') || 0),
    hasAudio: Boolean(audio),
    hasVideo: Boolean(video),
  }
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
  return parseProbe(JSON.parse(stdout) as ProbeJson)
}
