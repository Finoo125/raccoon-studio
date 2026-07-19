import { describe, it, expect } from 'vitest'
import type { MovieProject } from '@/types/movie'
import { buildExportArgs } from './export-graph'

function project(overrides: Partial<MovieProject> = {}): MovieProject {
  return {
    id: 'p1', name: 'Test', createdAt: '', modifiedAt: '',
    settings: { width: 1280, height: 720, fps: 24 },
    assets: [
      { id: 'v1', kind: 'video', source: 'gallery', path: '/x/a.mp4', filename: 'a.mp4', durationSec: 10, hasAudio: true },
      { id: 'v2', kind: 'video', source: 'gallery', path: '/x/b.mp4', filename: 'b.mp4', durationSec: 10, hasAudio: false },
      { id: 'm1', kind: 'audio', source: 'imported', path: '/x/m.mp3', filename: 'm.mp3', durationSec: 60, hasAudio: true },
      { id: 'i1', kind: 'image', source: 'imported', path: '/x/i.png', filename: 'i.png', durationSec: 0, hasAudio: false },
    ],
    tracks: [
      { id: 'tv1', kind: 'video', clips: [] },
      { id: 'tv2', kind: 'video', clips: [] },
      { id: 'ta1', kind: 'audio', clips: [] },
    ],
    ...overrides,
  }
}

const fc = (args: string[]) => args[args.indexOf('-filter_complex') + 1]

describe('buildExportArgs', () => {
  it('throws on an empty timeline', () => {
    expect(() => buildExportArgs(project(), project().settings, '/tmp/out.mp4')).toThrow()
  })

  it('builds a single-clip export', () => {
    const p = project()
    p.tracks[0].clips = [{ id: 'c1', assetId: 'v1', startSec: 0, inSec: 1, outSec: 4, volume: 1 }]
    const { args, durationSec } = buildExportArgs(p, p.settings, '/tmp/out.mp4')
    expect(durationSec).toBe(3)
    expect(args).toContain('/x/a.mp4')
    expect(fc(args)).toContain('trim=1.000:4.000')
    expect(fc(args)).toContain('scale=1280:720')
    expect(args[args.length - 1]).toBe('/tmp/out.mp4')
  })

  it('inserts black for gaps and concats', () => {
    const p = project()
    p.tracks[0].clips = [
      { id: 'c1', assetId: 'v1', startSec: 0, inSec: 0, outSec: 2, volume: 1 },
      { id: 'c2', assetId: 'v2', startSec: 5, inSec: 0, outSec: 2, volume: 1 },
    ]
    const f = fc(buildExportArgs(p, p.settings, '/tmp/o.mp4').args)
    expect(f).toContain('color=c=black:s=1280x720:r=24:d=3.000')
    expect(f).toContain('concat=n=2:v=1:a=0')
  })

  it('uses xfade for crossfaded clips with the timeline offset', () => {
    const p = project()
    p.tracks[0].clips = [
      { id: 'c1', assetId: 'v1', startSec: 0, inSec: 0, outSec: 5, volume: 1 },
      { id: 'c2', assetId: 'v2', startSec: 4, inSec: 0, outSec: 5, volume: 1, crossfadeWithPrevious: 1 },
    ]
    const built = buildExportArgs(p, p.settings, '/tmp/o.mp4')
    expect(built.durationSec).toBe(9)
    expect(fc(built.args)).toContain('xfade=transition=fade:duration=1.000:offset=4.000')
  })

  it('overlays upper video tracks with enable windows', () => {
    const p = project()
    p.tracks[0].clips = [{ id: 'c1', assetId: 'v1', startSec: 0, inSec: 0, outSec: 8, volume: 1 }]
    p.tracks[1].clips = [{ id: 'c2', assetId: 'v2', startSec: 2, inSec: 0, outSec: 5, volume: 1 }]
    const f = fc(buildExportArgs(p, p.settings, '/tmp/o.mp4').args)
    expect(f).toContain("overlay=enable='between(t,2.000,7.000)'")
  })

  it('mixes clip audio and music with volume and delay', () => {
    const p = project()
    p.tracks[0].clips = [{ id: 'c1', assetId: 'v1', startSec: 0, inSec: 0, outSec: 5, volume: 0.5 }]
    p.tracks[2].clips = [{ id: 'c3', assetId: 'm1', startSec: 1, inSec: 0, outSec: 4, volume: 1 }]
    const f = fc(buildExportArgs(p, p.settings, '/tmp/o.mp4').args)
    expect(f).toContain('volume=0.500')
    expect(f).toContain('adelay=1000:all=1')
    expect(f).toContain('amix=inputs=2')
  })

  it('falls back to silence when nothing is audible', () => {
    const p = project()
    p.tracks[0].clips = [{ id: 'c1', assetId: 'v2', startSec: 0, inSec: 0, outSec: 5, volume: 1 }]
    expect(fc(buildExportArgs(p, p.settings, '/tmp/o.mp4').args)).toContain('anullsrc')
  })

  it('loops still images for the clip duration and skips offline assets', () => {
    const p = project()
    p.assets[0].offline = true
    p.tracks[0].clips = [
      { id: 'c1', assetId: 'v1', startSec: 0, inSec: 0, outSec: 5, volume: 1 },
      { id: 'c2', assetId: 'i1', startSec: 5, inSec: 0, outSec: 3, volume: 1 },
    ]
    const { args } = buildExportArgs(p, p.settings, '/tmp/o.mp4')
    expect(args).not.toContain('/x/a.mp4')
    expect(args.join(' ')).toContain('-loop 1 -t 3.000 -i /x/i.png')
  })
})
