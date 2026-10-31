import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { buildExtraModelPathsYaml } from '@/lib/comfyui/extra-model-paths'
import { modelsOnDisk, walk } from './on-disk'

const dirs: string[] = []
function tree(files: string[]): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ondisk-'))
  dirs.push(root)
  for (const f of files) {
    fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true })
    fs.writeFileSync(path.join(root, f), 'x')
  }
  return root
}
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }) })

describe('modelsOnDisk', () => {
  it('knows nothing when the models folder is not configured', () => {
    expect(modelsOnDisk('', '')).toEqual({ known: false, files: [], hasImageModel: false })
  })
  it('counts a diffusion model as something to generate with', () => {
    const r = modelsOnDisk(tree(['diffusion_models/anima-turbo-v1.0.safetensors', 'diffusion_models/put_diffusion_model_files_here']), '')
    expect(r).toEqual({ known: true, files: ['anima-turbo-v1.0.safetensors'], hasImageModel: true })
  })
  it('does not count a LoRA alone', () => {
    expect(modelsOnDisk(tree(['loras/style.safetensors']), '').hasImageModel).toBe(false)
  })
  it('sees models in a shared ComfyUI install, through its models/ subfolder only', () => {
    const shared = tree(['models/checkpoints/juggernaut.safetensors', 'custom_nodes/pack/weights/node-only.safetensors'])
    const r = modelsOnDisk(tree([]), shared)
    expect(r.hasImageModel).toBe(true)
    expect(r.files).toContain('juggernaut.safetensors')
    // Walking the install itself reached custom_nodes and the venv.
    expect(r.files).not.toContain('node-only.safetensors')
  })
  it('sees models in a shared folder that is a models folder itself', () => {
    const r = modelsOnDisk(tree([]), tree(['checkpoints/juggernaut.safetensors']))
    expect(r.hasImageModel).toBe(true)
  })
  it('follows a linked model folder', () => {
    const elsewhere = tree(['big-model.safetensors'])
    const models = tree([])
    // A junction on Windows (no admin needed); the type is ignored elsewhere.
    fs.symlinkSync(elsewhere, path.join(models, 'diffusion_models'), 'junction')
    const r = modelsOnDisk(models, '')
    expect(r.files).toContain('big-model.safetensors')
    expect(r.hasImageModel).toBe(true)
  })
  it('knows nothing when a hand-written extra_model_paths.yaml points ComfyUI elsewhere', () => {
    const comfy = tree(['models/checkpoints/a.safetensors'])
    fs.writeFileSync(path.join(comfy, 'extra_model_paths.yaml'), 'mine:\n  base_path: D:/models\n')
    expect(modelsOnDisk(path.join(comfy, 'models'), '', comfy).known).toBe(false)
  })
  it('counts an empty extra_model_paths.yaml as absent, not hand-written', () => {
    const comfy = tree(['models/checkpoints/a.safetensors'])
    for (const empty of ['', '  \n\t\n']) {
      fs.writeFileSync(path.join(comfy, 'extra_model_paths.yaml'), empty)
      expect(modelsOnDisk(path.join(comfy, 'models'), '', comfy).known).toBe(true)
    }
  })
  it('walk leaves linked folders alone unless asked (the Models page would list them twice)', () => {
    const models = tree(['diffusion_models/big-model.safetensors'])
    fs.symlinkSync(path.join(models, 'diffusion_models'), path.join(models, 'linked'), 'junction')
    const found: Parameters<typeof walk>[2] = []
    walk(models, 6, found, models)
    expect(found.map((f) => f.entry.name)).toEqual(['big-model.safetensors'])
  })
  it('still knows with the extra_model_paths.yaml it wrote itself', () => {
    const comfy = tree(['models/checkpoints/a.safetensors'])
    const shared = tree(['checkpoints/b.safetensors'])
    fs.writeFileSync(path.join(comfy, 'extra_model_paths.yaml'), buildExtraModelPathsYaml(shared, ['checkpoints']))
    const r = modelsOnDisk(path.join(comfy, 'models'), shared, comfy)
    expect(r.known).toBe(true)
    expect(r.files).toEqual(expect.arrayContaining(['a.safetensors', 'b.safetensors']))
  })
})
