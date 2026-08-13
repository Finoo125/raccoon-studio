/**
 * The app-facing LTX Director timeline, and the one function that turns it into
 * the four strings the `LTXDirector` node actually reads.
 *
 * Everything the node knows about a timeline arrives as plain widget values —
 * `timeline_data` (JSON), `local_prompts`, `segment_lengths`, `guide_strength`.
 * Upstream's canvas editor is only a JS widget that writes them, which is why
 * driving the node headlessly needs no canvas port at all.
 *
 * This module is the single place where upstream's format leaks in. It owns the
 * seconds→frames conversion (we speak seconds, the node speaks pixel-space
 * frames) and nothing else in the app should construct those strings.
 */

/**
 * One block on the main track — a stretch of the clip.
 *
 * **Prompt and picture are the same object**, which is upstream's model and not
 * an app invention: `ltx_director.js` builds `local_prompts` by walking the
 * main track and taking `seg.prompt` off each block, and builds the guides from
 * the same blocks' `imageFile`. A block with no media is upstream's "Add Text"
 * block — a prompt window and nothing else.
 *
 * Blocks need not tile the clip. Gaps are absorbed into the preceding block's
 * prompt window (`toDirectorInputs`), so an empty timeline is not an error: it
 * is the node's own fast path, the whole clip on the global prompt alone.
 */
export interface DirectorShot {
  id: string
  startSec: number
  lengthSec: number
  /** Applied on top of the global prompt for these seconds. May be empty. */
  prompt: string

  // ── the optional picture ───────────────────────────────────────────────────
  /** Filename already uploaded to ComfyUI's input dir. Absent = a text block. */
  file?: string
  /**
   * A clip rather than a still. The node decodes `lengthSec` worth of frames
   * from `trimStartSec` and pins the whole run into the render — which is how a
   * video gets extended or partly kept.
   */
  kind?: 'image' | 'video'
  /** Guide strength, 0–1. Absent = 1.0 node-side. */
  strength?: number
  /** Seconds to skip from the head of a clip's source file. */
  trimStartSec?: number
  /** Natural duration of that source, so a trim cannot overrun it. */
  sourceDurationSec?: number
  /**
   * Source pixel size, when known. The node derives the whole render's latent
   * dimensions from the FIRST block with media, so recording this lets the
   * builder fit the render to that aspect instead of cropping into a guessed one.
   */
  width?: number
  height?: number
  /**
   * Pin a still to the END of its block rather than its start — i.e. make it
   * the last frame of that stretch. This is what a still's length is *for*;
   * without it, the length only sizes the prompt window.
   */
  isEndFrame?: boolean
}

/** Media laid onto the audio or motion lane. */
export interface DirectorMediaSegment {
  id: string
  startSec: number
  lengthSec: number
  /** Seconds to skip from the head of the source file. */
  trimStartSec: number
  /** Natural duration of that file, so a trim cannot overrun it. */
  sourceDurationSec?: number
  /** Filename already uploaded to ComfyUI's input dir. */
  file: string
}

export interface DirectorTimeline {
  durationSeconds: number
  fps: number
  /** Conditions the whole clip. Prepended to every block's tokens. */
  globalPrompt: string
  segments: DirectorShot[]
  audio: DirectorMediaSegment[]
  motion: DirectorMediaSegment[]
  /** Re-roll one span of an existing clip, keeping the rest. */
  retake?: {
    videoFile: string
    startSec: number
    lengthSec: number
    videoDurationSec: number
    /** Replaces the global prompt while retake is on (the node reads it separately). */
    prompt?: string
  }

