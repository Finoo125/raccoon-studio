import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { detectGpu } from '@/lib/hardware'
import { findOllamaExe, isLocalUrl, ollamaExeCandidates, ollamaModelsDir, readOllamaManifests } from './ollama-local'
import { readLmsModels } from './lmstudio'
import { addServer, listServerModels, normalizeAddress, serverIdOf } from './openai-server'
import { scanWriters, type ScanDeps } from './scan'

let tmp: string
beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aiw-')) })
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }))

const write = (p: string, body: string | object) => {
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, typeof body === 'string' ? body : JSON.stringify(body))
}

/** A fetch that answers from a table of URL → JSON (or a status), and hangs (until aborted) on anything else. */
function fakeFetch(routes: Record<string, unknown>): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const key = Object.keys(routes).find((k) => url === k || url.startsWith(k + '?'))
    if (key === undefined) {
      return new Promise((_, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))))
    }
    const v = routes[key]
    if (typeof v === 'number') return new Response('', { status: v })
    if (typeof v === 'string') return new Response(v, { status: 200 })
    return Response.json(v)
  }) as typeof fetch
}

describe('detectGpu', () => {
  it('reads ComfyUI system_stats and tidies the device name', async () => {
    const f = fakeFetch({ 'http://c/system_stats': { devices: [{ name: 'cuda:0 NVIDIA GeForce RTX 5090 : cudaMallocAsync', vram_total: 34190458880 }] } })
    expect(await detectGpu('http://c', { fetcher: f, timeoutMs: 50 })).toEqual({ name: 'NVIDIA GeForce RTX 5090', vramGb: 31.8 })
  })
  it('falls back to nvidia-smi when ComfyUI is down', async () => {
    const run = async () => 'NVIDIA GeForce RTX 3060, 12288\n'
    expect(await detectGpu('http://c', { fetcher: fakeFetch({}), run, timeoutMs: 50 })).toEqual({ name: 'NVIDIA GeForce RTX 3060', vramGb: 12 })
  })
  it('answers null when nothing reports a card', async () => {
    const run = async () => { throw new Error('not found') }
    expect(await detectGpu('http://c', { fetcher: fakeFetch({}), run, timeoutMs: 50 })).toBeNull()
  })
})

describe('Ollama on disk', () => {
  it('reads models from manifests, with namespaces and hf.co paths, skipping embeddings', () => {
    const dir = path.join(tmp, 'models')
    const man = (rel: string, size: number, config = 'cfg-llm') => write(path.join(dir, 'manifests', rel),
      { config: { digest: `sha256:${config}` }, layers: [{ size }, { size: 1000 }] })
    write(path.join(dir, 'blobs', 'sha256-cfg-llm'), { model_family: 'qwen35' })
    write(path.join(dir, 'blobs', 'sha256-cfg-embed'), { model_family: 'nomic-bert' })
    man('registry.ollama.ai/library/qwen3.5/27b', 17_420_420_832)
    man('registry.ollama.ai/huihui_ai/qwen3.5-abliterated/9b', 6_600_000_000)
    man('hf.co/bartowski/Qwen3-8B-GGUF/Q4_K_M', 5_000_000_000)
    man('registry.ollama.ai/library/nomic-embed-text/latest', 274_000_000, 'cfg-embed')
    expect(readOllamaManifests(dir)).toEqual([
      { name: 'hf.co/bartowski/Qwen3-8B-GGUF:Q4_K_M', sizeGb: 5 },
      { name: 'huihui_ai/qwen3.5-abliterated:9b', sizeGb: 6.6 },
      { name: 'qwen3.5:27b', sizeGb: 17.4 },
    ])
  })
  it('answers an empty list for a missing or broken models dir', () => {
    expect(readOllamaManifests(path.join(tmp, 'nope'))).toEqual([])
    write(path.join(tmp, 'm', 'manifests', 'registry.ollama.ai', 'library', 'x', 'latest'), 'not json')
    expect(readOllamaManifests(path.join(tmp, 'm'))).toEqual([])
  })
  it('respects OLLAMA_MODELS', () => {
    expect(ollamaModelsDir({ OLLAMA_MODELS: 'D:\\models\\ollama' }, 'C:\\Users\\a')).toBe('D:\\models\\ollama')
    expect(ollamaModelsDir({}, '/home/a')).toBe(path.join('/home/a', '.ollama', 'models'))
  })
  it('looks for the program where each platform installs it', () => {
    const win = ollamaExeCandidates({ platform: 'win32', env: { LOCALAPPDATA: 'C:\\L', PATH: 'C:\\bin' }, home: 'C:\\U', dataDir: 'C:\\d' })
    expect(win[0]).toBe(path.join('C:\\L', 'Programs', 'Ollama', 'ollama.exe'))
    expect(win).toContain(path.join('C:\\bin', 'ollama.exe'))
    const lin = ollamaExeCandidates({ platform: 'linux', env: { PATH: '/opt/x' }, home: '/home/a', dataDir: '/srv/data' })
    expect(lin).toEqual(expect.arrayContaining([path.join('/srv/data', 'tools', 'ollama', 'bin', 'ollama'), '/usr/local/bin/ollama', path.join('/opt/x', 'ollama')]))
    expect(findOllamaExe(lin, (p) => p === '/usr/local/bin/ollama')).toBe('/usr/local/bin/ollama')
    expect(findOllamaExe(lin, () => false)).toBeNull()
  })
  it('only treats this PC as local', () => {
    for (const u of ['http://127.0.0.1:11434', 'http://localhost:11434', 'http://[::1]:11434']) expect(isLocalUrl(u)).toBe(true)
    for (const u of ['http://192.168.1.5:11434', 'http://ollama.example.com', 'nonsense']) expect(isLocalUrl(u)).toBe(false)
  })
})

