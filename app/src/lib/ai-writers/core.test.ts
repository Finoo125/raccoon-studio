import { describe, expect, it } from 'vitest'
import { parseWriterId, writerIdOf, type WriterRef } from './writer-id'
import { OLLAMA_TIERS, belowTier, tierFor } from './tiers'
import { cardKind, jobFor, pickWriter, scanRows, setupOffers, startsByItself, writerOptions } from './view'
import type { SetupJob } from './setup-jobs'
import { writerErrorMessage } from './errors'
import type { ScanResult } from './types'

describe('writer ids', () => {
  const refs: [string, WriterRef][] = [
    ['builtin', { kind: 'builtin' }],
    ['ollama:qwen3.5:27b', { kind: 'ollama', model: 'qwen3.5:27b' }],
    ['ollama:hf.co/user/repo:Q4_K_M', { kind: 'ollama', model: 'hf.co/user/repo:Q4_K_M' }],
    ['lmstudio:Sulphur/promptenhancer/model-q8_0.gguf', { kind: 'lmstudio', model: 'Sulphur/promptenhancer/model-q8_0.gguf' }],
    ['server:s1a2b3:hf.co/a/b:Q4', { kind: 'server', server: 's1a2b3', model: 'hf.co/a/b:Q4' }],
  ]
  it.each(refs)('%s round-trips', (id, ref) => {
    expect(parseWriterId(id)).toEqual(ref)
    expect(writerIdOf(ref)).toBe(id)
  })
  it.each(['', 'ollama:', 'ollama:  ', 'lmstudio:', 'server:x', 'server::m', 'server:x:', 'chatgpt:4o', 'builtin:x'])(
    'rejects %j', (id) => expect(parseWriterId(id)).toBeNull())
})

describe('tierFor', () => {
  it.each([[0, 's'], [7.9, 's'], [9.9, 's'], [10, 'm'], [11.9, 'm'], [21.9, 'm'], [22, 'l'], [23.6, 'l'], [31.8, 'l']] as const)(
    '%s GiB → %s', (gb, tier) => expect(tierFor(gb)).toBe(tier))
  it('an undetected card gets the middle tier', () => expect(tierFor(null)).toBe('m'))
  it('names one qwen3.5 model per tier, small to large', () => {
    expect(OLLAMA_TIERS.map((t) => t.model)).toEqual(['qwen3.5:4b', 'qwen3.5:9b', 'qwen3.5:27b'])
    expect(OLLAMA_TIERS.map((t) => t.label)).toEqual(['Under 10 GB', '10–20 GB', '24 GB or more'])
  })
})

const empty: ScanResult = {
  gpu: null, disk: null, comfyui: true,
  builtin: { state: 'missing' },
  ollama: { state: 'missing', canStart: false, models: [] },
  lmstudio: { state: 'missing', canStart: false, models: [] },
  servers: [], tier: 'm',
}
const found: ScanResult = {
  ...empty,
  builtin: { state: 'ready' },
  ollama: { state: 'running', version: '0.31.1', canStart: true, models: [
    { id: 'ollama:qwen3.5:27b', name: 'qwen3.5:27b', sizeGb: 17.4, tags: [] },
  ] },
  lmstudio: { state: 'off', canStart: true, models: [
    { id: 'lmstudio:Sulphur/pe/pe.gguf', name: 'Sulphur Prompt Enhancer', sizeGb: 10.4, tags: [] },
  ] },
  servers: [
    { id: 'sa', address: 'http://127.0.0.1:8080', kind: 'llama.cpp server', saved: false, reachable: true,
      models: [{ id: 'server:sa:qwen3-8b.gguf', name: 'qwen3-8b.gguf', tags: [] }] },
    { id: 'sb', address: 'http://192.168.1.20:5001', kind: 'AI server', saved: true, reachable: false, models: [] },
  ],
}

describe('writerOptions', () => {
  it('lists nothing when nothing is installed', () => expect(writerOptions(empty)).toEqual([]))
  it('groups every source, marks switched-off apps and skips unreachable servers', () => {
    const opts = writerOptions(found)
    expect(opts.map((o) => [o.id, o.group, o.app, o.off])).toEqual([
      ['builtin', 'Built into Raccoon Studio', 'builtin', false],
      ['ollama:qwen3.5:27b', 'Ollama', 'ollama', false],
      ['lmstudio:Sulphur/pe/pe.gguf', 'LM Studio', 'lmstudio', true],
      ['server:sa:qwen3-8b.gguf', 'Server 127.0.0.1:8080', 'server', false],
    ])
    expect(opts[1].detail).toBe('17.4 GB')
  })
  it('marks the built-in writer off while ComfyUI is down', () => {
    expect(writerOptions({ ...found, comfyui: false })[0]).toMatchObject({ id: 'builtin', off: true })
  })
})

