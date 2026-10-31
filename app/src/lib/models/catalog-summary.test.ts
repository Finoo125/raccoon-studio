import { describe, expect, it } from 'vitest'
import { rowSummary } from './catalog-summary'

const f = (sizeMb: number, installed: boolean, optional = false) => ({ sizeMb, installed, optional })

describe('rowSummary', () => {
  it('ready when every required file is there, however many extras are missing', () => {
    const s = rowSummary([f(12500, true), f(5000, true), f(27, false, true), f(1, false, true)])
    expect(s).toMatchObject({ ready: true, missingOptional: 2, sizeIsDownload: false })
    expect(s.sizeMb).toBe(17500) // what is on disk — one number, not two
  })
  it('missing a required file: not ready, and the size is what Download fetches', () => {
    const s = rowSummary([f(12500, false), f(5000, true), f(27, false, true)])
    expect(s).toMatchObject({ ready: false, installedRequired: 1, required: 2, sizeIsDownload: true })
    expect(s.sizeMb).toBe(12500)
  })
  it('a missing required file without a download link still counts in the size (LTX imports two by hand)', () => {
    const s = rowSummary([f(900, false), f(100, true)])
    expect(s).toMatchObject({ ready: false, sizeIsDownload: true, sizeMb: 900 })
  })
  it('a row of extras only (style LoRAs) is ready once any is there, and never "half installed"', () => {
    expect(rowSummary([f(448, true, true), f(436, false, true)]).ready).toBe(true)
    expect(rowSummary([f(448, false, true), f(436, false, true)]).ready).toBe(false)
  })
  it('Download fetches only the missing required files the size shows; the extras wait for "Get N extras"', () => {
    // H3 for a Hybrid-only user: one required checkpoint missing, 100+ GB of extras missing too
    expect(rowSummary([f(21000, false), f(15700, true), f(40000, false, true), f(21000, false, true)]).fetch).toEqual([0])
    expect(rowSummary([f(21000, true), f(15700, true), f(40000, false, true), f(21000, false, true)]).fetch).toEqual([2, 3])
  })
  it('an extras-only row fetches every missing file, and nothing without a link', () => {
    expect(rowSummary([f(448, false, true), f(436, false, true)]).fetch).toEqual([0, 1])
    expect(rowSummary([{ ...f(900, false), downloadable: false }, f(100, false)]).fetch).toEqual([1])
  })
})
