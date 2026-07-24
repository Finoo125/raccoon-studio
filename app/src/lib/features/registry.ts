export type FeatureKind = 'core' | 'addon'

/**
 * Visual nav grouping (order = display order):
 * - 'create' → core creation surfaces (generate image/video, gallery).
 * - 'studio' → the paid Patreon add-ons (+ the Add-ons store link).
 * - 'manage' → utility/management surfaces (tools, models, logs, settings).
 *   Rendered as a single "Manage" dropdown: these are visited rarely, and as
 *   flat tabs they pushed the top bar past its width once add-ons unlocked.
 */
export type FeatureGroup = 'create' | 'studio' | 'manage'

export interface FeatureModelReq {
  name: string
  path: string
  url: string
}

export interface FeatureDef {
  /** Stable id; for add-ons this is also the entitlement id. */
  id: string
  label: string
  href: string
  /** lucide-react icon name, resolved by the nav component. */
  icon: string
  kind: FeatureKind
  /** Which visual cluster the item sits in within the top bar. */
  group: FeatureGroup
  /** Add-on only: ComfyUI assets ensured on unlock (reuses the Models download flow). */
  requires?: { models?: FeatureModelReq[] }
}

/** Single source of truth. Menu order = array order. */
export const FEATURES: FeatureDef[] = [
  { id: 'generate',        label: 'Generate Image', href: '/generate',        icon: 'Wand2',             kind: 'core',  group: 'create' },
  { id: 'generate-videos', label: 'Generate Video', href: '/generate-videos', icon: 'Clapperboard',      kind: 'core',  group: 'create' },
  { id: 'gallery',         label: 'Gallery',        href: '/gallery',         icon: 'Images',            kind: 'core',  group: 'create' },
  { id: 'photo-editor',    label: 'Photo Editing',  href: '/photo-editing',   icon: 'SlidersHorizontal', kind: 'addon', group: 'studio' },
  { id: 'prompt-builder',  label: 'Prompt Builder', href: '/prompt-builder',  icon: 'PencilRuler',       kind: 'addon', group: 'studio' },
  { id: 'movie-maker',     label: 'Movie Maker',    href: '/movie',           icon: 'Film',              kind: 'addon', group: 'studio', requires: { models: [] } },
  { id: 'tools',           label: 'Tools',          href: '/tools',           icon: 'Wrench',            kind: 'core',  group: 'manage' },
  { id: 'models',          label: 'Models',         href: '/models',          icon: 'Package',           kind: 'core',  group: 'manage' },
  { id: 'logs',            label: 'Logs',           href: '/logs',            icon: 'ScrollText',        kind: 'core',  group: 'manage' },
  { id: 'settings',        label: 'Settings',       href: '/settings',        icon: 'Settings',          kind: 'core',  group: 'manage' },
]

/** Display order of the visual nav groups. */
export const GROUP_ORDER: FeatureGroup[] = ['create', 'studio', 'manage']

/**
 * The visible nav split into its visual groups, in display order. The 'studio'
 * group is always emitted (it always carries the Add-ons store link, even when
 * no add-on is unlocked); 'create' and 'manage' are always non-empty.
 */
export function navGroups(unlocked: string[]): { group: FeatureGroup; items: FeatureDef[] }[] {
  const visible = visibleNav(unlocked)
  return GROUP_ORDER.map((group) => ({
    group,
    items: visible.filter((f) => f.group === group),
  })).filter((g) => g.group === 'studio' || g.items.length > 0)
}

export const coreFeatures = (): FeatureDef[] => FEATURES.filter((f) => f.kind === 'core')
export const addonFeatures = (): FeatureDef[] => FEATURES.filter((f) => f.kind === 'addon')
export const addonIds = (): string[] => addonFeatures().map((f) => f.id)

/** Core features plus any unlocked add-ons, in registry order. */
export function visibleNav(unlocked: string[]): FeatureDef[] {
  const unlockedSet = new Set(unlocked)
  return FEATURES.filter((f) => f.kind === 'core' || unlockedSet.has(f.id))
}

/** The add-on feature id a page path belongs to (exact or nested), else null. */
export function isAddonRoute(pathname: string): string | null {
  const match = addonFeatures().find(
    (f) => pathname === f.href || pathname.startsWith(`${f.href}/`),
  )
  return match ? match.id : null
}

/** Map an add-on API path prefix to its feature id, else null. */
const API_FEATURE_MAP: { prefix: string; feature: string }[] = [
  { prefix: '/api/photo-edit', feature: 'photo-editor' },
  { prefix: '/api/prompt-builder', feature: 'prompt-builder' },
  { prefix: '/api/movies', feature: 'movie-maker' },
  { prefix: '/api/director', feature: 'movie-maker' },
]

export function featureForApiPath(pathname: string): string | null {
  const match = API_FEATURE_MAP.find((e) => pathname.startsWith(e.prefix))
  return match ? match.feature : null
}
