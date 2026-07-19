import { execFile } from 'child_process'
import { promisify } from 'util'
import fs from 'fs'
import path from 'path'
import { getComfyUIDir, getUpdateCheck, setUpdateCheck } from './server-state'
import { log } from '@/lib/logging/logger'

const pExecFile = promisify(execFile)

// Re-check at most every 6 hours; detect() calls maybeRefreshUpdateCheck() on
// every poll, so this TTL is what actually rate-limits the git fetches.
const CHECK_TTL_MS = 6 * 3_600_000

/** ComfyUI core plus every git-cloned custom node (the repos cm-cli updates). */
export function gitRepos(dir: string): string[] {
  const repos: string[] = []
  if (fs.existsSync(path.join(dir, '.git'))) repos.push(dir)
  const nodesDir = path.join(dir, 'custom_nodes')
  try {
    for (const name of fs.readdirSync(nodesDir)) {
      const p = path.join(nodesDir, name)
      if (fs.existsSync(path.join(p, '.git'))) repos.push(p)
    }
  } catch {
    /* no custom_nodes dir */
  }
  return repos
}

async function repoBehindUpstream(repo: string): Promise<boolean> {
  try {
    await pExecFile('git', ['fetch', '--quiet'], { cwd: repo, timeout: 20_000 })
    const { stdout } = await pExecFile('git', ['rev-list', '--count', 'HEAD..@{upstream}'], {
      cwd: repo,
      timeout: 10_000,
    })
    return parseInt(stdout.trim(), 10) > 0
  } catch {
    // Offline, no upstream configured, or git missing — treat as up to date
    // rather than offering an update that can't be verified.
    return false
  }
}

/** Fetch all repos and report whether any of them is behind its upstream. */
export async function runUpdateCheck(): Promise<boolean> {
  const dir = getComfyUIDir()
  if (!dir) return false
  for (const repo of gitRepos(dir)) {
    if (await repoBehindUpstream(repo)) return true
  }
  return false
}

/**
 * Return the cached availability and kick off a background refresh when the
 * cache is stale. Runs at server startup (instrumentation.ts) and on every
 * detect poll, so the Update button only appears when an update truly exists.
 */
export function maybeRefreshUpdateCheck(): { available: boolean | null; checkedAt: number } {
  const cur = getUpdateCheck()
  const stale = cur.available === null || Date.now() - cur.checkedAt > CHECK_TTL_MS
  if (stale && !cur.inFlight) {
    setUpdateCheck({ inFlight: true })
    void runUpdateCheck()
      .then((available) => {
        setUpdateCheck({ available, checkedAt: Date.now(), inFlight: false })
        log('info', 'status', `ComfyUI update check: ${available ? 'update available' : 'up to date'}`)
      })
      .catch((err: unknown) => {
        setUpdateCheck({ inFlight: false })
        log('warn', 'status', `ComfyUI update check failed: ${String(err)}`)
      })
  }
  return { available: cur.available, checkedAt: cur.checkedAt }
}
