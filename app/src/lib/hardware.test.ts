import { describe, expect, it } from 'vitest'
import { detectHardware } from './hardware'

const stats = (vramBytes: number) => async () =>
  new Response(JSON.stringify({ devices: [{ name: 'cuda:0 NVIDIA GeForce RTX 4060 Laptop GPU : cudaMallocAsync', vram_total: vramBytes }] }))

describe('detectHardware', () => {
  it('reports card, graphics memory and RAM', async () => {
    const hw = await detectHardware('http://x', '', {
      fetcher: stats(8 * 1024 ** 3) as unknown as typeof fetch,
      run: async () => '',
      totalMem: () => 16 * 1024 ** 3,
    })
    expect(hw).toEqual({ gpuName: 'NVIDIA GeForce RTX 4060 Laptop GPU', vramGb: 8, ramGb: 16, freeDiskGb: null })
  })
  it('says "unknown" rather than guessing when nothing answers', async () => {
    const hw = await detectHardware('http://x', '', {
      fetcher: (async () => { throw new Error('down') }) as unknown as typeof fetch,
      run: async () => '',
      totalMem: () => 32 * 1024 ** 3,
      timeoutMs: 50,
    })
    expect(hw.vramGb).toBeNull()
    expect(hw.gpuName).toBeNull()
    expect(hw.ramGb).toBe(32)
  })
})
