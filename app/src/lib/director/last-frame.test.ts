import { describe, it, expect } from 'vitest'
import { buildLastFrameArgs } from './last-frame'

describe('buildLastFrameArgs', () => {
  it('grabs a single frame near the end of the clip, overwriting the output', () => {
    const args = buildLastFrameArgs('/out/clip.mp4', '/assets/last.png')
    expect(args).toEqual([
      '-y',
      '-sseof', '-0.2',
      '-i', '/out/clip.mp4',
      '-frames:v', '1',
      '-update', '1',
      '/assets/last.png',
    ])
  })
})