describe('pickWriter', () => {
  const opts = writerOptions(found)
  it('keeps the remembered writer while it is listed', () =>
    expect(pickWriter('lmstudio:Sulphur/pe/pe.gguf', opts)?.id).toBe('lmstudio:Sulphur/pe/pe.gguf'))
  it('falls back to the first ready writer when the remembered one is gone', () =>
    expect(pickWriter('ollama:deleted:7b', opts)?.id).toBe('builtin'))
  it('takes a switched-off writer only when nothing is ready', () => {
    const offOnly = writerOptions({ ...empty, lmstudio: found.lmstudio })
    expect(pickWriter('', offOnly)?.id).toBe('lmstudio:Sulphur/pe/pe.gguf')
  })
  it('answers null with no writers', () => expect(pickWriter('builtin', [])).toBeNull())
  // Final review: the video dialog fell back to qwen3.5:4b (first in Ollama's list) and Use then saved it.
  it('keeps a fallback off the models below a floor, but never a chosen one', () => {
    const model = (name: string) => ({ id: `ollama:${name}`, name, sizeGb: 1, tags: [] })
    const both = (state: 'running' | 'off') => writerOptions({ ...empty,
      ollama: { state, version: '0.31.1', canStart: true, models: [model('qwen3.5:4b'), model('qwen3.5:9b')] } })
    const avoid = belowTier('m')
    expect(avoid).toEqual(['ollama:qwen3.5:4b'])
    expect(pickWriter('', both('running'), avoid)?.id).toBe('ollama:qwen3.5:9b')
    expect(pickWriter('', both('off'), avoid)?.id).toBe('ollama:qwen3.5:9b')
    expect(pickWriter('ollama:qwen3.5:4b', both('running'), avoid)?.id).toBe('ollama:qwen3.5:4b')
    // Only the small one there: it still writes.
    const small = writerOptions({ ...empty, ollama: { state: 'running', version: '0.31.1', canStart: true, models: [model('qwen3.5:4b')] } })
    expect(pickWriter('', small, avoid)?.id).toBe('ollama:qwen3.5:4b')
    expect(belowTier('s')).toEqual([])
  })
})

describe('setupOffers', () => {
  it('offers both when nothing is installed', () => expect(setupOffers(empty)).toEqual({ builtin: true, ollama: true }))
  it('offers only what is missing', () => {
    expect(setupOffers({ ...empty, ollama: { ...empty.ollama, state: 'off' } })).toEqual({ builtin: true, ollama: false })
    expect(setupOffers(found)).toEqual({ builtin: false, ollama: false })
  })
})

describe('writerErrorMessage', () => {
  const refused = new TypeError('fetch failed')
  it('names the program that is down', () => {
    expect(writerErrorMessage(refused, { kind: 'builtin' })).toMatch(/ComfyUI is not running/)
    expect(writerErrorMessage(refused, { kind: 'ollama', model: 'x' })).toMatch(/Ollama is not running/)
    expect(writerErrorMessage(refused, { kind: 'lmstudio', model: 'x' })).toMatch(/LM Studio didn.t answer/)
    expect(writerErrorMessage(refused, { kind: 'server', server: 's', model: 'm' }, 'http://127.0.0.1:8080'))
      .toBe('Nothing answered at 127.0.0.1:8080. Is the server running?')
  })
  it('says the built-in writer is not downloaded when ComfyUI lacks the file', () => {
    expect(writerErrorMessage(new Error('value_not_in_list: qwen3vl_4b_fp8_scaled.safetensors'), { kind: 'builtin' }))
      .toMatch(/isn.t downloaded yet/)
  })
  it('says Ollama lacks a model it does not have', () => {
    expect(writerErrorMessage(new Error('Ollama 404: model "qwen3.5:4b" not found, try pulling it first'), { kind: 'ollama', model: 'qwen3.5:4b' }))
      .toBe('Ollama doesn’t have qwen3.5:4b. Pick another model, or set it up again.')
  })
  it('passes other messages through', () =>
    expect(writerErrorMessage(new Error('Ollama didn’t start.'), { kind: 'ollama', model: 'x' })).toBe('Ollama didn’t start.'))
})

