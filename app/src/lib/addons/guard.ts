import { isFeatureUnlocked } from './entitlement'

/**
 * Call at the top of an add-on API route. Returns a 403 Response when the
 * feature is locked (the caller should `return` it), or null when unlocked.
 */
export async function assertEntitled(featureId: string): Promise<Response | null> {
  if (await isFeatureUnlocked(featureId)) return null
  return new Response(JSON.stringify({ error: 'Feature locked', feature: featureId }), {
    status: 403,
    headers: { 'Content-Type': 'application/json' },
  })
}
