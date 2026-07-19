import { describe, it, expect } from 'vitest'
import { parseMonitor } from './system-monitor'

describe('parseMonitor', () => {
  it('reads cpu, ram and the first GPU vram from a crystools.monitor payload', () => {
    const stats = parseMonitor({
      cpu_utilization: 62.4,
      ram_used_percent: 48.9,
      gpus: [{ gpu_utilization: 30, vram_used_percent: 71.2 }],
    })
    expect(stats).toEqual({ cpu: 62, ram: 49, vram: 71 })
  })

  it('returns null vram when there is no GPU', () => {
    expect(parseMonitor({ cpu_utilization: 10, ram_used_percent: 20, gpus: [] }))
      .toEqual({ cpu: 10, ram: 20, vram: null })
    expect(parseMonitor({ cpu_utilization: 10, ram_used_percent: 20 }))
      .toEqual({ cpu: 10, ram: 20, vram: null })
  })

  it('treats the -1 unavailable sentinel as null', () => {
    expect(parseMonitor({ cpu_utilization: -1, ram_used_percent: 20, gpus: [{ vram_used_percent: -1 }] }))
      .toEqual({ cpu: null, ram: 20, vram: null })
  })

  it('clamps above 100 and rejects non-numeric values', () => {
    expect(parseMonitor({ cpu_utilization: 140, ram_used_percent: 'x', gpus: [{ vram_used_percent: NaN }] }))
      .toEqual({ cpu: 100, ram: null, vram: null })
  })

  it('returns all null for a non-object payload', () => {
    expect(parseMonitor(undefined)).toEqual({ cpu: null, ram: null, vram: null })
    expect(parseMonitor('nope')).toEqual({ cpu: null, ram: null, vram: null })
  })
})
