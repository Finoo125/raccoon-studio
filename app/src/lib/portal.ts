/**
 * The Raccoon Portal: the member site whose "Raccoon Studio" tab holds the user guides
 * (docs/wiki, published with docs/wiki/sync.mjs). A guide's address is
 * `${PORTAL_URL}/#/studio/<wiki file name>`; the Portal asks for a Patreon or DeviantArt
 * login first and opens the guide after it. Empty PORTAL_URL hides every Portal link.
 */
export const PORTAL_URL = 'https://raccoon-portal.finoo125.workers.dev'

/** App page (first path segment) → its guide. The top bar's Guide button reads this. */
export const GUIDES: Record<string, string> = {
  '/setup': 'first-start',
  '/generate': 'generate-image',
  '/generate-videos': 'generate-video',
  '/gallery': 'gallery',
  '/photo-editing': 'photo-editing',
  '/models': 'models',
  '/tools': 'tools',
  '/backup': 'backup',
  '/settings': 'settings',
  '/add-ons': 'supporters',
  '/logs': 'help',
}

/** The guides a page names in its header chip or canvas invitation, by their wiki titles (test-guarded). */
export const GUIDE_TITLES: Record<string, string> = {
  'generate-image': 'Your first picture',
  'better-pictures': 'Better pictures',
  'generate-video': 'Your first video',
  director: 'Director timeline',
  models: 'Your first model',
  civitai: 'Civitai Browser',
  'photo-editing': 'Photo Editing',
}

export function guideFor(pathname: string): string {
  return GUIDES[`/${pathname.split('/')[1] ?? ''}`] ?? 'getting-around'
}

export function guideHref(slug: string, portal: string = PORTAL_URL): string | null {
  return portal ? `${portal}/#/studio/${slug}` : null
}

export function guideUrl(pathname: string, portal: string = PORTAL_URL): string | null {
  return guideHref(guideFor(pathname), portal)
}
