import { verify, createPublicKey } from 'node:crypto'
import { addonIds } from '@/lib/features/registry'
import { ADDON_PUBLIC_KEY, REVOKED_SUBS } from './public-key'

export interface KeyPayload {
  v: number
  sub: string
  feat: string[]
  iat: number
  exp: number | null
}

export type VerifyResult =
  | { ok: true; payload: KeyPayload; features: string[] }
  | { ok: false; reason: string }

export function verifyKey(
  key: string,
  publicKeyPem: string = ADDON_PUBLIC_KEY,
  now: number = Date.now(),
): VerifyResult {
  if (!publicKeyPem) return { ok: false, reason: 'no-public-key' }
  const parts = key.trim().split('.')
  if (parts.length !== 2 || !parts[0] || !parts[1]) return { ok: false, reason: 'malformed' }

  let payload: KeyPayload
  try {
    payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'))
  } catch {
    return { ok: false, reason: 'malformed' }
  }
  if (payload.v !== 1 || !Array.isArray(payload.feat)) return { ok: false, reason: 'unsupported' }

  let valid = false
  try {
    valid = verify(null, Buffer.from(parts[0]), createPublicKey(publicKeyPem), Buffer.from(parts[1], 'base64url'))
  } catch {
    valid = false
  }
  if (!valid) return { ok: false, reason: 'bad-signature' }
  if (REVOKED_SUBS.includes(payload.sub)) return { ok: false, reason: 'revoked' }
  if (payload.exp != null && now > payload.exp * 1000) return { ok: false, reason: 'expired' }

  const features = payload.feat.includes('*') ? addonIds() : payload.feat
  return { ok: true, payload, features }
}
