import type { GenerationJob } from '@/lib/comfyui/queue'
import type { VideoGenerationParams } from '@/types/video-workflow'
import { isLtxWorkflow } from '@/lib/workflows/video-index'
import { BUDGET_MP as LTX_BUDGET_MP } from '@/lib/workflows/ltx23'
import { h3Profile, h3EditPlan,
  BUDGET_MP as H3_BUDGET_MP,
  H3_STEPS,
  H3_TURBO,
  h3ClampDuration,
  h3FrameCount,
  h3TurboTier,
  h3UsesEros,
} from '@/lib/workflows/minimax-h3'

/**
 * What a render is about to cost, in seconds — calibrated against this machine's
 * own finished renders rather than a constant measured on somebody else's card.
 *
 * The 2026-08-30 budget sweep found cost strictly linear in pixels
 * (`seconds ≈ 178.6 × MP + 4.7` on a 5090 at the Fast tier), and sampling
 * dominates everything else, so `steps × frames × megapixels` is a usable unit
 * of work. What it is worth in seconds is entirely a property of the box, which
 * is why nothing here hardcodes it: divide a finished job's wall time by its
 * units and you have this machine's rate. No finished render yet ⇒ `null`, and
 * the caller shows no estimate at all rather than a number it made up.
 */

/** Renders sampled for the rate. Enough to ride out one cold checkpoint load. */
const SAMPLE_SIZE = 8

/**
 * Sampling work for one render. Only ever compared against itself, so the unit
 * is arbitrary — what matters is that it moves with every control that moves
 * the render time, and with nothing else.
 */
export function renderUnits(workflowId: string | undefined, p: VideoGenerationParams): number {
  if (isLtxWorkflow(workflowId)) {
    // LTX's step counts are baked into LTX23.json, not exposed as params, so
    // they are constant and fold into the rate. Frames × pixels is the whole
    // variable part.
    return p.durationSeconds * (p.fps || 30) * LTX_BUDGET_MP[p.vramMode ?? 'high']
  }
  // Mirrors the step choice in `buildPrompt` — Eros ignores the Speed row
  // because its distillation is merged into the weights.
  const tier = h3TurboTier(p.turbo)
  const steps = h3Profile(p)?.steps ?? (tier ? H3_TURBO[tier].steps : H3_STEPS.normal)
  // An edit renders its clip's own length, and the whole clip rides along as
  // a guide — measured 1.75-2.4x a plain clip of the same size (2026-10-02).
  // A clip too big for one pass renders in parts, each re-covering its overlap.
  // Exactly carries the clip again as an anchor (2x); Loosely as a half-size
  // reference video (1.25x).
  const frames =
    p.mode === 'edit'
      ? (p.editFollow === 'loose' ? 1.25 : 2) * (h3EditPlan(p)?.reduce((s, c) => s + c.frames, 0) ?? 0)
      : h3FrameCount(h3ClampDuration(p.durationSeconds))
  return steps * frames * H3_BUDGET_MP[p.vramMode ?? 'high']
}

/**
 * What one candidate costs as a share of a full render. Measured per graph:
 * LTX truncates after its half-res first pass, stock H3 drops 20 steps to 6,
 * and Eros only has 8 to drop to 6 — which is why its candidates save so little.
 */
// hybrid: 8 of 13 steps, unmeasured — the step ratio plus a little overhead. sparseref: 6 of 8 steps, unmeasured.
export const HUNT_SHARE = { ltx: 0.65, h3: 0.42, eros: 0.84, hybrid: 0.65, sparseref: 0.75 } as const

/** `N` candidates plus the keeper's re-render, as a multiple of one render. */
export function huntMultiplier(
  workflowId: string | undefined,
  p: VideoGenerationParams,
  huntCount: number,
): number {
  if (huntCount <= 0) return 1
  const share = isLtxWorkflow(workflowId)
    ? HUNT_SHARE.ltx
    : h3UsesEros(p)
      ? HUNT_SHARE.eros
      : p.h3Checkpoint === 'hybrid'
        ? HUNT_SHARE.hybrid
        : p.h3Checkpoint === 'sparseref'
          ? HUNT_SHARE.sparseref
          : HUNT_SHARE.h3
  return huntCount * share + 1
}

/**
 * Seconds per unit on this machine — the median of recent finished renders of
 * the same workflow, or `null` if there are none to learn from.
 *
 * Median rather than mean because one cold 21 GB checkpoint load, or one render
 * that sat behind another in the queue, would otherwise drag every later
 * estimate up. Seed-hunt candidates are skipped: they are deliberately not full
 * renders, so their rate is not this render's rate.
 */
export function secondsPerUnit(workflowId: string, jobs: GenerationJob[]): number | null {
  const rates: number[] = []
  for (const j of jobs) {
    if (rates.length >= SAMPLE_SIZE) break
    if (j.kind !== 'video' || j.status !== 'done' || j.workflowId !== workflowId) continue
    if (j.startedAt === undefined || j.endedAt === undefined) continue
    const p = j.generationParams as VideoGenerationParams
    if (p.seedHunt) continue
    const units = renderUnits(workflowId, p)
    const seconds = (j.endedAt - j.startedAt) / 1000
    if (units > 0 && seconds > 1) rates.push(seconds / units)
  }
  if (rates.length === 0) return null
  rates.sort((a, b) => a - b)
  return rates[Math.floor(rates.length / 2)]
}

/** Estimated wall time for what Generate is about to queue, or `null`. */
export function estimateSeconds(
  workflowId: string,
  p: VideoGenerationParams,
  huntCount: number,
  jobs: GenerationJob[],
): number | null {
  const rate = secondsPerUnit(workflowId, jobs)
  if (rate === null) return null
  return renderUnits(workflowId, p) * rate * huntMultiplier(workflowId, p, huntCount)
}