  // ── lane switches ──────────────────────────────────────────────────────────
  // Off means "ignore this", not "delete it" — so a lane can be A/B'd without
  // losing the work in it. Undefined = on, so a timeline saved before these
  // existed still loads with everything active.
  /**
   * Prompt relay. Off sends the global prompt alone, which is the node's own
   * fast path (it skips attention masking entirely below two windows).
   */
  promptRelay?: boolean
  /**
   * Whether the blocks' pictures are used as guides. Named for the lane it used
   * to have, kept so timelines saved under that name still load.
   */
  keyframesOn?: boolean
  audioOn?: boolean
  motionOn?: boolean
  /** Fill silent gaps in the audio track with generated audio. */
  audioInpaint?: boolean
  /**
   * Which IC-LoRA reads the motion lane. Belongs to the timeline rather than the
   * form because it is meaningless without motion clips — the two travel
   * together through save/load and rerun.
   */
  motionIcLora?: string
}

/**
 * Default span for a block dropped on the track, matching upstream's canvas
 * editor (`handleImageUpload`: `frameRate * 1`).
 */
export const SHOT_LENGTH_SEC = 1

/** A lane switch that defaults to on when the timeline predates it. */
const on = (v: boolean | undefined) => v !== false

/**
 * How many shot pictures the prompt enhancer's vision pass is shown.
 *
 * ponytail: a hard 6. Each picture is another image the LLM has to look at, and
 * a ten-shot timeline turns a ten-second enhance into a minute of staring for a
 * blurrier prompt. Raise it if the timelines outgrow it.
 */
export const VISION_SHOT_LIMIT = 6

/**
 * The shots whose pictures go to the enhancer, in the order they play.
 *
 * Text-only blocks are skipped — they have nothing to look at — and the list is
 * capped, so the enhancer sees the opening of the film rather than all of it.
 */
export function visionShots(t: DirectorTimeline, limit = VISION_SHOT_LIMIT): DirectorShot[] {
  return t.segments
    .filter((s) => Boolean(s.file))
    .sort((a, b) => a.startSec - b.startSec)
    .slice(0, limit)
}

export interface DirectorNodeInputs {
  timeline_data: string
  local_prompts: string
  segment_lengths: string
  guide_strength: string
}

/** Total pixel-space frames for a timeline. The node re-snaps this to 8n+1. */
export function totalFrames(t: Pick<DirectorTimeline, 'durationSeconds' | 'fps'>): number {
  return Math.max(1, Math.round(t.durationSeconds * t.fps) + 1)
}

const toFrames = (sec: number, fps: number) => Math.max(0, Math.round(sec * fps))

/**
 * A fresh timeline has **no blocks**: the whole clip runs on the global prompt,
 * which is the node's fast path. One full-length block instead would mean the
 * first thing anyone does is shrink it before they can add a second.
 */
export function emptyTimeline(durationSeconds = 15, fps = 30): DirectorTimeline {
  return {
    durationSeconds,
    fps,
    globalPrompt: '',
    segments: [],
    audio: [],
    motion: [],
  }
}

/** Shape of the pre-2026-08-09 file: prompts and pictures on separate lanes. */
interface LegacyTimeline {
  segments?: { id?: string; startSec?: number; prompt?: string }[]
  keyframes?: {
    id?: string
    atSec?: number
    imageFile?: string
    lengthSec?: number
    [k: string]: unknown
  }[]
}

/**
 * Fold a saved timeline from the two-lane era into one track: shot boundaries
 * become block lengths, and each keyframe becomes a block carrying its picture.
 * Runs whenever a `keyframes` array is present or a block has no length.
 */
function migrate(raw: LegacyTimeline, durationSeconds: number): DirectorShot[] {
  const sorted = [...(raw.segments ?? [])].sort((a, b) => (a.startSec ?? 0) - (b.startSec ?? 0))
  const shots: DirectorShot[] = sorted.map((s, i) => {
    const start = Number(s.startSec) || 0
    const end = i + 1 < sorted.length ? (Number(sorted[i + 1].startSec) || 0) : durationSeconds
    return {
      id: String(s.id ?? `seg-${i + 1}`),
      startSec: start,
      lengthSec: Math.max(0.1, end - start),
      prompt: String(s.prompt ?? ''),
    }
  })
  for (const [i, k] of (raw.keyframes ?? []).entries()) {
    const { id, atSec, imageFile, lengthSec, ...rest } = k
    shots.push({
      ...(rest as Partial<DirectorShot>),
      id: String(id ?? `kf-${i + 1}`),
      startSec: Number(atSec) || 0,
      lengthSec: Number(lengthSec) || SHOT_LENGTH_SEC,
      prompt: '',
      file: String(imageFile ?? ''),
    })
  }
  return shots.filter((s) => s.file !== '' || s.prompt !== '' || (raw.segments?.length ?? 0) > 0)
}

