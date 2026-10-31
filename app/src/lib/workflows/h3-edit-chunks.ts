/**
 * How an H3 edit is split into parts that each render cleanly.
 *
 * Measured 2026-10-03 (owner folder `261003 - H3 Video Edit Referenzen`): an
 * edit breaks — no edit, then noise toward the end — once the sampler carries
 * too many tokens. The edit carries the clip twice (the render plus its
 * anchored copy), so the count is 2 × latent frames × latent cells: 8 s at
 * 608×1056 (71,478) and the same with one picture (72,105) rendered clean,
 * 9.4 s at 608×1056 (84,018) broke, 9.4 s at 512×864 (57,888) rendered clean.
 * SageAttention is not the cause — PyTorch attention only delays it.
 *
 * Pure: no graph, no params. `minimax-h3.ts` and the form both read it through
 * `h3EditPlan`.
 */

export const H3_EDIT_TOKEN_CAP = 72_500

export type EditJoin = 'seamless' | 'fast'

/**
 * Frames each later part re-covers at its head, dropped when stitching. Both
 * keep every part on H3's 17k+5 grid: 39 = 2×17+5 is also the frozen tail
 * `RaccoonH3MaskedPrefix` holds (= H3_CONTEXT_FRAMES), and 5 is the smallest
 * pad that lets independent parts add up to a grid length at all.
 */
export const EDIT_JOIN_OVERLAP: Record<EditJoin, number> = { seamless: 39, fast: 5 }

export const latentFrames = (frames: number): number => Math.floor((frames - 5) / 17) * 5 + 2

export type EditFollow = 'exact' | 'loose'

/**
 * What the source clip adds, as a share of the render's own tokens: Exactly
 * anchors a full-size copy (1); Loosely hands it over as a reference video at
 * half size in each direction (1/4) — full size is the noise case.
 */
const SOURCE_SHARE: Record<EditFollow, number> = { exact: 1, loose: 0.25 }

/** Each reference picture rides through every step as one frame's worth of cells. */
export const editTokens = (frames: number, cells: number, pictures = 0, follow: EditFollow = 'exact'): number =>
  Math.ceil((1 + SOURCE_SHARE[follow]) * latentFrames(frames) * cells) + pictures * cells

export interface EditChunk {
  /** First source frame this part loads (VHS `skip_first_frames`). */
  start: number
  /** Its length on the 17k+5 grid (VHS `frame_load_cap`, the conditioning's `length`). */
  frames: number
  /** Frames dropped from its head when stitching — 0 for the first part. */
  overlap: number
}

/**
 * The fewest equal-ish parts (lengths differ by at most one grid step) that
 * each stay under the cap and together deliver exactly `total` frames.
 * A clip that fits is one part, unchanged.
 */
export function planEditChunks(
  total: number,
  cells: number,
  join: EditJoin,
  pictures = 0,
  follow: EditFollow = 'exact',
): EditChunk[] {
  if (editTokens(total, cells, pictures, follow) <= H3_EDIT_TOKEN_CAP) return [{ start: 0, frames: total, overlap: 0 }]
  // In grid steps: a part is 17k+5 frames, the clip 17K+5, the overlap 17q+5.
  // n parts deliver 17(Σk) + 5 − 17q(n−1), so Σk = K + q(n−1) — always integral.
  const K = (total - 5) / 17
  const overlap = EDIT_JOIN_OVERLAP[join]
  const q = (overlap - 5) / 17
  const kMax = Math.floor(((H3_EDIT_TOKEN_CAP - pictures * cells) / ((1 + SOURCE_SHARE[follow]) * cells) - 2) / 5)
  if (kMax <= q + 1) throw new Error(`An edit part cannot fit ${cells} latent cells under the token cap`)
  const n = Math.ceil((K - q) / (kMax - q))
  const sum = K + q * (n - 1)
  const base = Math.floor(sum / n)
  const extra = sum % n
  const plan: EditChunk[] = []
  let end = 0
  for (let i = 0; i < n; i++) {
    const frames = 17 * (base + (i < extra ? 1 : 0)) + 5
    const start = i === 0 ? 0 : end - overlap
    plan.push({ start, frames, overlap: i === 0 ? 0 : overlap })
    end = start + frames
  }
  return plan
}
