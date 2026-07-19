import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

let tmp: string

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'director-runs-'))
  process.env.DIRECTOR_PROJECTS_DIR = tmp
})

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true })
  delete process.env.DIRECTOR_PROJECTS_DIR
})

// Import AFTER env is set so the module reads the override lazily.
async function mod() {
  return import('./runs')
}

describe('runs persistence', () => {
  it('rejects path-like ids before they reach a filesystem path', async () => {
    const { runDir, deleteRun } = await mod()
    expect(() => runDir('..')).toThrow(/invalid run id/i)
    expect(() => runDir('../../etc')).toThrow(/invalid run id/i)
    expect(() => deleteRun('..')).toThrow(/invalid run id/i)
    expect(() => runDir('0f8b7c1a-1111-2222-3333-444455556666')).not.toThrow()
  })

  it('creates, loads, lists and deletes a run', async () => {
    const { createRun, loadRun, listRuns, deleteRun } = await mod()
    const run = createRun({
      name: 'Film A', plot: 'p', imageModel: 'anima', ollamaModel: 'm', targetSeconds: 60,
    })
    expect(loadRun(run.id)?.name).toBe('Film A')

    const summaries = listRuns()
    expect(summaries).toHaveLength(1)
    expect(summaries[0]).toMatchObject({
      id: run.id, name: 'Film A', status: 'draft', beatCount: 4,
    })

    deleteRun(run.id)
    expect(loadRun(run.id)).toBeNull()
    expect(listRuns()).toHaveLength(0)
  })

  it('saveRun bumps modifiedAt and persists changes', async () => {
    const { createRun, saveRun, loadRun } = await mod()
    const run = createRun({
      name: 'B', plot: 'p', imageModel: 'anima', ollamaModel: 'm', targetSeconds: 60,
    })
    const saved = saveRun({ ...run, name: 'B2' })
    expect(saved.name).toBe('B2')
    expect(saved.modifiedAt >= run.modifiedAt).toBe(true)
    expect(loadRun(run.id)?.name).toBe('B2')
  })

  it('listRuns returns [] when the dir is missing and loadRun returns null for unknown id', async () => {
    const { listRuns, loadRun } = await mod()
    expect(listRuns()).toEqual([])
    expect(loadRun('nope')).toBeNull()
  })
})

describe('rev bump', () => {
  it('saveRun increments rev on every persist', async () => {
    const { createRun, saveRun, loadRun } = await mod()
    const run = createRun({ name: 'R', plot: 'p', imageModel: 'anima', ollamaModel: 'm', targetSeconds: 60 })
    // createRun persists once: createRunDoc rev 0 -> saveRun -> rev 1.
    expect(run.rev).toBe(1)
    const again = saveRun(run)
    expect(again.rev).toBe(2)
    expect(loadRun(run.id)?.rev).toBe(2)
  })
})