/**
 * Parse a timeline loaded from a user-supplied file.
 *
 * A trust boundary: a missing lane would crash a `.map()` deep in render, and a
 * wrong shape would reach the node as garbage. Returns null rather than
 * throwing so the caller can show one message.
 */
export function parseTimeline(
  raw: unknown,
  fallback: { durationSeconds: number; fps: number },
): DirectorTimeline | null {
  if (typeof raw !== 'object' || raw === null) return null
  const t = raw as Partial<DirectorTimeline> & LegacyTimeline
  const lanes = [t.segments, t.keyframes, t.audio, t.motion]
  if (!lanes.every((l) => l === undefined || Array.isArray(l))) return null
  if (!Array.isArray(t.segments)) return null
  if (!t.segments.every((s) => s && typeof s.id === 'string')) return null

  const num = (v: unknown, d: number) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d)
  const durationSeconds = num(t.durationSeconds, fallback.durationSeconds)
  const legacy = Array.isArray(t.keyframes) || t.segments.some((s) => !(Number(s.lengthSec) > 0))

  return {
    durationSeconds,
    fps: num(t.fps, fallback.fps),
    globalPrompt: String(t.globalPrompt ?? ''),
    segments: legacy
      ? migrate(t, durationSeconds)
      : (t.segments as DirectorShot[]).map((s) => ({
          ...s,
          startSec: Number(s.startSec) || 0,
          lengthSec: num(s.lengthSec, SHOT_LENGTH_SEC),
          prompt: String(s.prompt ?? ''),
        })),
    audio: t.audio ?? [],
    motion: t.motion ?? [],
    ...(t.retake ? { retake: t.retake } : {}),
    // Only carry a switch that was explicitly saved off; anything else (missing,
    // or a non-boolean from a hand-edited file) falls back to on.
    ...(Object.fromEntries(
      (['promptRelay', 'keyframesOn', 'audioOn', 'motionOn', 'audioInpaint'] as const)
        .filter((k) => t[k] === false)
        .map((k) => [k, false]),
    ) as Partial<DirectorTimeline>),
  }
}

/**
 * The prompt-relay windows: one per block, in start order, covering the clip
 * end to end.
 *
 * Blocks may leave gaps, and the node has no notion of one — `segment_lengths`
 * is a bare sequential list that `distribute_segment_lengths` walks with a
 * cursor. So a gap is absorbed into the window before it (or into the first
 * window, when it opens the clip), exactly as `ltx_director.js` does it. The
 * lengths therefore always sum to the frame count, which is what stops the node
 * from silently clipping the last window.
 */
function relayWindows(t: DirectorTimeline): { lengths: number[]; prompts: string[] } {
  const total = totalFrames(t)
  const sorted = [...t.segments].sort((a, b) => a.startSec - b.startSec)
  const lengths: number[] = []
  const prompts: string[] = []
  let cursor = 0
  let pendingGap = 0

  for (const s of sorted) {
    const end = Math.min(toFrames(s.startSec + s.lengthSec, t.fps), total)
    // An overlap is resolved in favour of whoever got there first, and a block
    // that rounds away to nothing at this fps is skipped rather than emitted as
    // a zero-length window (which would desync prompts from lengths).
    const from = Math.max(Math.min(toFrames(s.startSec, t.fps), total), cursor)
    if (end <= from) continue

    if (from > cursor) {
      const gap = from - cursor
      if (lengths.length > 0) lengths[lengths.length - 1] += gap
      else pendingGap += gap
    }
    lengths.push(end - from + pendingGap)
    prompts.push(s.prompt.trim())
    pendingGap = 0
    cursor = end
  }

  if (lengths.length > 0 && cursor < total) lengths[lengths.length - 1] += total - cursor
  return { lengths, prompts }
}

