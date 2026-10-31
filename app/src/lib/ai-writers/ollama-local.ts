import fs from 'node:fs'
import path from 'node:path'

/** Environment variables — a plain map, so tests need not fake all of process.env. */
export type Env = Record<string, string | undefined>

/** Where Ollama keeps its models: OLLAMA_MODELS, else ~/.ollama/models. */
export function ollamaModelsDir(env: Env, home: string): string {
  return env.OLLAMA_MODELS || path.join(home, '.ollama', 'models')
}

/** Every place the Ollama program may sit, most likely first. */
export function ollamaExeCandidates(o: { platform: NodeJS.Platform; env: Env; home: string; dataDir: string }): string[] {
  const win = o.platform === 'win32'
  const exe = win ? 'ollama.exe' : 'ollama'
  const onPath = (o.env.PATH ?? o.env.Path ?? '').split(win ? ';' : ':').filter(Boolean).map((d) => path.join(d, exe))
  if (win) {
    const local = o.env.LOCALAPPDATA ?? path.join(o.home, 'AppData', 'Local')
    return [path.join(local, 'Programs', 'Ollama', exe), ...onPath]
  }
  // Our own user-folder install comes first: it is the one the setup made.
  return [path.join(o.dataDir, 'tools', 'ollama', 'bin', exe), '/usr/local/bin/ollama', '/usr/bin/ollama', ...onPath]
}

export function findOllamaExe(candidates: readonly string[], exists: (p: string) => boolean = fs.existsSync): string | null {
  return candidates.find((p) => exists(p)) ?? null
}

/** Only an Ollama on this PC can be started or installed for. */
export function isLocalUrl(url: string): boolean {
  try {
    return ['localhost', '127.0.0.1', '[::1]', '::1', '0.0.0.0'].includes(new URL(url).hostname)
  } catch {
    return false
  }
}

const gb = (bytes: number) => Math.round(bytes / 1e8) / 10

const listDir = (d: string) => { try { return fs.readdirSync(d) } catch { return [] } }

/**
 * The models of a switched-off Ollama, read from its manifests
 * (`manifests/<registry>/<namespace>/<name>/<tag>`). Embedding models are left
 * out: they cannot write.
 */
export function readOllamaManifests(modelsDir: string): { name: string; sizeGb: number }[] {
  const root = path.join(modelsDir, 'manifests')
  const out: { name: string; sizeGb: number }[] = []
  for (const registry of listDir(root)) {
    for (const ns of listDir(path.join(root, registry))) {
      for (const model of listDir(path.join(root, registry, ns))) {
        for (const tag of listDir(path.join(root, registry, ns, model))) {
          try {
            const m = JSON.parse(fs.readFileSync(path.join(root, registry, ns, model, tag), 'utf8')) as
              { config?: { digest?: string }; layers?: { size?: number }[] }
            if (isEmbedding(modelsDir, m.config?.digest)) continue
            const size = (m.layers ?? []).reduce((s, l) => s + (l.size ?? 0), 0)
            const name = registry === 'registry.ollama.ai'
              ? `${ns === 'library' ? '' : `${ns}/`}${model}:${tag}`
              : `${registry}/${ns}/${model}:${tag}`
            out.push({ name, sizeGb: gb(size) })
          } catch { /* a half-written manifest — skip it */ }
        }
      }
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

function isEmbedding(modelsDir: string, digest?: string): boolean {
  if (!digest) return false
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(modelsDir, 'blobs', digest.replace(':', '-')), 'utf8')) as
      { model_family?: string; model_families?: string[] }
    return [cfg.model_family, ...(cfg.model_families ?? [])].some((f) => /bert/i.test(f ?? ''))
  } catch {
    return false
  }
}

/** A running Ollama's version and chat models (embeddings dropped), or null when it does not answer. */
export async function probeOllama(baseUrl: string, fetcher: typeof fetch = fetch, timeoutMs = 1500):
  Promise<{ version: string; models: { name: string; sizeGb: number }[] } | null> {
  const get = (p: string, init: RequestInit = {}) => fetcher(`${baseUrl}${p}`, { ...init, signal: AbortSignal.timeout(timeoutMs), cache: 'no-store' })
  try {
    const v = await get('/api/version')
    if (!v.ok) return null
    const { version } = (await v.json()) as { version?: string }
    const tags = await get('/api/tags')
    const all = tags.ok ? ((await tags.json()) as { models?: { name: string; size?: number }[] }).models ?? [] : []
    const writes = await Promise.all(all.map(async (m) => {
      try {
        const r = await get('/api/show', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: m.name }) })
        const caps = r.ok ? ((await r.json()) as { capabilities?: string[] }).capabilities : undefined
        return !caps || caps.includes('completion')
      } catch {
        return true
      }
    }))
    return { version: version ?? '', models: all.filter((_, i) => writes[i]).map((m) => ({ name: m.name, sizeGb: gb(m.size ?? 0) })) }
  } catch {
    return null
  }
}