describe('scanRows', () => {
  const rows = (s: ScanResult) => Object.fromEntries(scanRows(s).map((r) => [r.key, r]))
  it('says plainly what is missing on an empty PC', () => {
    const r = rows(empty)
    expect(r.gpu).toMatchObject({ state: 'none', detail: 'Couldn’t detect it — pick your card size below' })
    expect(r.builtin).toMatchObject({ state: 'none', detail: 'Not downloaded yet (5 GB)' })
    expect(r.ollama).toMatchObject({ state: 'none', detail: 'Not installed' })
    expect(r.lmstudio).toMatchObject({ state: 'none', detail: 'Not installed' })
    expect(r.servers).toMatchObject({ state: 'none', action: 'add-address',
      detail: 'llama.cpp, KoboldCpp, Jan and similar: none running on the usual addresses' })
  })
  it('reports what runs, what is switched off, and offers to start it', () => {
    const r = rows({ ...found, gpu: { name: 'NVIDIA GeForce RTX 5090', vramGb: 31.8 }, disk: { path: 'C:\\', freeGb: 176.8 } })
    expect(r.gpu.detail).toBe('NVIDIA GeForce RTX 5090 · 31.8 GB video memory')
    expect(r.disk).toMatchObject({ state: 'ok', detail: '176.8 GB free on C:' })
    expect(r.builtin).toMatchObject({ state: 'ok', detail: 'Installed · Krea2’s text model, nothing else needed' })
    expect(r.ollama).toMatchObject({ state: 'ok', detail: 'Running · version 0.31.1 · 1 model' })
    expect(r.lmstudio).toMatchObject({ state: 'warn', detail: 'Installed · switched off · 1 model', action: 'start-lmstudio' })
    expect(r.servers).toMatchObject({ state: 'ok', action: 'add-address',
      detail: 'llama.cpp server at 127.0.0.1:8080 · 1 model · AI server at 192.168.1.20:5001 · not answering' })
  })
  it('asks for ComfyUI when the built-in writer cannot run', () => {
    expect(rows({ ...found, comfyui: false }).builtin).toMatchObject({ state: 'warn', action: 'start-comfy',
      detail: 'Installed · ComfyUI is not running' })
  })
  it('never offers to start an Ollama on another computer', () => {
    const r = rows({ ...empty, ollama: { state: 'off', canStart: false, models: [] } })
    expect(r.ollama).toMatchObject({ state: 'warn', detail: 'Not answering at its address on another computer' })
    expect(r.ollama.action).toBeUndefined()
  })
  it('warns about a nearly full drive', () => {
    expect(rows({ ...empty, disk: { path: '/', freeGb: 6 } }).disk).toMatchObject({ state: 'warn', detail: 'Only 6.0 GB free on /' })
  })
})

describe('cardKind', () => {
  const opts = writerOptions(found)
  it('follows the picked writer and what is happening', () => {
    expect(cardKind(null, null, {})).toBe('loading')
    expect(cardKind(empty, null, {})).toBe('none')
    expect(cardKind(found, opts[0], {})).toBe('ready')
    expect(cardKind(found, opts[2], {})).toBe('off')
    expect(cardKind(found, opts[2], { starting: 'lmstudio' })).toBe('starting')
    expect(cardKind(found, opts[2], { writing: true })).toBe('writing')
    expect(cardKind({ ...found, comfyui: false }, writerOptions({ ...found, comfyui: false })[0], {})).toBe('comfy-off')
  })
})

// Final review, 2026-10-10.
describe('review fixes', () => {
  it('offers the Ollama setup when Ollama is there but has no model to write with', () => {
    expect(setupOffers({ ...empty, ollama: { state: 'running', version: '0.31.1', canStart: true, models: [] } }).ollama).toBe(true)
    expect(setupOffers({ ...empty, ollama: { state: 'off', canStart: true, models: [] } }).ollama).toBe(true)
    // An Ollama on another computer is never set up from here.
    expect(setupOffers({ ...empty, ollama: { state: 'off', canStart: false, models: [] } }).ollama).toBe(false)
  })
  // Final review: after the image helper's small-card setup, the video setup could not offer its 9b.
  it('offers the Ollama setup when every model it holds is below the floor', () => {
    const only = (name: string) => ({ ...empty, ollama: { state: 'running' as const, version: '0.31.1', canStart: true,
      models: [{ id: `ollama:${name}`, name, sizeGb: 3.4, tags: [] }] } })
    expect(setupOffers(only('qwen3.5:4b'), 'm').ollama).toBe(true)
    expect(setupOffers(only('qwen3.5:4b')).ollama).toBe(false)
    expect(setupOffers(only('qwen3.5:9b'), 'm').ollama).toBe(false)
  })
  it('only promises "starts by itself" for apps that do', () => {
    const opts = writerOptions({ ...found, comfyui: false })
    expect(opts.filter(startsByItself).map((o) => o.app)).toEqual(['lmstudio'])
    expect(opts[0]).toMatchObject({ app: 'builtin', off: true })
  })
  it('shows a setup still running from an earlier opening, and a finished one only if it was followed', () => {
    const running = { kind: 'ollama', status: 'running', steps: [] } as SetupJob
    const done = { kind: 'builtin', status: 'done', steps: [] } as SetupJob
    expect(jobFor([running, done], 'ollama', new Set())).toBe(running)
    expect(jobFor([running, done], 'builtin', new Set())).toBeUndefined()
    expect(jobFor([running, done], 'builtin', new Set(['builtin']))).toBe(done)
  })
  it('turns a refused or slow write into plain words', () => {
    const lms = { kind: 'lmstudio', model: 'S/pe/pe.gguf' } as const
    expect(writerErrorMessage(new Error('400: {"error":"Failed to load model"}'), lms))
      .toBe('LM Studio couldn’t write with that model. Try again, or pick another writer.')
    const timeout = Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' })
    expect(writerErrorMessage(timeout, { kind: 'server', server: 's', model: 'm' }, 'http://127.0.0.1:8080'))
      .toBe('The AI server at 127.0.0.1:8080 took too long to answer. Try again, or pick a smaller model.')
    expect(writerErrorMessage(new Error('Ollama /api/chat failed (500)'), { kind: 'ollama', model: 'x' }))
      .toBe('Ollama couldn’t write with x. Try again, or pick another writer.')
  })
})
