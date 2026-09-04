import { describe, it, expect } from 'vitest'
import { getModel, searchModels } from './client'
import { readAuth } from './oauth'

/**
 * Real calls against Civitai. Never runs in `npm test`.
 *
 *   LIVE_CIVITAI=1 node_modules/.bin/vitest run src/lib/civitai/civitai.live.test.ts
 *
 * Requires a connected account — sign in through the Models page first, which
 * is what `readAuth()` is checking for below.
 */
const live = process.env.LIVE_CIVITAI === '1' && !!readAuth()
const maybe = live ? describe : describe.skip

maybe('Civitai, live', () => {
  it('finds an adult model by name, which only works with nsfw=true', async () => {
    // The whole point of this one: the same search without `nsfw=true` returns
    // five unrelated models and no 2856467, on either domain.
    const { items } = await searchModels({ query: 'mystic xxx', types: 'LORA' })
    expect(items.some((m) => m.id === 2856467)).toBe(true)
  }, 30_000)

  it('reads a model detail with all its versions', async () => {
    const m = await getModel(2856467)
    expect(m.name).toContain('Mystic XXX')
    expect(m.modelVersions.length).toBeGreaterThanOrEqual(4)
    expect(m.modelVersions[0].files[0].name).toMatch(/\.safetensors$/)
  }, 30_000)

  /**
   * ⚠️ **Version 2506518 is creator-gated, and that is the whole point.**
   *
   * This leg used to use 3266628, which serves **307 to an anonymous request** —
   * so the assertion could not fail no matter what the token was, and it duly
   * passed against a token that had been dead for 19 hours (2026-08-28). It was
   * the one test that should have caught the silent token expiry.
   *
   * `[ZIT] Mystic XXX` gates v1–v2 and leaves v3–v7 open, which makes it the
   * cheapest available proof: a live token downloads v2, a dead one gets 401.
   */
  it('downloads real bytes from a GATED model, which needs a live token', async () => {
    const auth = readAuth()!

    // The control first: if this is not 401, the version stopped being gated and
    // the test below has quietly become meaningless again.
    const anon = await fetch('https://civitai.com/api/download/models/2506518', {
      headers: { Range: 'bytes=0-1023' }, redirect: 'manual',
    })
    expect(anon.status, 'vid 2506518 must be creator-gated for this test to mean anything').toBe(401)

    // Ranged, so this costs a kilobyte rather than 145 MB. The safetensors magic
    // proves it is the file, not an error page wearing a 200.
    const res = await fetch(
      `https://civitai.com/api/download/models/2506518?token=${auth.accessToken}`,
      { headers: { Range: 'bytes=0-1023' } },
    )
    expect(res.status).toBe(206)

    const buf = Buffer.from(await res.arrayBuffer())
    const headerLen = Number(buf.readBigUInt64LE(0))
    expect(headerLen).toBeGreaterThan(0)
    expect(buf.subarray(8, 9).toString()).toBe('{')
  }, 60_000)

  it('has a token the API actually accepts', async () => {
    // /api/v1/me is the ONLY cheap verifier: the search and detail endpoints
    // both answer 200 for an invalid token, a garbage string and no token at
    // all, so neither can tell a live session from a dead one.
    const auth = readAuth()!
    const res = await fetch('https://civitai.com/api/v1/me', {
      headers: { Authorization: `Bearer ${auth.accessToken}` },
    })
    expect(res.status, 'stored token is not accepted by Civitai — sign in again').toBe(200)
  }, 30_000)
})
