import { selectionIsStale } from './installed'

// Patreon-exclusive model naming. Imported models whose filename contains one
// of these tokens are surfaced as selectable "Aria / Patreon" models.
export const PATREON_PATTERNS = ['muscgi', 'muscgro', 'aria'] as const

/**
 * Per-family Patreon naming. `keywords` are matched against a normalized
 * filename (lowercased, separators removed) so "z_image", "z-image" and
 * "z image" all collapse to "zimage". `ariaKind` is where that family's Aria
 * model belongs and mirrors the workflow's `ariaModelKind`: SDXL-family Aria
 * models are full checkpoints, while the diffusion/UNET families (z-image,
 * ernie, anima) deliver Aria models as full diffusion models routed to
 * `diffusion_models/`.
 */
export const PATREON_FAMILIES: Record<string, { keywords: string[]; ariaKind: 'loras' | 'checkpoints' | 'diffusion_models' }> = {
  anima: { keywords: ['anima'], ariaKind: 'diffusion_models' },
  'anima-turbo': { keywords: ['anima'], ariaKind: 'diffusion_models' },
  'ernie-turbo': { keywords: ['ernie'], ariaKind: 'diffusion_models' },
  'z-image-turbo': { keywords: ['zit', 'zimage'], ariaKind: 'diffusion_models' },
  sdxl: { keywords: ['sdxl'], ariaKind: 'checkpoints' },
  pony: { keywords: ['pony'], ariaKind: 'checkpoints' },
  illustrious: { keywords: ['illustrious', 'illu'], ariaKind: 'checkpoints' },
}

export const normalizePatreonName = (s: string) =>
  (s.split('/').pop() ?? s).toLowerCase().replace(/[^a-z0-9]/g, '')

/** True when a model name (possibly "subfolder/name.safetensors") is a Patreon model. */
export function isPatreonModel(name: string): boolean {
  const base = (name.split('/').pop() ?? name).toLowerCase()
  return PATREON_PATTERNS.some((p) => base.includes(p))
}

/**
 * True when a model name is an "Aria" model specifically. The Generate form's
 * Model dropdown is limited to these — muscgi / muscgro models are excluded
 * even though they are still Patreon models elsewhere (e.g. Models page badges).
 */
export function isAriaModel(name: string): boolean {
  const base = (name.split('/').pop() ?? name).toLowerCase()
  return base.includes('aria')
}

/**
 * The Aria model to actually generate with, given what ComfyUI offers for the
 * *current* family's loader (`available`).
 *
 * `ariaModel` is one persisted field shared by every family, so a selection
 * outlives both the preset switch that made it wrong and the install that made
 * it exist. Either way ComfyUI rejects the entire prompt with
 * "Value not in list", which surfaces as a bare "Generation failed" — and when
 * the file is gone the Model dropdown is hidden too (it only renders when the
 * family has Aria models), leaving no UI to clear the stale value with.
 *
 * Membership in `available` subsumes the family check: a checkpoint Aria model
 * is never in the UNET list. Until `loaded`, the selection is kept as-is — the
 * lists start empty and fill from /object_info, so clearing eagerly would wipe a
 * valid choice on every reload and whenever ComfyUI is offline.
 */
export function effectiveAriaModel(
  selected: string | undefined,
  available: string[],
  loaded: boolean,
): string | undefined {
  return selectionIsStale(selected, available, loaded) ? undefined : selected
}

/** True when a filename contains one of the preset family's keywords. */
export function matchesPatreonPreset(filename: string, presetId: string): boolean {
  const fam = PATREON_FAMILIES[presetId]
  if (!fam) return true
  const base = normalizePatreonName(filename)
  return fam.keywords.some((kw) => base.includes(normalizePatreonName(kw)))
}

/**
 * Where a Patreon model belongs on disk so ComfyUI can load it. muscgi/muscgro
 * are always LoRAs. An Aria model is routed by the family its filename matches:
 * z-image/ernie/anima Aria models are full diffusion models routed to
 * `diffusion_models/`, SDXL-family Aria models are full checkpoints. An Aria
 * name matching no known family defaults to checkpoints.
 */
export function patreonSubfolder(filename: string): 'loras' | 'checkpoints' | 'diffusion_models' {
  if (!isAriaModel(filename)) return 'loras'
  const base = normalizePatreonName(filename)
  for (const fam of Object.values(PATREON_FAMILIES)) {
    if (fam.keywords.some((kw) => base.includes(normalizePatreonName(kw)))) {
      return fam.ariaKind
    }
  }
  return 'checkpoints'
}
