import { describe, it, expect } from 'vitest'
import { generateKeyPairSync, sign } from 'node:crypto'
import { verifyKey } from './key'

// Local signing helpers — kept here so the app test suite has no dependency on
// the (extracted, creator-only) key-minting tool. They only ever sign throwaway
// keypairs generated per run, so they cannot forge keys for the production
// public key embedded in the app.
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
const base = { v: 1, sub: 'p1', feat: ['photo-editor'], iat: 1750000000, exp: null as number | null }

describe('verifyKey', () => {
  it('accepts a valid key and returns granted features', () => {
    const token = signAddonKey(base, kp.privateKey)
    const r = verifyKey(token, kp.publicKey)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.features).toEqual(['photo-editor'])
  })

  it('expands "*" to all add-on ids', () => {
    const token = signAddonKey({ ...base, feat: ['*'] }, kp.privateKey)
    const r = verifyKey(token, kp.publicKey)
    expect(r.ok && r.features.sort()).toEqual(['movie-maker', 'photo-editor', 'prompt-builder'])
  })

  it('rejects a tampered payload', () => {
    const token = signAddonKey(base, kp.privateKey)
    const [, sig] = token.split('.')
    const forged = Buffer.from(JSON.stringify({ ...base, feat: ['movie-maker'] })).toString('base64url') + '.' + sig
    const r = verifyKey(forged, kp.publicKey)
    expect(r.ok).toBe(false)
  })

  it('rejects a key signed by a different private key', () => {
    const other = generateKeypair()
    const token = signAddonKey(base, other.privateKey)
    expect(verifyKey(token, kp.publicKey).ok).toBe(false)
  })

  it('rejects an expired key', () => {
    const token = signAddonKey({ ...base, exp: 1_000 }, kp.privateKey) // expired 1970
    const r = verifyKey(token, kp.publicKey, Date.now())
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('expired')
  })

  it('rejects malformed input', () => {
    expect(verifyKey('not-a-key', kp.publicKey).ok).toBe(false)
    expect(verifyKey('', kp.publicKey).ok).toBe(false)
  })
})
