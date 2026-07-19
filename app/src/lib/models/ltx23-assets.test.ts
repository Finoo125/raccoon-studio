import { describe, it, expect } from 'vitest'
import { LTX23_ASSETS, ltxAssetInstalled } from './ltx23-assets'
import workflow from '../../../workflows/LTX23.json'

// Every model filename the LTX23 workflow references, scraped from its inputs.
function workflowModelFilenames(): string[] {
  const names = new Set<string>()
  const wf = workflow as Record<string, { inputs: Record<string, unknown> }>
  for (const node of Object.values(wf)) {
    for (const v of Object.values(node.inputs)) {
      if (typeof v === 'string' && /\.(safetensors|pth|pt|ckpt|gguf|onnx)$/i.test(v)) {
        names.add(v)
      }
    }
  }
  return [...names]
}

describe('LTX23_ASSETS', () => {
  it('covers every model file the LTX23 workflow references', () => {
    const known = new Set(LTX23_ASSETS.map((a) => a.name))
    const missing = workflowModelFilenames().filter((n) => !known.has(n))
    expect(missing).toEqual([])
  })

  it('targets only valid ComfyUI model subfolders', () => {
    const valid = new Set(['checkpoints', 'loras', 'vae', 'text_encoders', 'latent_upscale_models', 'diffusion_models', 'upscale_models'])
    for (const a of LTX23_ASSETS) expect(valid.has(a.folder)).toBe(true)
  })

  it('only ever points downloads at huggingface https URLs', () => {
    for (const a of LTX23_ASSETS) {
      if (a.url) expect(a.url).toMatch(/^https:\/\/huggingface\.co\//)
    }
  })
})

describe('ltxAssetInstalled', () => {
  it('matches an exact available name', () => {
    expect(ltxAssetInstalled('a.safetensors', new Set(['a.safetensors']))).toBe(true)
  })

  it('matches when ComfyUI lists the file under a subfolder', () => {
    expect(ltxAssetInstalled('a.safetensors', new Set(['sub/a.safetensors']))).toBe(true)
  })

  it('is false when absent', () => {
    expect(ltxAssetInstalled('a.safetensors', new Set(['b.safetensors']))).toBe(false)
  })
})
