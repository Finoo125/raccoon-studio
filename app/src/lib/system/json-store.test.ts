import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { readJson, writeJson } from './json-store'

let tmp: string
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'raccoon-data-'))
  process.env.RACCOON_DATA_DIR = tmp
})
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true })
  delete process.env.RACCOON_DATA_DIR
})

describe('json-store', () => {
  it('readJson returns the fallback when the file is missing', () => {
    expect(readJson('missing.json', { a: 1 })).toEqual({ a: 1 })
  })

  it('readJson returns the fallback when the file is corrupt', () => {
    fs.writeFileSync(path.join(tmp, 'bad.json'), '{not json')
    expect(readJson('bad.json', { ok: true })).toEqual({ ok: true })
  })

  it('writeJson then readJson round-trips an object', () => {
    writeJson('s.json', { name: 'r', n: 2 })
    expect(readJson('s.json', {})).toEqual({ name: 'r', n: 2 })
  })

  it('writeJson is atomic and leaves no .tmp file', () => {
    writeJson('s.json', { v: 1 })
    writeJson('s.json', { v: 2 })
    expect(readJson('s.json', {})).toEqual({ v: 2 })
    expect(fs.readdirSync(tmp).some((f) => f.endsWith('.tmp'))).toBe(false)
  })
})
