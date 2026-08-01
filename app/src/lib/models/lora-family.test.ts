import { describe, it, expect } from 'vitest'
import { loraIsMissing } from './lora-family'

describe('loraIsMissing', () => {
  it('flags a selection ComfyUI no longer lists', () => {
    expect(loraIsMissing('gone.safetensors', ['here.safetensors'], true)).toBe(true)
  })

  it('keeps a selection that is still installed', () => {
    expect(loraIsMissing('here.safetensors', ['here.safetensors'], true)).toBe(false)
  })

  it('reports nothing missing until the list has loaded', () => {
    // Not-yet-loaded means ComfyUI is unreachable or still answering, not that
    // every LoRA was uninstalled — clearing here would wipe the form every time
    // the backend hiccups.
    expect(loraIsMissing('here.safetensors', [], false)).toBe(false)
    expect(loraIsMissing('', ['here.safetensors'], true)).toBe(false)
  })

  it('flags a selection once the list has loaded genuinely empty', () => {
    // An install with zero LoRAs reports []. Inferring "not loaded" from that
    // stranded a name remembered from a previous install, and it broke every job.
    expect(loraIsMissing('gone.safetensors', [], true)).toBe(true)
  })
})
