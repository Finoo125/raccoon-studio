import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import {
  buildSupportBundle,
  formatServerLog,
  redactSecrets,
  requiredNodeClasses,
  SCANNED_TEMPLATES,
  stripAnsi,
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

describe('every shipped template is actually scanned', () => {
  // Krea2 shipped without being added to the scan list and went unchecked for a
  // release. Comparing the union of class NAMES does not catch that — a family
  // built from core nodes contributes nothing the other templates lack, so the
  // union is identical either way (verified: that form of the test passed with
  // Krea2 removed). Comparing filenames against the directory is what catches it.
  it('scans exactly the workflow JSONs that exist on disk', () => {
    const dir = path.join(process.cwd(), 'workflows')
    const onDisk = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort()
    expect(onDisk.length).toBeGreaterThan(0)
    expect(Object.keys(SCANNED_TEMPLATES).sort()).toEqual(onDisk)
  })
})

describe('requiredNodeClasses', () => {
  it('collects class_types from the shipped workflow graphs', () => {
    const classes = requiredNodeClasses()
    expect(classes).toContain('RaccoonTiledVAEDecode') // LTX23.json
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

describe('formatServerLog', () => {
  // Verbatim shape of ComfyUI's /internal/logs/raw.
  it('joins entries and strips the colour codes', () => {
    const payload = {
      entries: [
        { t: '2026-07-26T10:42:48', m: '\x1b[32m[INFO]\x1b[0m starting\n' },
        { t: '2026-07-26T10:42:49', m: '[WARNING] Cannot import ComfyUI-LTXVideo\n' },
      ],
      size: 2,
    }
    expect(formatServerLog(payload)).toBe('[INFO] starting\n[WARNING] Cannot import ComfyUI-LTXVideo\n')
  })

  it('is empty for an unusable payload rather than throwing', () => {
    expect(formatServerLog(null)).toBe('')
    expect(formatServerLog({})).toBe('')
    expect(formatServerLog({ entries: 'nope' })).toBe('')
  })

  it('survives entries with no message', () => {
    expect(stripAnsi('\x1b[32mx\x1b[0m')).toBe('x')
    expect(formatServerLog({ entries: [{}, { m: 'ok' }] })).toBe('ok')
  })
})

describe('buildSupportBundle', () => {
  it('reports a clean install as having no missing nodes', () => {
    expect(buildSupportBundle(input())).toContain('None — every node the shipped workflows use is loaded.')
  })

  // The 2026-07-25 report: ComfyUI-LTXVideo failed to import, so every one of
  // its nodes vanished and video died with `missing_node_type`.
  it('names a node the workflows need but ComfyUI has not loaded', () => {
    const loaded = requiredNodeClasses().filter((c) => c !== 'RaccoonTiledVAEDecode')
    const out = buildSupportBundle(input({ comfyui: { ...input().comfyui, loadedNodes: loaded } }))
    expect(out).toContain('!! RaccoonTiledVAEDecode')
    expect(out).toContain('failed to import')
  })

  // The on-disk comfyui.err was a day stale while this log held the answer.
  it('includes the running instance log and points the missing-node section at it', () => {
    const loaded = requiredNodeClasses().filter((c) => c !== 'RaccoonTiledVAEDecode')
    const out = buildSupportBundle(
      input({
        comfyui: {
          ...input().comfyui,
          loadedNodes: loaded,
          serverLog: '[WARNING] Cannot import ComfyUI-LTXVideo module for custom nodes\n0.1 seconds (IMPORT FAILED)',
        },
      }),
    )
    expect(out).toContain('ComfyUI server log (from the running instance)')
    expect(out).toContain('IMPORT FAILED')
    expect(out).toContain('Search the ComfyUI server log below for')
  })

  it('says so when the server log could not be fetched', () => {
    expect(buildSupportBundle(input())).toContain('too old to expose /internal/logs/raw')
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
