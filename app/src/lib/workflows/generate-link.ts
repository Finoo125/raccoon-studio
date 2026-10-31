/**
 * The preset a /generate link only switches to, or null. Such a link (`?workflow=`, optionally
 * with a gallery Edit `?ref=`) restores the saved session first and then switches preset, so it
 * never wipes the user's prompt, LoRAs or negative. A link carrying settings (prompt, negative,
 * seed, LoRAs — "Send to Generate", Start here's first picture) replaces the session instead.
 */
export function presetOnlyLink(q: URLSearchParams): string | null {
  const wf = q.get('workflow')
  if (!wf) return null
  if (q.get('ref')) return wf
  return ['prompt', 'negative', 'seed', 'loras'].some((k) => q.get(k)) ? null : wf
}