describe('LM Studio on disk', () => {
  it('lists chat models from its index and drops embeddings', () => {
    write(path.join(tmp, '.lmstudio', '.internal', 'model-index-cache.json'), { models: [
      { domain: 'llm', indexedModelIdentifier: 'Sulphur/promptenhancer/pe-q8_0.gguf', displayName: 'Sulphur Prompt Enhancer Model' },
      { domain: 'embedding', indexedModelIdentifier: 'nomic-ai/nomic-embed/e.gguf', displayName: 'Nomic Embed' },
    ] })
    expect(readLmsModels(tmp)).toEqual([{ path: 'Sulphur/promptenhancer/pe-q8_0.gguf', name: 'Sulphur Prompt Enhancer Model' }])
  })
  it('falls back to the gguf files in its models folder', () => {
    const models = path.join(tmp, '.lmstudio', 'models')
    write(path.join(models, 'lmstudio-community', 'Qwen3-8B-GGUF', 'Qwen3-8B-Q4_K_M.gguf'), 'x')
    write(path.join(models, 'lmstudio-community', 'Qwen3-8B-GGUF', 'mmproj-Qwen3-8B-F16.gguf'), 'x')
    write(path.join(models, 'nomic-ai', 'nomic-embed-text-v1.5-GGUF', 'nomic-embed-text-v1.5.Q4_K_M.gguf'), 'x')
    write(path.join(models, 'big', 'Big-GGUF', 'Big-00002-of-00002.gguf'), 'x')
    write(path.join(models, 'big', 'Big-GGUF', 'Big-00001-of-00002.gguf'), 'x')
    expect(readLmsModels(tmp)).toEqual([
      { path: 'big/Big-GGUF/Big-00001-of-00002.gguf', name: 'Big-GGUF' },
      { path: 'lmstudio-community/Qwen3-8B-GGUF/Qwen3-8B-Q4_K_M.gguf', name: 'Qwen3-8B-GGUF' },
    ])
  })
  it('answers nothing when LM Studio is absent', () => expect(readLmsModels(tmp)).toEqual([]))
})

