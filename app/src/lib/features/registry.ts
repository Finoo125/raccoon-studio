export type FeatureKind = 'core' | 'addon'

/**
 * Visual nav grouping (order = display order):
 * - 'create' → core creation surfaces (generate image/video, gallery, models).
 *   Models sits here, not in the dropdown: nothing generates without a model,
 *   so a new install must be able to find it without opening a menu.
 * - 'studio' → the paid Patreon add-ons (+ the "Patreon" store link).
 * - 'manage' → utility/management surfaces (tools, logs, settings).
 *   Rendered as a single "Utilities" dropdown: these are visited rarely, and as
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
  /**
   * Entitlement-only: gates a feature that lives *inside* another page rather
   * than on one of its own, so it must never appear as a nav tab. It still
   * belongs in this registry — the Add-ons page and the key/entitlement flow
   * both read from here, and a second source of truth for "what is purchasable"
   * is exactly how the two drift apart.
   */
  navHidden?: boolean
  /**
   * Add-on only: held back from this release. Absent = on sale, and a key
   * unlocks it. Both values mean **no key grants it** (`verifyKey` filters
   * them out, so keys minted before the hold-back stop granting them too —
   * and start granting again, with no re-mint, once the marker is removed):
   * - `'soon'`     → still listed on the Add-ons page, as "Soon available".
   * - `'unlisted'` → not shown at all. Built, but not part of this release.
   *
   * Deleting the marker is the whole release switch for an add-on — that is
   * also how you re-enable one locally while working on it.
   */
  release?: 'soon' | 'unlisted'
}

/** Single source of truth. Menu order = array order. */
export const FEATURES: FeatureDef[] = [
  { id: 'generate',        label: 'Generate Image', href: '/generate',        icon: 'Wand2',             kind: 'core',  group: 'create' },
  { id: 'generate-videos', label: 'Generate Video', href: '/generate-videos', icon: 'Clapperboard',      kind: 'core',  group: 'create' },
  { id: 'gallery',         label: 'Gallery',        href: '/gallery',         icon: 'Images',            kind: 'core',  group: 'create' },
  { id: 'models',          label: 'Models',         href: '/models',          icon: 'Package',           kind: 'core',  group: 'create' },
  { id: 'photo-editor',    label: 'Photo Editing',  href: '/photo-editing',   icon: 'SlidersHorizontal', kind: 'addon', group: 'studio', release: 'soon' },
  { id: 'prompt-builder',  label: 'Prompt Builder', href: '/prompt-builder',  icon: 'PencilRuler',       kind: 'addon', group: 'studio', release: 'unlisted' },
  { id: 'movie-maker',     label: 'Movie Maker',    href: '/movie',           icon: 'Film',              kind: 'addon', group: 'studio', requires: { models: [] }, release: 'unlisted' },
  // A mode inside Generate Video, not a page — hence navHidden. `href` still
  // points at where it lives so the Add-ons entry can link somewhere real.
  { id: 'ltx-director',    label: 'LTX 2.3 Director', href: '/generate-videos', icon: 'Clapperboard',    kind: 'addon', group: 'studio', navHidden: true },
  { id: 'tools',           label: 'Tools',          href: '/tools',           icon: 'Wrench',            kind: 'core',  group: 'manage' },
  // Its own entry rather than a panel inside Tools: it is the one thing here
  // people go looking for by name, usually right before a reinstall.
  { id: 'backup',          label: 'Backup & Restore', href: '/backup',        icon: 'Archive',           kind: 'core',  group: 'manage' },
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

/** Add-ons a key may actually unlock — everything not held back by `release`. */
export const sellableAddonIds = (): string[] =>
  addonFeatures().filter((f) => !f.release).map((f) => f.id)

/** Add-ons the Add-ons page lists (on sale + "soon"), in registry order. */
export const listedAddons = (): FeatureDef[] =>
  addonFeatures().filter((f) => f.release !== 'unlisted')

/**
 * Core features plus any unlocked add-ons, in registry order.
 *
 * `navHidden` entries are excluded even when unlocked: they are entitlements for
 * something embedded in another page, so a tab for them would lead nowhere.
 */
export function visibleNav(unlocked: string[]): FeatureDef[] {
  const unlockedSet = new Set(unlocked)
  return FEATURES.filter((f) => !f.navHidden && (f.kind === 'core' || unlockedSet.has(f.id)))
}

/**
 * The add-on feature id a page path belongs to (exact or nested), else null.
 *
 * `navHidden` entries are skipped: their `href` points at the page they live
 * *inside*, which is a core page. Matching on it would lock that whole page
 * behind the embedded feature's entitlement — e.g. `ltx-director` would gate
 * all of Generate Video, not just Director mode.
 */
export function isAddonRoute(pathname: string): string | null {
  const match = addonFeatures().find(
    (f) => !f.navHidden && (pathname === f.href || pathname.startsWith(`${f.href}/`)),
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
