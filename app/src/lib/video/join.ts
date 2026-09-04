/**
 * Joining a chain of continuation clips into one file.
 *
 * Deliberately **not** in `lib/movies/`: Movie Maker is a paid add-on and this
 * is part of the free continue-video path, so it must not sit behind — or look
 * like it sits behind — that gate. It is also a much smaller thing than Movie
 * Maker's timeline: clips laid end to end, no edit model.
 *
 * Pure arg-builders, so the arithmetic and the escaping are unit-testable
 * without spawning anything; the route does the spawning.
 */

/**
 * A concat-demuxer list file.
 *
 * Forward slashes even on Windows, because ffmpeg's concat parser treats a
 * backslash as an escape character — `C:\video\new.mp4` would swallow the `\n`
 * and produce a path that does not exist. Single quotes inside a path are
 * escaped the way ffmpeg documents (`'\''`), which is the only other character
 * that can break the line.
 */
export function buildConcatList(absolutePaths: string[]): string {
  return (
    absolutePaths
      .map((p) => `file '${p.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`)
      .join('\n') + '\n'
  )
}

/**
 * ffmpeg args for a stream copy of the listed clips.
 *
 * `-c copy` because every clip in a chain comes out of the same H3 graph at the
 * same resolution, fps and 32 kHz stereo — so there is nothing to re-encode,
 * and re-encoding would cost a generation of quality for nothing. `-safe 0`
 * allows absolute paths in the list.
 */
export function buildConcatArgs(listPath: string, outPath: string): string[] {
  return [
    '-y',
    '-f', 'concat',
    '-safe', '0',
    '-i', listPath,
    '-c', 'copy',
    outPath,
  ]
}

/** What `assertJoinable` complains about, or null when the clips can be joined. */
export type ClipShape = {
  sampleRate: number | null
  codec: string | null
  audioCodec: string | null
  width: number | null
  height: number | null
}

/**
 * Refuse a stream copy that would silently produce a broken file.
 *
 * A concat stream copy cannot change format partway. The audio rate is the
 * dangerous one: H3 emits **32 kHz**, and a chain that mixed rates would play
 * the tail as silence or noise while every duration check still passed. Codec
 * and frame size are checked for the same reason, and because the failure is
 * cheap to prevent and expensive to diagnose from the resulting file.
 */
export function assertJoinable(shapes: ClipShape[]): string | null {
  if (shapes.length < 2) return 'Need at least two clips to join'
  const [first, ...rest] = shapes
  for (const [i, s] of rest.entries()) {
    const at = `clip ${i + 2}`
    if (s.sampleRate !== first.sampleRate) {
      return `${at} has a different audio rate (${s.sampleRate} Hz vs ${first.sampleRate} Hz) — a stream copy cannot change rate partway`
    }
    if (s.codec !== first.codec) return `${at} has a different video codec (${s.codec} vs ${first.codec})`
    if (s.audioCodec !== first.audioCodec) {
      return `${at} has a different audio codec (${s.audioCodec} vs ${first.audioCodec})`
    }
    if (s.width !== first.width || s.height !== first.height) {
      return `${at} is ${s.width}x${s.height}, but the first clip is ${first.width}x${first.height}`
    }
  }
  return null
}

/**
 * Put selected clips into the order they should play.
 *
 * **By creation time, not selection order.** A chain is rendered oldest-first,
 * but the gallery hands back whatever order the user happened to click in, and
 * a concat is silent about being wrong — you get a video that plays the middle
 * first and looks like the model lost the plot. Ties keep their relative order
 * (`sort` is stable), so two clips written in the same second stay put rather
 * than shuffling between calls.
 */
export function orderClipsForJoin<T extends { createdAt: string }>(clips: T[]): T[] {
  return [...clips].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
}

/**
 * A finished clip's `{filename, subfolder}` pulled out of any of its urls.
 *
 * **Separators are normalised to forward slashes**, and that is load-bearing on
 * Windows. ComfyUI reports a render's subfolder with OS separators
 * (`video\MinimaxH3\2026-08-29`) while everything derived from the gallery
 * uses `/`. Comparing the two forms silently never matches: `deriveChain` did
 * its first hop, failed to find the parent's job, and stopped — a three-clip
 * chain offered to join only two, with nothing reporting an error.
 */
export function clipRefFromUrl(url: string): { filename: string; subfolder: string } | null {
  const q = new URLSearchParams(url.split('?')[1] ?? '')
  const filename = q.get('filename')
  return filename ? { filename, subfolder: (q.get('subfolder') ?? '').replace(/\\/g, '/') } : null
}

/** Output-dir-relative path, the form `continueFrom` records. */
export const refToPath = (r: { filename: string; subfolder: string }): string =>
  r.subfolder ? `${r.subfolder}/${r.filename}` : r.filename

/**
 * Reconstruct the chain that ends at the newest clip, oldest first.
 *
 * **Derived from job history rather than tracked in a store.** Every
 * continuation already records the clip it came from (`continueFrom`) and the
 * clip it produced, so the chain is a link the data already contains — keeping
 * a parallel list would only create something that can disagree with it.
 *
 * This is also what makes a rejected take disappear on its own: regenerating a
 * link renders it again from the *same* parent, so the discarded attempt is
 * simply not on the path back and never reaches the join.
 *
 * `jobs` is newest-first, matching the queue. Walking stops at a clip whose
 * parent has no job — a chain begun in an earlier session — which yields the
 * part that is knowable rather than nothing.
 */
export function deriveChain(jobs: { path: string; continueFrom?: string }[]): string[] {
  const newest = jobs[0]
  if (!newest) return []
  const byPath = new Map(jobs.map((j) => [j.path, j]))
  const chain = [newest.path]
  const seen = new Set(chain)
  let parent = newest.continueFrom
  // `seen` guards against a cycle: a self-referencing or looping `continueFrom`
  // would otherwise spin here forever.
  while (parent && !seen.has(parent)) {
    chain.unshift(parent)
    seen.add(parent)
    parent = byPath.get(parent)?.continueFrom
  }
  return chain
}
