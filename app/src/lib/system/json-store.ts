import fs from 'fs'
import path from 'path'
import { getDataDir } from './paths'

/** Reads <dataDir>/<file>; returns `fallback` if it is missing or unparseable. */
export function readJson<T>(file: string, fallback: T): T {
  try {
    const raw = fs.readFileSync(path.join(getDataDir(), file), 'utf8')
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

/** Atomically writes <dataDir>/<file> (temp file + rename). Creates the dir. */
export function writeJson(file: string, data: unknown): void {
  const dir = getDataDir()
  fs.mkdirSync(dir, { recursive: true })
  const target = path.join(dir, file)
  const tmp = `${target}.${process.pid}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8')
  fs.renameSync(tmp, target)
}
