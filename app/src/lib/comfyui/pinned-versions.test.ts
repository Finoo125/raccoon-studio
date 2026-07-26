import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import os from 'os'
import path from 'path'
import fs from 'fs'
import { parsePins, readPins, pinDir } from './pinned-versions'

const A = 'a'.repeat(40)
const B = 'b'.repeat(40)

describe('parsePins', () => {
  it('reads name/sha pairs and ignores comments and blank lines', () => {
    expect(parsePins(`# header\n\nComfyUI ${A}\n\n# section\nrgthree-comfy ${B}\n`)).toEqual([
      { name: 'ComfyUI', sha: A },
      { name: 'rgthree-comfy', sha: B },
    ])
  })

  it('tolerates CRLF — a trailing \\r on the sha makes every checkout match nothing', () => {
    expect(parsePins(`# comment\r\nComfyUI ${A}\r\n\r\n`)).toEqual([{ name: 'ComfyUI', sha: A }])
  })

  it('skips a name with no sha (unpinned: installers follow the default branch)', () => {
    expect(parsePins(`ComfyUI ${A}\nnot-pinned\n`)).toEqual([{ name: 'ComfyUI', sha: A }])
  })

  it('rejects anything that is not a full 40-char hex sha', () => {
    // A short sha would be taken as a prefix and quietly defeat the pin; a
    // leading dash would reach git as a flag.
    expect(parsePins(`short abc123\nupper ${'A'.repeat(40)}\nflag --upload-pack=x\nlong ${A}a\n`)).toEqual([])
  })

  it('ignores extra columns after the sha', () => {
    expect(parsePins(`ComfyUI ${A} trailing note\n`)).toEqual([{ name: 'ComfyUI', sha: A }])
  })
})

describe('pinDir', () => {
  it('maps ComfyUI to the install root and everything else under custom_nodes', () => {
    expect(pinDir('ComfyUI', '/comfy')).toBe('/comfy')
    expect(pinDir('rgthree-comfy', '/comfy')).toBe(path.join('/comfy', 'custom_nodes', 'rgthree-comfy'))
  })
})

describe('readPins', () => {
  const root = path.join(os.tmpdir(), `raccoon-test-pins-${process.pid}`)

  beforeAll(() => {
    fs.mkdirSync(path.join(root, 'installer'), { recursive: true })
    fs.writeFileSync(path.join(root, 'installer', 'pinned-versions.txt'), `ComfyUI ${A}\n`, 'utf8')
  })
  afterAll(() => fs.rmSync(root, { recursive: true, force: true }))

  it('reads the manifest from a project root', () => {
    expect(readPins(root)).toEqual([{ name: 'ComfyUI', sha: A }])
  })

  it('returns no pins when the manifest is missing rather than throwing', () => {
    expect(readPins(path.join(root, 'nope'))).toEqual([])
  })
})

describe('the shipped manifest', () => {
  // Guards the real file the installers and the repair button both read.
  const pins = readPins(path.resolve(process.cwd(), '..'))

  it('parses, and pins ComfyUI itself', () => {
    expect(pins.length).toBeGreaterThan(5)
    expect(pins.find((p) => p.name === 'ComfyUI')?.sha).toMatch(/^[0-9a-f]{40}$/)
  })

  it('has no duplicate names', () => {
    const names = pins.map((p) => p.name)
    expect(names).toEqual([...new Set(names)])
  })
})
