import { promises as fs } from 'node:fs'
import path from 'node:path'
import { verifyKey } from './key'

const filePath = (): string =>
  process.env.RACCOON_ENTITLEMENTS_FILE ?? path.join(process.cwd(), '.entitlements.json')

async function readKeys(): Promise<string[]> {
  try {
    const parsed = JSON.parse(await fs.readFile(filePath(), 'utf8'))
    return Array.isArray(parsed.keys) ? parsed.keys : []
  } catch {
    return []
  }
}

async function writeKeys(keys: string[]): Promise<void> {
  await fs.writeFile(filePath(), JSON.stringify({ keys }, null, 2))
}

/** Union of granted, non-expired, validly-signed feature ids across installed keys. */
export async function getUnlockedFeatures(now: number = Date.now()): Promise<string[]> {
  const keys = await readKeys()
  const unlocked = new Set<string>()
  for (const k of keys) {
    const r = verifyKey(k, undefined, now)
    if (r.ok) r.features.forEach((f) => unlocked.add(f))
  }
  return [...unlocked]
}

export async function installKey(
  key: string,
): Promise<{ ok: true; features: string[] } | { ok: false; reason: string }> {
  const r = verifyKey(key)
  if (!r.ok) return { ok: false, reason: r.reason }
  const keys = await readKeys()
  const trimmed = key.trim()
  if (!keys.includes(trimmed)) {
    keys.push(trimmed)
    await writeKeys(keys)
  }
  return { ok: true, features: r.features }
}

export async function removeKey(key: string): Promise<void> {
  const keys = (await readKeys()).filter((k) => k !== key.trim())
  await writeKeys(keys)
}

export async function isFeatureUnlocked(featureId: string): Promise<boolean> {
  return (await getUnlockedFeatures()).includes(featureId)
}
