/**
 * Every edit the Director timeline can make, as pure `timeline -> timeline`
 * functions.
 *
 * They live here rather than as closures in the editor component so they can be
 * tested without a DOM — this project has no component-test stack on purpose
 * (jsdom + testing-library would be ~20 MB of devDependencies that every user
 * downloads, because the installers run a plain `npm install`). Keeping the
 * logic pure is what buys the coverage instead.
 *
 * All three lanes hold the same kind of thing: a block with a start and a
 * length, sometimes windowing a file. So moving and resizing are written once
 * against that shape, and the lane only decides which array they land in.
 */

import { SHOT_LENGTH_SEC, type DirectorTimeline, type DirectorMediaSegment, type DirectorShot } from './director-timeline'

/**
 * The shortest a block can be. Upstream's canvas uses 6 frames
 * (`MIN_SEGMENT_LENGTH`), which is 0.2 s at its 30 fps default — and 6 is not
 * arbitrary: the latent time compression is 8, so anything shorter is rounded
 * away by the guide encoder anyway.
 */
export const MIN_SPAN = 0.2

export type Lane = 'shots' | 'audio' | 'motion'
export type Edge = 'left' | 'right'

/** What every lane's items have in common. */
interface Block {
  id: string
  startSec: number
  lengthSec: number
  /** Present = the block is a window onto a file, so its edges trim. */
  trimStartSec?: number
  /** Natural length of that file, when known. */
  sourceDurationSec?: number
}

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/** Blocks sorted by start time. Callers hold them unsorted. */
export function sortedSegments(t: DirectorTimeline): DirectorShot[] {
  return [...t.segments].sort((a, b) => a.startSec - b.startSec)
}

const blocksOf = (t: DirectorTimeline, lane: Lane): Block[] =>
  lane === 'shots' ? t.segments : t[lane]

/** Apply `fn` to one block, leaving the rest of the lane and timeline alone. */
function withBlock(
  t: DirectorTimeline,
  lane: Lane,
  id: string,
  fn: (b: Block, siblings: Block[]) => Partial<Block>,
): DirectorTimeline {
  const items = blocksOf(t, lane)
  const target = items.find((b) => b.id === id)
  if (!target) return t
  const patch = fn(target, items)
  const apply = <T extends Block>(b: T): T => (b.id === id ? { ...b, ...patch } : b)
  return lane === 'shots'
    ? { ...t, segments: t.segments.map(apply) }
    : { ...t, [lane]: t[lane].map(apply) }
}

/**
 * How far a block may travel before it runs into its neighbours.
 *
 * ponytail: neighbours block the way rather than being pushed aside. Upstream
 * shoves them along (`_applyCenterDragPhysics`); a clamp is a tenth of the code
 * and makes an overlap — which would emit two prompt windows for one stretch —
 * unrepresentable instead of something the serializer has to resolve.
 */
function room(b: Block, siblings: Block[], durationSeconds: number) {
  const others = siblings.filter((x) => x.id !== b.id).sort((x, y) => x.startSec - y.startSec)
  const mid = b.startSec + b.lengthSec / 2
  const prev = [...others].reverse().find((x) => x.startSec + x.lengthSec / 2 <= mid)
  const next = others.find((x) => x.startSec + x.lengthSec / 2 > mid)
  return {
    lo: prev ? prev.startSec + prev.lengthSec : 0,
    hi: next ? next.startSec : durationSeconds,
  }
}

/**
 * A fresh id that collides with nothing currently in the timeline.
 *
 * `counter` restarts at 0 on every mount, so it alone is not enough — a
 * restored timeline already holds whatever a past session produced, and a
 * duplicate id means duplicate React keys AND edits that hit both items.
 * Returns the next counter value alongside the id so the caller can store it.
 */
export function makeId(t: DirectorTimeline, prefix: string, counter: number): [string, number] {
  const used = new Set([...t.segments, ...t.audio, ...t.motion].map((b) => b.id))
  let n = counter
  let id: string
  do {
    id = `${prefix}-${(n += 1)}`
  } while (used.has(id))
  return [id, n]
}

/**
 * A new block in the free space at `sec` — upstream's "Add Text".
 *
 * Returns `null` when there is no room, so the caller can say why rather than
 * dropping a zero-length block nobody can grab.
 */
export function makeShot(
  t: DirectorTimeline,
  id: string,
  sec: number,
  over: Partial<DirectorShot> = {},
): DirectorShot | null {
  const sorted = [...t.segments].sort((a, b) => a.startSec - b.startSec)
  // Walk forward to the first free stretch at or after `sec`, so dropping a shot
  // on top of one that is already there lands it after that one rather than
  // failing. Upstream does the same (`addTextSegmentFreeSpace`).
  let from = clamp(sec, 0, t.durationSeconds)
  for (const s of sorted) {
    const end = s.startSec + s.lengthSec
    if (end <= from) continue
    if (s.startSec > from) break
    from = end
  }
  const next = sorted.find((s) => s.startSec >= from)
  const available = (next ? next.startSec : t.durationSeconds) - from
  if (available < MIN_SPAN) return null
  return {
    prompt: '',
    ...over,
    id,
    startSec: from,
    lengthSec: Math.min(over.lengthSec ?? SHOT_LENGTH_SEC, available),
  }
}

