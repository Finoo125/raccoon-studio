import { CIVITAI_API_BASE, civitaiFetch } from './oauth'
import type { CivitaiModel } from './types'

// Re-exported for server callers; it is defined in `types.ts` so that client
// components can reach it without pulling this module's `fs` dependency in.
export { folderForType } from './types'

/**
 * Search Civitai.
 *
 * **`nsfw=true` on every search, always.** The API default is filtered — on
 * civitai.com and civitai.red alike, measured 2026-08-27: searching "mystic xxx"
 * does not return model 2856467 without it, and does with it. A user typing the
 * name of a model they know exists and getting five unrelated results reads as a
 * broken browser, not as a content filter.
 */
export async function searchModels(o: {
  query?: string
  types?: string
  sort?: string
  baseModels?: string
  cursor?: string
}): Promise<{ items: CivitaiModel[]; nextCursor?: string }> {
  const p = new URLSearchParams({ limit: '24', nsfw: 'true' })
  if (o.query) p.set('query', o.query)
  if (o.types) p.set('types', o.types)
  if (o.sort) p.set('sort', o.sort)
  // An unrecognised value here returns 200 with zero items rather than an
  // error, so only ever pass strings from `CIVITAI_BASE_MODELS`.
  if (o.baseModels) p.set('baseModels', o.baseModels)
  if (o.cursor) p.set('cursor', o.cursor)

  const res = await civitaiFetch(`${CIVITAI_API_BASE}/models?${p.toString()}`)

  // Judge the BODY, not the status line. Caught live 2026-08-28 during a real
  // Civitai wobble: their search answers `503` while returning a complete,
  // correct payload — items and nextCursor both present. Throwing on `!res.ok`
  // discarded results the user could have had and presented as "search is
  // broken", which is a different claim entirely from "Civitai is degraded".
  const json = (await res.json().catch(() => null)) as {
    items?: CivitaiModel[]
    metadata?: { nextCursor?: string }
  } | null
  if (!json?.items) throw new Error(`Civitai search failed (${res.status})`)

  // Cursor pagination, not page numbers — `metadata.nextCursor` is the only
  // way forward through results.
  return { items: json.items, nextCursor: json.metadata?.nextCursor }
}

export async function getModel(id: number): Promise<CivitaiModel> {
  const res = await civitaiFetch(`${CIVITAI_API_BASE}/models/${id}`)
  const json = (await res.json().catch(() => null)) as CivitaiModel | null
  if (!json?.id) throw new Error(`Could not load model ${id} (${res.status})`)
  return json
}

/**
 * A download URL carrying the token as a query parameter, never a header.
 *
 * The download 302s to a presigned R2 URL, and an `Authorization` header on that
 * host is rejected with 400 ("only one auth mechanism allowed"). The redirect
 * builds a fresh URL from `Location`, so a query token is dropped naturally and
 * never reaches R2. `curl` hides this by stripping auth across hosts by default;
 * Node's `http`, which is what `startTransfer` uses, does not.
 */
export function downloadUrlFor(versionId: number, token: string): string {
  return `https://civitai.com/api/download/models/${versionId}?token=${encodeURIComponent(token)}`
}
