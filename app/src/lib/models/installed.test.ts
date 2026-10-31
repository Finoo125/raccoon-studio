import { describe, it, expect } from 'vitest'
import { comboOptions, selectionIsStale, presetAvailable, fileInstalled, withoutPresetModels } from './installed'
import { QWEN21_BASE_UNET, QWEN21_TURBO_UNET } from '../workflows/qwen21'
import { workflows } from '../workflows'

const ckpt = (names: string[]) => ({ CheckpointLoaderSimple: { input: { required: { ckpt_name: [names] } } } })
const unet = (names: string[]) => ({ UNETLoader: { input: { required: { unet_name: [names] } } } })

describe('comboOptions', () => {
  it('reads the classic [[...names], config] shape', () => {
    const data = { VAELoader: { input: { required: { vae_name: [['ae.safetensors'], {}] } } } }
    expect(comboOptions(data, 'VAELoader', 'vae_name')).toEqual(['ae.safetensors'])
  })

  // Verbatim from a live ComfyUI /object_info/LatentUpscaleModelLoader. Reading
  // [0] here gives the string 'COMBO', which spread into a Set becomes C,O,M,B —
  // so a file sitting in models/latent_upscale_models/ read as missing forever.
  it('reads the new schema API ["COMBO", { options }] shape', () => {
    const data = {
      LatentUpscaleModelLoader: {
        input: { required: { model_name: ['COMBO', { options: ['ltx-2.3-spatial-upscaler-x2-1.1.safetensors'] }] } },
      },
    }
    expect(comboOptions(data, 'LatentUpscaleModelLoader', 'model_name')).toEqual([
      'ltx-2.3-spatial-upscaler-x2-1.1.safetensors',
    ])
  })

  it('is an empty list for a missing node, field, or error body', () => {
    expect(comboOptions({}, 'LatentUpscaleModelLoader', 'model_name')).toEqual([])
    expect(comboOptions({ error: 'ComfyUI unreachable' }, 'VAELoader', 'vae_name')).toEqual([])
    expect(comboOptions(null, 'VAELoader', 'vae_name')).toEqual([])
    expect(comboOptions({ VAELoader: { input: { required: {} } } }, 'VAELoader', 'vae_name')).toEqual([])
  })

  it('is an empty list when the new shape carries no options', () => {
    const data = { UpscaleModelLoader: { input: { required: { model_name: ['COMBO', {}] } } } }
    expect(comboOptions(data, 'UpscaleModelLoader', 'model_name')).toEqual([])
  })
})

describe('fileInstalled', () => {
  it('matches a bare name and one under a subfolder, either separator', () => {
    expect(fileInstalled('a.safetensors', ['a.safetensors'])).toBe(true)
    expect(fileInstalled('a.safetensors', ['sdxl/a.safetensors'])).toBe(true)
    expect(fileInstalled('a.safetensors', ['sdxl\\a.safetensors'])).toBe(true)
  })

  it('does not match a name that merely ends the same way', () => {
    expect(fileInstalled('a.safetensors', ['xa.safetensors'])).toBe(false)
  })
})

describe('presetAvailable', () => {
  const base = 'krea2_turbo_fp8_scaled.safetensors'

  it('is true once the preset\'s own model is on disk', () => {
    expect(presetAvailable(base, ['diffusion_models/' + base], [], true)).toBe(true)
  })

  it('is true on an Aria model alone — the form can swap the loader to it', () => {
    expect(presetAvailable(base, ['other.safetensors'], ['aria-v2.safetensors'], true)).toBe(true)
  })

  it('is false when neither is installed', () => {
    expect(presetAvailable(base, ['other.safetensors'], [], true)).toBe(false)
  })

  // The cold-start / offline case: empty lists mean "ComfyUI hasn't answered",
  // not "nothing installed". Greying every preset out then looks like a broken
  // install and leaves the user nothing to click.
  it('is true for everything until ComfyUI has answered', () => {
    expect(presetAvailable(base, [], [], false)).toBe(true)
  })

  it('every shipped preset declares the model its graph actually loads', () => {
    for (const w of workflows) {
      expect(w.baseModel, w.id).toMatch(/\.safetensors$/)
      // A preset whose own model is present must read as available, or the
      // button greys out on a perfectly good install.
      expect(presetAvailable(w.baseModel, [w.baseModel], [], true), w.id).toBe(true)
    }
  })
})

describe('withoutPresetModels', () => {
  const presetModels = workflows.map((w) => w.baseModel)

  // A base-only Qwen install lit up the Turbo button and the form fell back to
  // the base model — which then ran on the Turbo's 6 distilled sigmas.
  it("drops a sibling preset's own model, so it neither enables nor stands in for another preset", () => {
    const family = withoutPresetModels(['QWEN21/' + QWEN21_BASE_UNET, 'aria-qwen.safetensors'], presetModels)
    expect(family).toEqual(['aria-qwen.safetensors'])
    expect(presetAvailable(QWEN21_TURBO_UNET, [QWEN21_BASE_UNET], withoutPresetModels([QWEN21_BASE_UNET], presetModels), true)).toBe(false)
  })
})

describe('selectionIsStale', () => {
  it('is false for a name still on offer', () => {
    expect(selectionIsStale('here.safetensors', ['here.safetensors'], true)).toBe(false)
  })

  it('is true for a name the list no longer has', () => {
    expect(selectionIsStale('gone.safetensors', ['here.safetensors'], true)).toBe(true)
  })

  it('is true when the list loaded genuinely empty — the reinstall case', () => {
    // The trap: an install with zero LoRAs / zero face models reports [], and a
    // name remembered from a previous install would otherwise sail through and
    // take the whole prompt down with value_not_in_list.
    expect(selectionIsStale('gone.safetensors', [], true)).toBe(true)
  })

  it('is false while the list has not loaded, so an offline ComfyUI wipes nothing', () => {
    expect(selectionIsStale('here.safetensors', [], false)).toBe(false)
    expect(selectionIsStale('here.safetensors', ['here.safetensors'], false)).toBe(false)
  })

  it('is false when nothing is selected', () => {
    expect(selectionIsStale(undefined, ['here.safetensors'], true)).toBe(false)
    expect(selectionIsStale('', [], true)).toBe(false)
  })
})

describe('comboOptions — optional inputs', () => {
  // RaccoonVideoFaceSwap.swap_model is optional (the builder omits it so it can
  // never name a file that is not on disk), and reading only `required` left
  // every picker of it empty with no error anywhere.
  const node = 'RaccoonVideoFaceSwap'

  it('reads a combo declared optional', () => {
    const data = { [node]: { input: { optional: { swap_model: [['a.onnx', 'b.onnx']] } } } }
    expect(comboOptions(data, node, 'swap_model')).toEqual(['a.onnx', 'b.onnx'])
  })

  it('still prefers required when a field somehow appears in both', () => {
    const data = {
      [node]: {
        input: { required: { m: [['req']] }, optional: { m: [['opt']] } },
      },
    }
    expect(comboOptions(data, node, 'm')).toEqual(['req'])
  })

  it('handles the new schema form in optional too', () => {
    const data = { [node]: { input: { optional: { m: ['COMBO', { options: ['x'] }] } } } }
    expect(comboOptions(data, node, 'm')).toEqual(['x'])
  })

  it('returns empty for a field in neither', () => {
    expect(comboOptions({ [node]: { input: { required: {} } } }, node, 'nope')).toEqual([])
  })
})
