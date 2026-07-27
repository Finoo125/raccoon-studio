import { describe, it, expect } from 'vitest'
import { loraIsMissing } from './lora-family'

describe('loraIsMissing', () => {
  it('flags a selection ComfyUI no longer lists', () => {
    expect(loraIsMissing('gone.safetensors', ['here.safetensors'])).toBe(true)
  })

  it('keeps a selection that is still installed', () => {
    expect(loraIsMissing('here.safetensors', ['here.safetensors'])).toBe(false)
  })

  it('reports nothing missing while the list is unavailable', () => {
    // Empty means ComfyUI is unreachable, not that every LoRA was uninstalled —
    // clearing here would wipe the form every time the backend hiccups.
    expect(loraIsMissing('here.safetensors', [])).toBe(false)
    expect(loraIsMissing('', ['here.safetensors'])).toBe(false)
  })
})
