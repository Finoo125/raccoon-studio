import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { generateKeyPairSync, sign } from 'node:crypto'

// Local signing helpers — no dependency on the extracted, creator-only minting
// tool. They only sign throwaway keypairs, so they cannot forge keys for the
// production public key embedded in the app.
function generateKeypair() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  return {
    publicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  }
}
function signAddonKey(payload: unknown, privateKeyPem: string) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${body}.${sign(null, Buffer.from(body), privateKeyPem).toString('base64url')}`
}

const kp = generateKeypair()
let dir: string

// public-key.ts reads ADDON_PUBLIC_KEY at module eval; set it before importing.
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'ent-'))
  process.env.RACCOON_ENTITLEMENTS_FILE = path.join(dir, '.entitlements.json')
  process.env.ADDON_PUBLIC_KEY = kp.publicKey
  vi.resetModules()
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

async function load() {
  return await import('./entitlement')
}
function key(feat: string[], exp: number | null = null, iat = 1750000000) {
  return signAddonKey({ v: 1, sub: 'p', feat, iat, exp }, kp.privateKey)
}

describe('entitlement service', () => {
  it('starts with nothing unlocked', async () => {
    const { getUnlockedFeatures } = await load()
    expect(await getUnlockedFeatures()).toEqual([])
  })

  it('installs a valid key and unlocks its features', async () => {
    const { installKey, isFeatureUnlocked } = await load()
    const r = await installKey(key(['ltx-director']))
    expect(r.ok).toBe(true)
    expect(await isFeatureUnlocked('ltx-director')).toBe(true)
    expect(await isFeatureUnlocked('movie-maker')).toBe(false)
  })

  it('rejects an invalid key and unlocks nothing', async () => {
    const { installKey, getUnlockedFeatures } = await load()
    const r = await installKey('garbage')
    expect(r.ok).toBe(false)
    expect(await getUnlockedFeatures()).toEqual([])
  })

  it('unions features across multiple keys and dedupes', async () => {
    // Two genuinely different keys (different iat → different bytes) granting
    // the same add-on: both install, the feature appears once.
    const { installKey, getUnlockedFeatures } = await load()
    await installKey(key(['ltx-director']))
    await installKey(key(['ltx-director'], null, 1750000001))
    expect((await getUnlockedFeatures()).sort()).toEqual(['ltx-director'])
  })

  it('does not count an expired key', async () => {
    const { installKey, getUnlockedFeatures } = await load()
    await installKey(key(['ltx-director'], 1_000)) // installKey verifies as expired
    expect(await getUnlockedFeatures()).toEqual([])
  })

  it('removeKey re-locks', async () => {
    const { installKey, removeKey, isFeatureUnlocked } = await load()
    const k = key(['ltx-director'])
    await installKey(k)
    await removeKey(k)
    expect(await isFeatureUnlocked('ltx-director')).toBe(false)
  })

  it('a key listing a held-back add-on does not unlock it', async () => {
    // The whole point of the release gate: an older key that still lists
    // photo-editor installs fine and grants only what has shipped.
    const { installKey, isFeatureUnlocked } = await load()
    const r = await installKey(key(['photo-editor', 'ltx-director']))
    expect(r.ok && r.features).toEqual(['ltx-director'])
    expect(await isFeatureUnlocked('photo-editor')).toBe(false)
    expect(await isFeatureUnlocked('ltx-director')).toBe(true)
  })
})

describe('assertEntitled', () => {
  it('returns 403 when locked, null when unlocked', async () => {
    process.env.RACCOON_ENTITLEMENTS_FILE = path.join(dir, 'g.json')
    const { installKey } = await load()
    const { assertEntitled } = await import('./guard')
    const denied = await assertEntitled('ltx-director')
    expect(denied?.status).toBe(403)
    await installKey(key(['ltx-director']))
    expect(await assertEntitled('ltx-director')).toBeNull()
  })

  it('keeps 403ing a held-back add-on even with a key that lists it', async () => {
    process.env.RACCOON_ENTITLEMENTS_FILE = path.join(dir, 'h.json')
    const { installKey } = await load()
    const { assertEntitled } = await import('./guard')
    await installKey(key(['photo-editor', 'movie-maker', 'ltx-director']))
    expect((await assertEntitled('photo-editor'))?.status).toBe(403)
    expect((await assertEntitled('movie-maker'))?.status).toBe(403)
  })
})