/** The blocks that carry a picture, in the order the node pairs strengths in. */
export function guideShots(t: DirectorTimeline): DirectorShot[] {
  if (!on(t.keyframesOn)) return []
  return t.segments.filter((s) => s.file).sort((a, b) => a.startSec - b.startSec)
}

/**
 * Serialise a timeline into the four `LTXDirector` widget values.
 *
 * Guarantees the node's own preconditions, both of which it enforces by
 * raising: `local_prompts` and `segment_lengths` have equal counts, and guides
 * are emitted in start order because the node sorts image segments by `start`
 * and then indexes `guide_strength` positionally.
 */
export function toDirectorInputs(t: DirectorTimeline): DirectorNodeInputs {
  const total = totalFrames(t)

  // Relay off: no windows at all. The node splits `local_prompts` on '|', sees a
  // single empty entry and takes its documented fast path — global prompt only,
  // no attention masking, no per-window cost.
  const { lengths, prompts } = on(t.promptRelay)
    ? relayWindows(t)
    : { lengths: [], prompts: [] }

  const guides = guideShots(t)

  const media = (m: DirectorMediaSegment, fileKey: 'audioFile' | 'videoFile') => ({
    [fileKey]: m.file,
    start: toFrames(m.startSec, t.fps),
    length: Math.max(1, toFrames(m.lengthSec, t.fps)),
    trimStart: toFrames(m.trimStartSec, t.fps),
  })

  const timeline: Record<string, unknown> = {
    global_prompt: t.globalPrompt,
    segments: guides.map((s) => {
      // Clamped inside the clip: the node drops any segment starting at or past
      // the end, so an out-of-range block would vanish along with its strength
      // and silently shift every later strength by one.
      const start = Math.min(toFrames(s.startSec, t.fps), total - 1)
      return {
        type: s.kind === 'video' ? 'video' : 'image',
        imageFile: s.file,
        start,
        // `isEndFrame` pins at start+length-1, and a clip decodes exactly this
        // many frames — so this is not cosmetic in either case.
        length: Math.max(1, Math.min(toFrames(s.lengthSec, t.fps), total - start)),
        ...(s.kind === 'video' ? { trimStart: toFrames(s.trimStartSec ?? 0, t.fps) } : {}),
        ...(s.isEndFrame ? { isEndFrame: true } : {}),
      }
    }),
    audioSegments: on(t.audioOn) ? t.audio.map((m) => media(m, 'audioFile')) : [],
    motionSegments: on(t.motionOn) ? t.motion.map((m) => media(m, 'videoFile')) : [],
  }

  if (t.retake) {
    timeline.retakeMode = true
    timeline.retakeVideo = {
      imageFile: t.retake.videoFile,
      videoDurationFrames: Math.max(1, toFrames(t.retake.videoDurationSec, t.fps)),
    }
    timeline.retakeStart = toFrames(t.retake.startSec, t.fps)
    timeline.retakeLength = Math.max(1, toFrames(t.retake.lengthSec, t.fps))
    // The node reads this INSTEAD of global_prompt while retake is on, so an
    // empty one would blank the prompt rather than inherit it.
    timeline.retake_global_prompt = t.retake.prompt?.trim() || t.globalPrompt
  }

  return {
    timeline_data: JSON.stringify(timeline),
    local_prompts: prompts.join('|'),
    segment_lengths: lengths.join(','),
    guide_strength: guides.map((s) => s.strength ?? 1).join(','),
  }
}
