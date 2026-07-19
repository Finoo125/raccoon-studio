import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { readPresets, upsertPreset, deletePreset, readWildcards, putWildcard, deleteWildcard } from './store'

let tmp: string
beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'raccoon-prompts-')); process.env.RACCOON_DATA_DIR = tmp })
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); delete process.env.RACCOON_DATA_DIR })

describe('prompt presets store', () => {
  it('adds a preset with a generated id, then replaces by id', () => {
    const after = upsertPreset({ name: 'Hero', prompt: 'a knight', negative: 'blurry' })
    expect(after).toHaveLength(1)
    const id = after[0].id
    const after2 = upsertPreset({ id, name: 'Hero', prompt: 'a paladin' })
    expect(after2).toHaveLength(1)
    expect(after2[0].prompt).toBe('a paladin')
  })
  it('deletes a preset by id', () => {
    const list = upsertPreset({ name: 'A', prompt: 'x' })
    expect(deletePreset(list[0].id)).toEqual([])
  })
  it('readPresets returns [] on a fresh dir', () => {
    expect(readPresets()).toEqual([])
  })
})

describe('wildcard lists store', () => {
  it('puts and reads a named list', () => {
    putWildcard('colors', ['red', 'blue'])
    expect(readWildcards()).toEqual({ colors: ['red', 'blue'] })
  })
  it('replaces an existing list and deletes by name', () => {
    putWildcard('colors', ['red'])
    putWildcard('colors', ['green'])
    expect(readWildcards().colors).toEqual(['green'])
    expect(deleteWildcard('colors')).toEqual({})
  })
})
