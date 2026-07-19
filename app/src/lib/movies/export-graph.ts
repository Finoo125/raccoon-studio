import type { MovieAsset, MovieClip, MovieProject } from '@/types/movie'
import { ABUT_EPS, clipDuration, clipEnd, sortClips, timelineDuration } from './timeline-core'

export interface ExportSettings { width: number; height: number; fps: number }

export interface BuiltExport {
  /** Full ffmpeg argument list (without the binary name) */
  args: string[]
  durationSec: number
}

const f3 = (n: number) => n.toFixed(3)

export function buildExportArgs(
  project: MovieProject,
  settings: ExportSettings,
  outputPath: string,
): BuiltExport {
  const { width: W, height: H, fps } = settings
  const assets = new Map(project.assets.map((a) => [a.id, a]))
  const usable = (c: MovieClip): MovieAsset | null => {
    const a = assets.get(c.assetId)
    return a && !a.offline ? a : null
  }

  const total = timelineDuration(
    project.tracks.map((t) => ({ ...t, clips: t.clips.filter((c) => usable(c)) })),
  )
  if (total <= 0) throw new Error('Timeline is empty')

  const inputs: string[] = []
  const filters: string[] = []
  let inputIdx = 0
  let labelIdx = 0
  const nextLabel = (prefix: string) => `${prefix}${labelIdx++}`
  const addInput = (asset: MovieAsset, clip: MovieClip): number => {
    if (asset.kind === 'image') inputs.push('-loop', '1', '-t', f3(clipDuration(clip)), '-i', asset.path)
    else inputs.push('-i', asset.path)
    return inputIdx++
  }

  // ---- per video track: full-length stream (black gaps, concat/xfade joins)
  const trackOut: { label: string; windows: Array<[number, number]> }[] = []

  for (const track of project.tracks.filter((t) => t.kind === 'video')) {
    const clips = sortClips(track.clips).filter((c) => usable(c))
    if (clips.length === 0) continue

    const segs: { label: string; dur: number; fade: number }[] = []
    let cursor = 0
    for (const clip of clips) {
      const asset = usable(clip)!
      const fade = clip.crossfadeWithPrevious ?? 0
      const gap = clip.startSec - cursor
      if (gap > ABUT_EPS && fade <= ABUT_EPS) {
        const l = nextLabel('blk')
        filters.push(`color=c=black:s=${W}x${H}:r=${fps}:d=${f3(gap)}[${l}]`)
        segs.push({ label: l, dur: gap, fade: 0 })
      }
      const idx = addInput(asset, clip)
      const l = nextLabel('vc')
      const trim = asset.kind === 'image' ? '' : `trim=${f3(clip.inSec)}:${f3(clip.outSec)},`
      filters.push(
        `[${idx}:v]${trim}setpts=PTS-STARTPTS,fps=${fps},` +
        `scale=${W}:${H}:force_original_aspect_ratio=decrease,` +
        `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,setsar=1,format=yuv420p[${l}]`,
      )
      segs.push({ label: l, dur: clipDuration(clip), fade })
      cursor = clipEnd(clip)
    }

    let accLabel = segs[0].label
    let accDur = segs[0].dur
    for (let i = 1; i < segs.length; i++) {
      const seg = segs[i]
      const out = nextLabel('tv')
      if (seg.fade > ABUT_EPS) {
        filters.push(
          `[${accLabel}][${seg.label}]xfade=transition=fade:duration=${f3(seg.fade)}:offset=${f3(accDur - seg.fade)}[${out}]`,
        )
        accDur += seg.dur - seg.fade
      } else {
        filters.push(`[${accLabel}][${seg.label}]concat=n=2:v=1:a=0[${out}]`)
        accDur += seg.dur
      }
      accLabel = out
    }
    if (total - accDur > ABUT_EPS) {
      const out = nextLabel('tp')
      filters.push(`[${accLabel}]tpad=stop_mode=add:stop_duration=${f3(total - accDur)}:color=black[${out}]`)
      accLabel = out
    }

    const windows: Array<[number, number]> = []
    for (const clip of clips) {
      const s = clip.startSec
      const e = clipEnd(clip)
      const last = windows[windows.length - 1]
      if (last && s <= last[1] + ABUT_EPS) last[1] = Math.max(last[1], e)
      else windows.push([s, e])
    }
    trackOut.push({ label: accLabel, windows })
  }

  if (trackOut.length === 0) throw new Error('No video clips to export')

  let vLabel = trackOut[0].label
  for (let i = 1; i < trackOut.length; i++) {
    const t = trackOut[i]
    const out = nextLabel('ov')
    const enable = t.windows.map(([s, e]) => `between(t,${f3(s)},${f3(e)})`).join('+')
    filters.push(`[${vLabel}][${t.label}]overlay=enable='${enable}':eof_action=pass[${out}]`)
    vLabel = out
  }

  // ---- audio: video-clip audio + audio-track clips, mixed
  const audioLabels: string[] = []
  for (const track of project.tracks) {
    for (const clip of sortClips(track.clips)) {
      const asset = usable(clip)
      if (!asset || clip.volume <= 0) continue
      const audible = track.kind === 'audio'
        ? asset.kind !== 'image'
        : asset.kind === 'video' && asset.hasAudio
      if (!audible) continue
      const idx = addInput(asset, clip)
      const l = nextLabel('ac')
      filters.push(
        `[${idx}:a]atrim=${f3(clip.inSec)}:${f3(clip.outSec)},asetpts=PTS-STARTPTS,` +
        `volume=${f3(clip.volume)},adelay=${Math.round(clip.startSec * 1000)}:all=1[${l}]`,
      )
      audioLabels.push(l)
    }
  }

  let aLabel: string
  if (audioLabels.length === 0) {
    aLabel = nextLabel('an')
    filters.push(`anullsrc=channel_layout=stereo:sample_rate=48000,atrim=0:${f3(total)}[${aLabel}]`)
  } else if (audioLabels.length === 1) {
    aLabel = audioLabels[0]
  } else {
    aLabel = nextLabel('am')
    filters.push(`[${audioLabels.join('][')}]amix=inputs=${audioLabels.length}:duration=longest:normalize=0[${aLabel}]`)
  }

  const args = [
    '-y',
    ...inputs,
    '-filter_complex', filters.join(';'),
    '-map', `[${vLabel}]`, '-map', `[${aLabel}]`,
    '-t', f3(total),
    '-r', String(fps),
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '192k',
    outputPath,
  ]
  return { args, durationSec: total }
}
