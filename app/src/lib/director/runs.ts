import fs from 'fs'
import path from 'path'
import type { DirectorRun, DirectorRunSummary } from '@/types/director'
import { createRunDoc, type CreateRunInput } from './run-doc'

function baseDir(): string {
  return process.env.DIRECTOR_PROJECTS_DIR ?? path.join(process.cwd(), 'projects', 'director')
}

export function runDir(id: string): string {
  // IDs are UUIDs. Anything path-like (`..`, separators, drive letters) must
  // never reach the join below — deleteRun rm -rf's this directory.
  if (!/^[\w-]+$/.test(id)) throw new Error(`Invalid run id: ${id}`)
  return path.join(baseDir(), id)
}

export function assetsDir(id: string): string {
  return path.join(runDir(id), 'assets')
}

const runFile = (id: string) => path.join(runDir(id), 'run.json')

export function listRuns(): DirectorRunSummary[] {
  let dirs: string[]
  try {
    dirs = fs.readdirSync(baseDir())
  } catch {
    return []
  }
  const out: DirectorRunSummary[] = []
  for (const dir of dirs) {
    try {
      const r = JSON.parse(fs.readFileSync(runFile(dir), 'utf8')) as DirectorRun
      out.push({
        id: r.id,
        name: r.name,
        status: r.status,
        createdAt: r.createdAt,
        modifiedAt: r.modifiedAt,
        beatCount: r.beatCount,
      })
    } catch {
      /* skip broken dirs */
    }
  }
  return out.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt))
}

export function createRun(input: CreateRunInput): DirectorRun {
  const run = createRunDoc(input)
  fs.mkdirSync(assetsDir(run.id), { recursive: true })
  return saveRun(run)
}

export function loadRun(id: string): DirectorRun | null {
  try {
    return JSON.parse(fs.readFileSync(runFile(id), 'utf8')) as DirectorRun
  } catch {
    return null
  }
}

export function saveRun(run: DirectorRun): DirectorRun {
  const saved = { ...run, modifiedAt: new Date().toISOString(), rev: (run.rev ?? 0) + 1 }
  fs.mkdirSync(runDir(run.id), { recursive: true })
  fs.writeFileSync(runFile(run.id), JSON.stringify(saved, null, 2))
  return saved
}

export function deleteRun(id: string): void {
  fs.rmSync(runDir(id), { recursive: true, force: true })
}