describe('OpenAI-style servers', () => {
  it.each([
    ['http://127.0.0.1:8080', 'http://127.0.0.1:8080'],
    ['  http://127.0.0.1:8080/v1/  ', 'http://127.0.0.1:8080'],
    ['127.0.0.1:5001', 'http://127.0.0.1:5001'],
    ['https://ai.local', 'https://ai.local'],
    ['nonsense', null], ['ftp://x:21', null], ['http://user:pw@host:1', null], ['', null],
  ])('normalizes %j', (input, out) => expect(normalizeAddress(input)).toBe(out))
  it('gives each address a stable id without colons', () => {
    expect(serverIdOf('http://127.0.0.1:8080')).toBe(serverIdOf('http://127.0.0.1:8080'))
    expect(serverIdOf('http://127.0.0.1:8080')).not.toBe(serverIdOf('http://127.0.0.1:8081'))
    expect(serverIdOf('http://127.0.0.1:8080')).not.toContain(':')
  })
  it('names the server from its answer', async () => {
    const f = fakeFetch({ 'http://a/v1/models': { data: [{ id: 'qwen3-8b.gguf', owned_by: 'llamacpp' }] } })
    expect(await listServerModels('http://a', f, 50)).toEqual({ kind: 'llama.cpp server', models: ['qwen3-8b.gguf'] })
  })
  it('survives an empty list, junk and silence', async () => {
    expect(await listServerModels('http://a', fakeFetch({ 'http://a/v1/models': { data: [] } }), 50)).toEqual({ kind: 'AI server', models: [] })
    expect(await listServerModels('http://a', fakeFetch({ 'http://a/v1/models': '<html>' }), 50)).toEqual({ kind: 'AI server', models: [] })
    expect(await listServerModels('http://a', fakeFetch({ 'http://a/v1/models': 500 }), 50)).toBeNull()
    expect(await listServerModels('http://a', fakeFetch({}), 50)).toBeNull()
  })
  it('saves an address only after it answers, with plain errors otherwise', async () => {
    const saved: { id: string; address: string }[] = []
    const deps = { fetcher: fakeFetch({ 'http://127.0.0.1:8080/v1/models': { data: [{ id: 'm', owned_by: 'llamacpp' }] } }),
      list: () => saved, save: (s: typeof saved) => { saved.splice(0, saved.length, ...s) }, timeoutMs: 50 }
    expect(await addServer('nonsense', deps)).toEqual({ error: 'That doesn’t look like an address. Example: http://127.0.0.1:8080' })
    expect(await addServer('http://127.0.0.1:9999', deps)).toEqual({ error: 'Nothing answered at 127.0.0.1:9999. Is the server running?' })
    const ok = await addServer('127.0.0.1:8080', deps)
    expect(ok).toMatchObject({ server: { address: 'http://127.0.0.1:8080' } })
    await addServer('http://127.0.0.1:8080/', deps)
    expect(saved).toHaveLength(1)
  })
  it('sends a key, keeps only loaded models, and says when the key is missing or wrong (Unsloth Studio)', async () => {
    let autoSwitch = false
    const unsloth: typeof fetch = async (input, init) => {
      const auth = new Headers(init?.headers).get('authorization')
      if (auth !== 'Bearer sk-unsloth-good') return new Response('', { status: 401 })
      if (String(input).endsWith('/api/settings/openai-auto-switch')) return Response.json({ enabled: autoSwitch })
      return Response.json({ data: [{ id: 'unsloth/gemma-4-26B-A4B-it-GGUF', owned_by: 'unsloth-studio', loaded: true },
        { id: 'ollama/qwen3.5:9b', owned_by: 'unsloth-studio', loaded: false }] })
    }
    expect(await listServerModels('http://a', unsloth, 50)).toEqual({ kind: 'AI server', models: [], needsKey: true })
    expect(await listServerModels('http://a', unsloth, 50, 'sk-unsloth-good')).toEqual({ kind: 'Unsloth Studio', models: ['unsloth/gemma-4-26B-A4B-it-GGUF'] })
    autoSwitch = true
    expect(await listServerModels('http://a', unsloth, 50, 'sk-unsloth-good'))
      .toEqual({ kind: 'Unsloth Studio', models: ['unsloth/gemma-4-26B-A4B-it-GGUF', 'ollama/qwen3.5:9b'] })
    const saved: { id: string; address: string; apiKey?: string }[] = [{ id: 'old', address: 'http://127.0.0.1:8888', apiKey: 'sk-unsloth-revoked' }]
    const deps = { fetcher: unsloth, list: () => saved, save: (s: typeof saved) => { saved.splice(0, saved.length, ...s) }, timeoutMs: 50 }
    expect(await addServer('127.0.0.1:8888', deps)).toEqual({ error: 'This server wants an API key. In Unsloth Studio: Settings → API → Create.' })
    expect(await addServer('127.0.0.1:8888', deps, 'sk-unsloth-bad')).toEqual({ error: 'The server refused that API key. Check it and try again.' })
    await addServer('127.0.0.1:8888', deps, ' sk-unsloth-good ')
    expect(saved).toEqual([{ id: serverIdOf('http://127.0.0.1:8888'), address: 'http://127.0.0.1:8888', apiKey: 'sk-unsloth-good' }])
  })
})

