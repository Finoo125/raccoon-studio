import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { buildExtraModelPathsYaml, resolveSharedModelsDir, syncExtraModelPaths } from './extra-model-paths'

let tmp: string
const mk = (...p: string[]) => { const d = path.join(tmp, ...p); fs.mkdirSync(d, { recursive: true }); return d }

beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'raccoon-emp-')) })
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }) })

describe('buildExtraModelPathsYaml', () => {
  it('maps directories to ComfyUI folder keys and collapses aliases', () => {
    const yaml = buildExtraModelPathsYaml('/models', ['checkpoints', 'unet', 'diffusion_models', 'loras'])
    expect(yaml).toContain("base_path: '/models'")
    expect(yaml).toContain('  checkpoints: |\n    checkpoints')
    expect(yaml).toContain('  loras: |\n    loras')
    // `unet` and `diffusion_models` must land under one key, not a duplicate.
    expect(yaml).toContain('  diffusion_models: |\n    diffusion_models\n    unet')
    expect(yaml.match(/^ {2}diffusion_models:/gm)).toHaveLength(1)
  })

  it('escapes quotes in the base path', () => {
    expect(buildExtraModelPathsYaml("/it's/models", ['loras'])).toContain("base_path: '/it''s/models'")
  })
})

describe('resolveSharedModelsDir', () => {
  it('accepts a ComfyUI root and descends into models/', () => {
    mk('Comfy', 'models', 'loras')
    expect(resolveSharedModelsDir(path.join(tmp, 'Comfy'))).toBe(path.join(tmp, 'Comfy', 'models'))
  })

  it('accepts a models folder directly', () => {
    const models = mk('models', 'loras')
    expect(resolveSharedModelsDir(models)).toBe(models)
  })
})

describe('syncExtraModelPaths', () => {
  it('writes, then removes, its own config file', () => {
    const comfy = mk('Comfy')
    const shared = mk('Other', 'models', 'checkpoints')
    const file = path.join(comfy, 'extra_model_paths.yaml')

    syncExtraModelPaths(comfy, path.dirname(shared))
    expect(fs.readFileSync(file, 'utf8')).toContain('checkpoints')

    syncExtraModelPaths(comfy, '')
    expect(fs.existsSync(file)).toBe(false)
  })

  it('refuses to overwrite a hand-written config, but clearing leaves it alone', () => {
    const comfy = mk('Comfy')
    mk('Other', 'models', 'loras')
    const file = path.join(comfy, 'extra_model_paths.yaml')
    fs.writeFileSync(file, 'mine:\n  base_path: /elsewhere\n')

    expect(() => syncExtraModelPaths(comfy, path.join(tmp, 'Other'))).toThrow(/not written by Raccoon Studio/)
    syncExtraModelPaths(comfy, '')
    expect(fs.readFileSync(file, 'utf8')).toContain('mine:')
  })

  it('rejects a folder with no model subfolders', () => {
    const comfy = mk('Comfy')
    expect(() => syncExtraModelPaths(comfy, mk('Empty'))).toThrow(/no model subfolders/)
  })
})
