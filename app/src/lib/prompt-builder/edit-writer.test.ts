import { describe, it, expect } from 'vitest'
import { buildEditMessages, editRows } from './edit-writer'

describe('buildEditMessages', () => {
  it('writes a per-kind system prompt', () => {
    expect(buildEditMessages('vfx', 'make her jacket red', '')[0].content).toMatch(/keep/i)
    expect(buildEditMessages('style', 'anime', '')[0].content).toContain('Transform this video into')
    expect(buildEditMessages('head', 'older', '')[0].content).toMatch(/face/i)
  })
  it('ends in English and carries the frame only when given', () => {
    const m = buildEditMessages('vfx', 'x', '', 'AAAA')
    expect(m.at(-1)).toMatchObject({ role: 'user', images: ['AAAA'] })
    expect(m.at(-1)!.content.endsWith('Answer in English.')).toBe(true)
    expect(buildEditMessages('vfx', 'x', '').at(-1)!.images).toBeUndefined()
  })
})

describe('editRows', () => {
  it('rewrites vfx picks to clauses', () => {
    const rows = editRows('vfx')
    expect(rows.map((r) => r.id)).toEqual(['wear', 'haircolor', 'where', 'time'])
    const leather = rows[0].picks.find((p) => p.id === 'leather')!
    expect(leather.sentence).toMatch(/^Change the clothes so the person is /)
    expect(rows[1].picks.find((p) => p.id === 'blonde')!.sentence).toBe('Give the person blonde hair')
    expect(rows[2].picks.find((p) => p.id === 'beach')!.sentence).toBe('Place the scene on a sunny beach')
    expect(rows[3].picks.find((p) => p.id === 'sunset')!.sentence).toBe('Set the scene at sunset')
  })
  it('offers style and head rows', () => {
    expect(editRows('style').map((r) => r.id)).toEqual(['look'])
    expect(editRows('style')[0].picks.find((p) => p.id === 'photo')!.sentence).toMatch(/^Transform this video into /)
    expect(editRows('head').map((r) => r.id)).toEqual(['hair', 'haircolor', 'age', 'faceshape', 'eyes'])
  })
  it('keeps the new head picks adult and sentence-bearing', () => {
    for (const r of editRows('head').slice(2)) for (const p of r.picks) {
      expect(p.sentence).toBeTruthy()
      expect(p.sentence).not.toMatch(/child|teen|kid|young girl/i)
    }
  })
})
