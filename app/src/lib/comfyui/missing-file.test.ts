import { describe, expect, it } from 'vitest'
import { missingFiles, missingFilesMessage, nodeErrorsOf } from './missing-file'

const notInList = (input: string, value: unknown) => ({
  type: 'value_not_in_list', message: 'Value not in list',
  details: `${input}: '${value}' not in [...]`, extra_info: { input_name: input, received_value: value },
})

describe('missingFiles', () => {
  it('names a model file ComfyUI does not have', () => {
    expect(missingFiles({ 4: { class_type: 'UNETLoader', errors: [notInList('unet_name', 'krea2_turbo_fp8_scaled.safetensors')] } }))
      .toEqual(['krea2_turbo_fp8_scaled.safetensors'])
  })
  it('ignores a value that is not a file (an unknown sampler is not a missing download)', () => {
    expect(missingFiles({ 3: { class_type: 'KSampler', errors: [notInList('sampler_name', 'euler_x')] } })).toEqual([])
  })
  it('lists each file once, across nodes', () => {
    const e = notInList('lora_name', 'a.safetensors')
    expect(missingFiles({ 1: { errors: [e] }, 2: { errors: [e, notInList('vae_name', 'b.gguf')] } })).toEqual(['a.safetensors', 'b.gguf'])
  })
  it('is empty for no errors', () => {
    expect(missingFiles(undefined)).toEqual([])
  })
})

describe('missingFilesMessage', () => {
  it('says it plainly for one file', () => {
    expect(missingFilesMessage(['x.safetensors'])).toBe('"x.safetensors" isn\'t downloaded. Download it on the Models page, or open Start here.')
  })
  it('counts several files', () => {
    expect(missingFilesMessage(['a.safetensors', 'b.safetensors']))
      .toBe('2 model files aren\'t downloaded: a.safetensors, b.safetensors. Download them on the Models page, or open Start here.')
  })
})

describe('nodeErrorsOf', () => {
  it('reads node_errors out of ComfyUI\'s 400 body', () => {
    const body = JSON.stringify({ error: { type: 'prompt_outputs_failed_validation' }, node_errors: { 4: { errors: [] } } })
    expect(nodeErrorsOf(body)).toEqual({ 4: { errors: [] } })
  })
  it('is undefined for a body that is not JSON', () => {
    expect(nodeErrorsOf('Bad Gateway')).toBeUndefined()
  })
})
