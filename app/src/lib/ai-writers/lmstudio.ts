import fs from 'node:fs'
import path from 'node:path'

/** LM Studio's server port unless it was started elsewhere (its own default). */
export const LMS_PORT = 1234

const portBox = ((globalThis as unknown as { __raccoonLmsPort?: { port: number } }).__raccoonLmsPort ??= { port: LMS_PORT })
/** The port `lms server start` reported last (shared across route modules). */
export const currentLmsPort = () => portBox.port
export const rememberLmsPort = (port: number) => { portBox.port = port }

export const lmsCliPath = (home: string, platform: NodeJS.Platform) =>
  path.join(home, '.lmstudio', 'bin', platform === 'win32' ? 'lms.exe' : 'lms')

/**
 * LM Studio's chat models WITHOUT waking it: `lms ls` starts its background
 * service, which a scan must never do. Its index file comes first (it knows
 * chat from embedding models); the models folder is the fallback. The id is the
 * model's file path, which LM Studio's API accepts as `model` (checked 2026-10-10),
 * so one id works whether LM Studio is on or off.
 */
export function readLmsModels(home: string): { path: string; name: string }[] {
  const root = path.join(home, '.lmstudio')
  try {
    const idx = JSON.parse(fs.readFileSync(path.join(root, '.internal', 'model-index-cache.json'), 'utf8')) as
      { models?: { domain?: string; indexedModelIdentifier?: string; displayName?: string }[] }
    if (Array.isArray(idx.models)) {
      return idx.models
        .filter((m) => m.domain === 'llm' && m.indexedModelIdentifier)
        .map((m) => ({ path: m.indexedModelIdentifier!, name: m.displayName || path.basename(m.indexedModelIdentifier!) }))
    }
  } catch { /* no index (yet) — read the folder */ }
  let dir = path.join(root, 'models')
  try {
    dir = (JSON.parse(fs.readFileSync(path.join(root, 'settings.json'), 'utf8')) as { downloadsFolder?: string }).downloadsFolder || dir
  } catch { /* default folder */ }
  const out: { path: string; name: string }[] = []
  const ls = (d: string) => { try { return fs.readdirSync(d) } catch { return [] } }
  for (const publisher of ls(dir)) {
    for (const repo of ls(path.join(dir, publisher))) {
      for (const file of ls(path.join(dir, publisher, repo))) {
        if (!/\.gguf$/i.test(file) || /^mmproj/i.test(file) || /embed/i.test(file)) continue
        const part = file.match(/-(\d{5})-of-\d{5}\.gguf$/i)
        if (part && Number(part[1]) !== 1) continue
        out.push({ path: `${publisher}/${repo}/${file}`, name: repo })
      }
    }
  }
  return out.sort((a, b) => a.path.localeCompare(b.path))
}

export async function probeLms(port: number, fetcher: typeof fetch = fetch, timeoutMs = 1500): Promise<boolean> {
  try {
    return (await fetcher(`http://127.0.0.1:${port}/v1/models`, { signal: AbortSignal.timeout(timeoutMs), cache: 'no-store' })).ok
  } catch {
    return false
  }
}
