import { isIP } from 'node:net'
import { NextResponse } from 'next/server'

/**
 * The studio has no login: whoever can send /api a request can do anything the
 * owner can. `next dev -H 127.0.0.1` (package.json) keeps other machines out
 * (RunPod's own proxy.mjs puts a password in front); this keeps out other web
 * pages in the owner's browser:
 * - a foreign Host name — DNS rebinding points a site's name at 127.0.0.1, and
 *   that is the only way such a page can read our answers;
 * - another site's fetch / form / <img> (Sec-Fetch-Site), and for writes the
 *   Origin header too, for browsers that don't send Sec-Fetch-Site.
 * Callers without either header (curl, the server's own fetches) pass.
 */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

export interface GuardInput { method: string; host: string | null; origin: string | null; site: string | null; path?: string }

// Where another site legitimately sends the browser into /api: Civitai (or the raccoon-unlock relay)
// redirects back to the sign-in callback. Its OAuth `state` must match the sign-in this install
// started, so a forged visit changes nothing. A GET only, and the Host check still applies.
const CROSS_SITE_ENTRIES = new Set(['/api/civitai/auth/callback'])

const hostname = (host: string) => {
  const h = host.trim().toLowerCase()
  return h.startsWith('[') ? h.slice(1, h.indexOf(']')) : h.replace(/:\d+$/, '')
}

// An IP literal can't be rebound (rebinding needs a DNS name); a RunPod pod's
// proxy host is RunPod's DNS, not an attacker's.
const hostAllowed = (name: string, extra: string[]) =>
  name === 'localhost' || isIP(name) !== 0 || name.endsWith('.proxy.runpod.net') || extra.includes(name)

const originHost = (origin: string) => {
  try { return new URL(origin).host } catch { return null }
}

/** Why /api refuses this request, or null to serve it. */
export function refusal(r: GuardInput, extraHosts: string[] = []): string | null {
  if (r.host && !hostAllowed(hostname(r.host), extraHosts)) return `Host "${hostname(r.host)}" is not allowed`
  const entry = r.method === 'GET' && !!r.path && CROSS_SITE_ENTRIES.has(r.path)
  if ((r.site === 'cross-site' || r.site === 'same-site') && !entry) return 'Request from another site refused'
  if (!SAFE_METHODS.has(r.method) && r.origin !== null && originHost(r.origin) !== r.host?.trim().toLowerCase()) {
    return 'Request from another origin refused'
  }
  return null
}

/** RACCOON_ALLOWED_HOSTS: extra Host names, comma-separated (e.g. a LAN name). */
const EXTRA_HOSTS = (process.env.RACCOON_ALLOWED_HOSTS ?? '').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean)

/** The 403 to return, or null. proxy.ts runs it for /api; routes the proxy skips call it themselves. */
export function guard(req: Request): NextResponse | null {
  const why = refusal({
    method: req.method,
    host: req.headers.get('host'),
    origin: req.headers.get('origin'),
    site: req.headers.get('sec-fetch-site'),
    path: new URL(req.url).pathname,
  }, EXTRA_HOSTS)
  return why ? NextResponse.json({ error: why }, { status: 403 }) : null
}
