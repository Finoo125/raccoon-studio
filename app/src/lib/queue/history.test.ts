import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { appendHistory, readHistory, removeHistory, clearCompletedHistory, type JobRecord } from './history'

const rec = (id: string): JobRecord => ({
  id, promptId: 'p-' + id, kind: 'image', workflowId: 'zit', workflowName: 'Z',
  prompt: 'x', generationParams: { seed: 1 }, status: 'done', createdAt: Number(id), outputImages: [],
})

let tmp: string
beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'raccoon-hist-')); process.env.RACCOON_DATA_DIR = tmp })
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); delete process.env.RACCOON_DATA_DIR })

describe('queue history', () => {
  it('appends newest-first', () => {
    appendHistory(rec('1'))
    const list = appendHistory(rec('2'))
    expect(list.map((r) => r.id)).toEqual(['2', '1'])
  })

  it('dedupes by id (re-append replaces, stays newest-first)', () => {
    appendHistory(rec('1'))
    const list = appendHistory(rec('1'))
    expect(list.filter((r) => r.id === '1')).toHaveLength(1)
  })

  it('caps at 200, trimming oldest', () => {
    for (let i = 0; i < 205; i++) appendHistory(rec(String(i)))
    const list = readHistory()
    expect(list).toHaveLength(200)
    expect(list[0].id).toBe('204')
    expect(list.some((r) => r.id === '0')).toBe(false)
  })

  it('removeHistory drops by id', () => {
    appendHistory(rec('1')); appendHistory(rec('2'))
    expect(removeHistory('1').map((r) => r.id)).toEqual(['2'])
  })

  it('clearCompletedHistory empties the list', () => {
    appendHistory(rec('1'))
    expect(clearCompletedHistory()).toEqual([])
  })
})
