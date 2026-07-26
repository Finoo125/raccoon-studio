import { describe, it, expect } from 'vitest'
import {
  buildSupportBundle,
  redactSecrets,
  requiredNodeClasses,
  tailLines,
  type BundleInput,
} from './support-bundle'

const input = (over: Partial<BundleInput> = {}): BundleInput => ({
  generatedAt: '2026-07-26T10:00:00.000Z',
  app: { version: '1.0.23' },
  paths: { COMFYUI_MODELS_DIR: 'E:/Raccoon Studio/comfyui/ComfyUI/models' },
  comfyui: {
    reachable: true,
    baseUrl: 'http://127.0.0.1:8188',
    loadedNodes: requiredNodeClasses(),
    models: { 'UNETLoader.unet_name': ['anima-turbo-v1.0.safetensors'] },
  },
  logs: { 'comfyui.err': 'all good' },
  ...over,
})

describe('requiredNodeClasses', () => {
  it('collects class_types from the shipped workflow graphs', () => {
    const classes = requiredNodeClasses()
    expect(classes).toContain('LTXVTiledVAEDecode') // LTX23.json
    expect(classes).toContain('UNETLoader') // image workflows
    expect(classes).toContain('FaceDetailer') // helper-appended, in no template
  })

  it('is sorted and free of duplicates', () => {
    const classes = requiredNodeClasses()
    expect(classes).toEqual([...new Set(classes)].sort())
  })
})

describe('redactSecrets', () => {
  // Add-on unlock keys are `<base64url payload>.<base64url signature>`.
  it('removes add-on unlock keys', () => {
    const key = `${'a'.repeat(48)}.${'b'.repeat(64)}`
    expect(redactSecrets(`redeem failed for ${key}`)).toBe('redeem failed for [redacted-key]')
  })

  it('removes labelled secrets regardless of quoting or casing', () => {
    expect(redactSecrets('api_key=sk-live-1234')).toBe('api_key=[redacted]')
    expect(redactSecrets('{"token": "abc123"}')).toBe('{"token": "[redacted]"}')
    expect(redactSecrets('PASSWORD: hunter2')).toBe('PASSWORD: [redacted]')
  })

  it('leaves ordinary log text and file paths alone', () => {
    const line = 'E:/Raccoon Studio/comfyui/ComfyUI/models/anima-turbo-v1.0.safetensors'
    expect(redactSecrets(line)).toBe(line)
  })
})

describe('tailLines', () => {
  it('returns everything when the file is shorter than the cap', () => {
    expect(tailLines('a\nb', 10)).toBe('a\nb')
  })

  it('keeps the last N lines and says how many were dropped', () => {
    const out = tailLines(Array.from({ length: 100 }, (_, i) => `line${i}`).join('\n'), 3)
    expect(out.split('\n')).toEqual(['… (97 earlier lines trimmed)', 'line97', 'line98', 'line99'])
  })
})

describe('buildSupportBundle', () => {
  it('reports a clean install as having no missing nodes', () => {
    expect(buildSupportBundle(input())).toContain('None — every node the shipped workflows use is loaded.')
  })

  // The 2026-07-25 report: ComfyUI-LTXVideo failed to import, so every one of
  // its nodes vanished and video died with `missing_node_type`.
  it('names a node the workflows need but ComfyUI has not loaded', () => {
    const loaded = requiredNodeClasses().filter((c) => c !== 'LTXVTiledVAEDecode')
    const out = buildSupportBundle(input({ comfyui: { ...input().comfyui, loadedNodes: loaded } }))
    expect(out).toContain('!! LTXVTiledVAEDecode')
    expect(out).toContain('failed to import')
  })

  it('records an unreachable ComfyUI instead of failing', () => {
    const out = buildSupportBundle(
      input({ comfyui: { reachable: false, baseUrl: 'http://127.0.0.1:8188', error: 'ECONNREFUSED', loadedNodes: [], models: {} } }),
    )
    expect(out).toContain('NOT REACHABLE')
    expect(out).toContain('ECONNREFUSED')
    expect(out).toContain('(skipped — ComfyUI unreachable)')
  })

  it('redacts secrets that reached a log line', () => {
    const key = `${'a'.repeat(48)}.${'b'.repeat(64)}`
    const out = buildSupportBundle(input({ logs: { 'app.log': `unlocked with ${key}` } }))
    expect(out).not.toContain(key)
    expect(out).toContain('[redacted-key]')
  })

  it('includes each log section and the model lists', () => {
    const out = buildSupportBundle(input({ logs: { 'comfyui.err': 'Traceback (most recent call last)' } }))
    expect(out).toContain('logs/comfyui.err')
    expect(out).toContain('Traceback (most recent call last)')
    expect(out).toContain('UNETLoader.unet_name (1)')
    expect(out).toContain('anima-turbo-v1.0.safetensors')
  })
})