/**
 * Cut the block under `sec` in two. The picture stays with the left half — it
 * is pinned at a moment, and that moment is on that side of the cut.
 *
 * Returns the timeline unchanged when the cut lands outside every block or too
 * close to an edge to leave two grabbable halves.
 */
export function splitShot(t: DirectorTimeline, sec: number, id: string): DirectorTimeline {
  const target = t.segments.find(
    (s) => sec > s.startSec + MIN_SPAN && sec < s.startSec + s.lengthSec - MIN_SPAN,
  )
  if (!target) return t
  const right: DirectorShot = {
    id,
    startSec: sec,
    lengthSec: target.startSec + target.lengthSec - sec,
    prompt: target.prompt,
  }
  return {
    ...t,
    segments: [
      ...t.segments.map((s) => (s.id === target.id ? { ...s, lengthSec: sec - s.startSec } : s)),
      right,
    ],
  }
}

/** Slide a block along its lane, keeping it whole and out of its neighbours. */
export function moveItem(
  t: DirectorTimeline,
  lane: Lane,
  id: string,
  sec: number,
): DirectorTimeline {
  return withBlock(t, lane, id, (b, siblings) => {
    const { lo, hi } = room(b, siblings, t.durationSeconds)
    return { startSec: clamp(sec, lo, Math.max(lo, hi - b.lengthSec)) }
  })
}

/**
 * Drag one edge of a block to `sec` — the gesture every lane shares.
 *
 * Two behaviours, picked by whether the block has source material behind it:
 *
 * - **Trim** (audio, motion, video guides): the left edge slides the window
 *   *into* the file, so `trimStartSec` moves with `startSec` and neither edge
 *   can be dragged past material that does not exist.
 * - **Stretch** (text blocks, stills): there is nothing to run out of, so the
 *   edge only has to stay inside the render, clear of its neighbours, and leave
 *   `MIN_SPAN` behind.
 */
export function resizeItem(
  t: DirectorTimeline,
  lane: Lane,
  id: string,
  edge: Edge,
  sec: number,
): DirectorTimeline {
  return withBlock(t, lane, id, (b, siblings) => {
    const { lo, hi } = room(b, siblings, t.durationSeconds)
    const trim = b.trimStartSec
    const source = b.sourceDurationSec

    if (edge === 'right') {
      // Never past the end of the render, into the next block, or past the end
      // of the material.
      const ceiling = source === undefined ? hi : Math.min(hi, b.startSec + source - (trim ?? 0))
      return { lengthSec: clamp(sec, b.startSec + MIN_SPAN, Math.max(b.startSec + MIN_SPAN, ceiling)) - b.startSec }
    }

    // Dragging the head back can only expose material that is actually there:
    // `start - trim` is where frame 0 of the file would land.
    const floor = trim === undefined ? lo : Math.max(lo, b.startSec - trim)
    const startSec = clamp(sec, floor, b.startSec + b.lengthSec - MIN_SPAN)
    const delta = startSec - b.startSec
    return {
      startSec,
      lengthSec: b.lengthSec - delta,
      ...(trim === undefined ? {} : { trimStartSec: Math.max(0, trim + delta) }),
    }
  })
}

/** Shape a newly-uploaded audio/motion file into a clip that fits the render. */
export function makeMediaClip(
  t: DirectorTimeline,
  id: string,
  file: string,
  startSec: number,
  naturalDurationSec: number,
): DirectorMediaSegment {
  const start = clamp(startSec, 0, Math.max(0, t.durationSeconds - MIN_SPAN))
  return {
    id,
    startSec: start,
    lengthSec: Math.max(MIN_SPAN, Math.min(naturalDurationSec, t.durationSeconds - start)),
    trimStartSec: 0,
    sourceDurationSec: naturalDurationSec,
    file,
  }
}

/**
 * Remove the selected block. Every block is removable — an empty track is the
 * node's own fast path (the whole clip on the global prompt), not an error.
 */
export function removeItem(t: DirectorTimeline, lane: Lane, id: string): DirectorTimeline {
  return lane === 'shots'
    ? { ...t, segments: t.segments.filter((s) => s.id !== id) }
    : { ...t, [lane]: t[lane].filter((m) => m.id !== id) }
}

/** Everything about a block that only means something while it has a picture. */
const MEDIA_FIELDS = [
  'file', 'kind', 'strength', 'trimStartSec', 'sourceDurationSec', 'width', 'height', 'isEndFrame',
] as const

/**
 * Take the picture off a block, leaving the prompt window it was attached to.
 * All of it has to go, not just the filename: a text block still carrying a
 * trim and a source duration would keep trimming a file it no longer has.
 */
export function detachMedia(t: DirectorTimeline, id: string): DirectorTimeline {
  return {
    ...t,
    segments: t.segments.map((s) => {
      if (s.id !== id) return s
      const out = { ...s }
      for (const k of MEDIA_FIELDS) delete out[k]
      return out
    }),
  }
}
