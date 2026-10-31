export type Tier = 's' | 'm' | 'l'

export interface TierInfo {
  tier: Tier
  /** What users know their card as — not the cut-off itself. */
  label: string
  model: string
  sizeGb: number
  feel: string
}

/**
 * The Ollama model the one-click setup downloads, per graphics card. Sizes from
 * ollama.com/library/qwen3.5 (2026-10-10). The 27b is the measured best writer
 * here; the 4b and 9b passed spike S5 for sentence prompts (4–6 s for three
 * versions with thinking off); both write weak tags.
 */
export const OLLAMA_TIERS: readonly TierInfo[] = [
  { tier: 's', label: 'Under 10 GB', model: 'qwen3.5:4b', sizeGb: 3.4, feel: 'Quick, simple wording' },
  { tier: 'm', label: '10–20 GB', model: 'qwen3.5:9b', sizeGb: 6.6, feel: 'Good detail, fast' },
  { tier: 'l', label: '24 GB or more', model: 'qwen3.5:27b', sizeGb: 17, feel: 'Richest wording' },
]

/**
 * Cut-offs sit below the box sizes because cards report a little under them, and
 * no consumer card sits between 20 and 24 GB: a 20 GB card stays on the 9b, since
 * the 27b plus its context would leave nothing for the picture model.
 */
export function tierFor(vramGb: number | null): Tier {
  if (vramGb === null) return 'm'
  if (vramGb < 10) return 's'
  return vramGb < 22 ? 'm' : 'l'
}

export const tierInfo = (tier: Tier): TierInfo => OLLAMA_TIERS.find((t) => t.tier === tier)!

/** Raise a tier to a floor: clampTier('s', 'm') is 'm'. */
export const clampTier = (tier: Tier, min: Tier): Tier =>
  (['s', 'm', 'l'] as const).indexOf(tier) < (['s', 'm', 'l'] as const).indexOf(min) ? min : tier

/** The writer ids of the setup's models under a floor: belowTier('m') is the 4b. */
export const belowTier = (min: Tier): string[] =>
  OLLAMA_TIERS.filter((t) => clampTier(t.tier, min) !== t.tier).map((t) => `ollama:${t.model}`)
