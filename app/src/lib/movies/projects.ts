import fs from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'
import type { MovieProject, MovieProjectSummary } from '@/types/movie'

export const PROJECTS_DIR = path.join(process.cwd(), 'projects', 'movies')

export function projectDir(id: string): string {
  // IDs are UUIDs. Anything path-like (`..`, separators, drive letters) must
  // never reach the join below — deleteProject rm -rf's this directory.
  if (!/^[\w-]+$/.test(id)) throw new Error(`Invalid project id: ${id}`)
  return path.join(PROJECTS_DIR, id)
}

export function assetsDir(id: string): string {
  return path.join(projectDir(id), 'assets')
}

const projectFile = (id: string) => path.join(projectDir(id), 'project.json')

export function listProjects(): MovieProjectSummary[] {
  let dirs: string[]
  try {
    dirs = fs.readdirSync(PROJECTS_DIR)
  } catch {
    return []
  }
  const out: MovieProjectSummary[] = []
  for (const dir of dirs) {
    try {
      const p = JSON.parse(fs.readFileSync(projectFile(dir), 'utf8')) as MovieProject
      out.push({ id: p.id, name: p.name, createdAt: p.createdAt, modifiedAt: p.modifiedAt })
    } catch { /* skip broken dirs */ }
  }
  return out.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt))
}

export function createProject(name: string): MovieProject {
  const id = randomUUID()
  const now = new Date().toISOString()
  const project: MovieProject = {
    id,
    name: name.trim() || 'Untitled movie',
    createdAt: now,
    modifiedAt: now,
    settings: { width: 1280, height: 720, fps: 24 },
    assets: [],
    tracks: [
      { id: randomUUID(), kind: 'video', clips: [] }, // V1 (bottom)
      { id: randomUUID(), kind: 'video', clips: [] }, // V2 (top)
      { id: randomUUID(), kind: 'audio', clips: [] }, // A1
    ],
  }
  fs.mkdirSync(assetsDir(id), { recursive: true })
  saveProject(project)
  return project
}

/** Loads a project and flags assets whose files vanished as offline. */
export function loadProject(id: string): MovieProject | null {
  try {
    const project = JSON.parse(fs.readFileSync(projectFile(id), 'utf8')) as MovieProject
    project.assets = project.assets.map((a) => ({ ...a, offline: !fs.existsSync(a.path) }))
    return project
  } catch {
    return null
  }
}

export function saveProject(project: MovieProject): MovieProject {
  const saved = { ...project, modifiedAt: new Date().toISOString() }
  fs.mkdirSync(projectDir(project.id), { recursive: true })
  fs.writeFileSync(projectFile(project.id), JSON.stringify(saved, null, 2))
  return saved
}

export function deleteProject(id: string): void {
  fs.rmSync(projectDir(id), { recursive: true, force: true })
}