describe('scanWriters', () => {
  const base = (over: Partial<ScanDeps> = {}): Partial<ScanDeps> => ({
    comfyUrl: 'http://c', ollamaUrl: 'http://127.0.0.1:11434', savedServers: [],
    platform: 'win32', env: { LOCALAPPDATA: path.join(tmp, 'L') }, home: tmp, dataDir: path.join(tmp, 'data'),
    modelsDir: path.join(tmp, 'comfy-models'), sharedModelsDir: '',
    fetcher: fakeFetch({}), run: async () => { throw new Error('no nvidia-smi') }, timeoutMs: 50, ...over,
  })

  it('finds nothing on an empty PC', async () => {
    const r = await scanWriters(base())
    expect(r).toMatchObject({ gpu: null, comfyui: false, builtin: { state: 'missing' }, tier: 'm',
      ollama: { state: 'missing', models: [] }, lmstudio: { state: 'missing', models: [] }, servers: [] })
  })

  it('sees the built-in writer on disk while ComfyUI is down', async () => {
    write(path.join(tmp, 'comfy-models', 'text_encoders', 'qwen3vl_4b_fp8_scaled.safetensors'), 'x')
    expect((await scanWriters(base())).builtin.state).toBe('ready')
  })

  it('reports a switched-off Ollama with its models read from disk', async () => {
    write(path.join(tmp, 'L', 'Programs', 'Ollama', 'ollama.exe'), 'x')
    write(path.join(tmp, '.ollama', 'models', 'manifests', 'registry.ollama.ai', 'library', 'qwen3.5', '9b'),
      { config: { digest: 'sha256:none' }, layers: [{ size: 6_600_000_000 }] })
    const r = await scanWriters(base())
    expect(r.ollama).toEqual({ state: 'off', canStart: true, models: [{ id: 'ollama:qwen3.5:9b', name: 'qwen3.5:9b', sizeGb: 6.6, tags: [] }] })
  })

  it('never offers to start an Ollama on another machine', async () => {
    const r = await scanWriters(base({ ollamaUrl: 'http://192.168.1.9:11434' }))
    expect(r.ollama.canStart).toBe(false)
  })

  it('assembles a running setup', async () => {
    const f = fakeFetch({
      'http://c/system_stats': { devices: [{ name: 'cuda:0 NVIDIA GeForce RTX 5090 : x', vram_total: 34190458880 }] },
      'http://c/object_info/CLIPLoader': { CLIPLoader: { input: { required: { clip_name: [['qwen3vl_4b_fp8_scaled.safetensors']] } } } },
      'http://127.0.0.1:11434/api/version': { version: '0.31.1' },
      'http://127.0.0.1:11434/api/tags': { models: [{ name: 'qwen3.8-heretic:q5_k_m', size: 19_860_000_000 }, { name: 'nomic-embed-text:latest', size: 1 }] },
      'http://127.0.0.1:11434/api/show': { capabilities: ['completion', 'thinking'] },
      'http://127.0.0.1:8080/v1/models': { data: [{ id: 'qwen3-8b.gguf', owned_by: 'llamacpp' }] },
      'http://127.0.0.1:8888/v1/models': 401,
    })
    // /api/show answers the same for every model; the embedding is dropped by its name's capabilities below.
    const show: typeof fetch = async (input, init) => {
      if (String(input).endsWith('/api/show') && String(init?.body).includes('nomic')) return Response.json({ capabilities: ['embedding'] })
      return f(input, init)
    }
    write(path.join(tmp, '.lmstudio', 'bin', 'lms.exe'), 'x')
    write(path.join(tmp, '.lmstudio', '.internal', 'model-index-cache.json'),
      { models: [{ domain: 'llm', indexedModelIdentifier: 'S/pe/pe.gguf', displayName: 'Prompt Enhancer' }] })
    const r = await scanWriters(base({ fetcher: show, savedServers: [{ id: 'sx', address: 'http://10.0.0.2:5000' }] }))
    expect(r.gpu).toEqual({ name: 'NVIDIA GeForce RTX 5090', vramGb: 31.8 })
    expect(r.tier).toBe('l')
    expect(r.comfyui).toBe(true)
    expect(r.builtin.state).toBe('ready')
    expect(r.ollama).toEqual({ state: 'running', version: '0.31.1', canStart: true,
      models: [{ id: 'ollama:qwen3.8-heretic:q5_k_m', name: 'qwen3.8-heretic:q5_k_m', sizeGb: 19.9, tags: ['Uncensored'] }] })
    expect(r.lmstudio).toEqual({ state: 'off', canStart: true, models: [{ id: 'lmstudio:S/pe/pe.gguf', name: 'Prompt Enhancer', tags: [] }] })
    expect(r.servers).toEqual([
      { id: 'sx', address: 'http://10.0.0.2:5000', kind: 'AI server', saved: true, reachable: false, needsKey: false, models: [] },
      { id: serverIdOf('http://127.0.0.1:8080'), address: 'http://127.0.0.1:8080', kind: 'llama.cpp server', saved: false, reachable: true, needsKey: false,
        models: [{ id: `server:${serverIdOf('http://127.0.0.1:8080')}:qwen3-8b.gguf`, name: 'qwen3-8b.gguf', tags: [] }] },
      { id: serverIdOf('http://127.0.0.1:8888'), address: 'http://127.0.0.1:8888', kind: 'Unsloth Studio', saved: false, reachable: true, needsKey: true, models: [] },
    ])
  })

  it('answers quickly when every probe hangs', async () => {
    const t0 = Date.now()
    await scanWriters(base({ run: () => new Promise(() => {}) }))
    expect(Date.now() - t0).toBeLessThan(1000)
  })
})
