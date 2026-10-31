import { describe, it, expect } from 'vitest'
import { parseProbe } from './ffprobe'

describe('parseProbe', () => {
  const portrait = {
    format: { duration: '5.200000' },
    streams: [
      { codec_type: 'video', width: 1920, height: 1080, duration: '5.166667', side_data_list: [{ side_data_type: 'Display Matrix', rotation: -90 }] },
      { codec_type: 'audio', duration: '5.200000' },
    ],
  }
  it('reads the display rotation off the Display Matrix', () => {
    expect(parseProbe(portrait).rotation).toBe(-90)
  })
  it('reads the legacy rotate tag too', () => {
    expect(parseProbe({ streams: [{ codec_type: 'video', width: 1920, height: 1080, tags: { rotate: '90' } }] }).rotation).toBe(90)
  })
  it("keeps the video stream's own duration beside the container's", () => {
    const p = parseProbe(portrait)
    expect(p.durationSec).toBeCloseTo(5.2, 6)        // container: audio overhang included
    expect(p.videoDurationSec).toBeCloseTo(5.166667, 6)
  })
  it('reports no rotation and the container duration when the stream has neither', () => {
    const p = parseProbe({ format: { duration: '4' }, streams: [{ codec_type: 'video', width: 10, height: 20 }] })
    expect(p.rotation).toBe(0)
    expect(p.videoDurationSec).toBe(4)
  })
})
