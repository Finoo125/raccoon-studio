import { spawn, spawnSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'

/**
 * Low-level side-effecting helpers: locating and spawning the system `tar`,
 * scanning source trees, and checksumming. The pure argv/parse logic lives in
 * `./tar`; this file is the thin I/O boundary the routes and integration test
 * share.
 */

/**
 * The `tar` binary to invoke. On Windows we point explicitly at System32's
 * bundled bsdtar (present on Win 10 1803+/11) and fall back to Git-for-Windows'
 * `usr\bin\tar.exe`; elsewhere the PATH `tar` (GNU tar) is used.
 */
export function resolveTarBin(): string {
  if (process.platform === 'win32') {
    const candidates = [
      path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe'),
      path.join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Git', 'usr', 'bin', 'tar.exe'),
    ]
    for (const c of candidates) {
      if (fs.existsSync(c)) return c
    }
  }
  return 'tar'
}

/** True when a usable `tar` is present (used to gate the integration test). */
export function hasTar(): boolean {
  try {
    return spawnSync(resolveTarBin(), ['--version'], { stdio: 'ignore' }).status === 0
  } catch {
    return false
  }
}

export interface TarResult {
  code: number | null
  stdout: string
  stderr: string
}

/**
 * Spawn `tar` with the given args. `stdout` is captured verbatim (used by
 * list/read-member). When `onLine` is given, every line printed on either stream
 * is forwarded — used to turn `-v` output into progress. Rejects only if the
 * process cannot be spawned; a non-zero exit resolves with the captured output
 * so callers can attach context. An aborted `signal` kills the process (the
 * run then resolves non-zero; callers translate that into "cancelled").
 */
export function runTar(args: string[], onLine?: (line: string) => void, signal?: AbortSignal): Promise<TarResult> {
  return new Promise((resolve, reject) => {
    const proc = spawn(resolveTarBin(), args)
    const onAbort = () => proc.kill()
    if (signal?.aborted) proc.kill()
    else signal?.addEventListener('abort', onAbort, { once: true })
    let stdout = ''
    let stderr = ''
    let outBuf = ''
    let errBuf = ''

    const pump = (buf: string, chunk: string): string => {
      const combined = buf + chunk
      const lines = combined.split('\n')
      const rest = lines.pop() ?? ''
      if (onLine) for (const l of lines) onLine(l)
      return rest
    }

    proc.stdout.on('data', (d: Buffer) => {
      const s = d.toString()
      stdout += s
      if (onLine) outBuf = pump(outBuf, s)
    })
    proc.stderr.on('data', (d: Buffer) => {
      const s = d.toString()
      stderr += s
      if (onLine) errBuf = pump(errBuf, s)
    })
    proc.on('error', reject)
    proc.on('close', (code) => {
      signal?.removeEventListener('abort', onAbort)
      if (onLine) {
        if (outBuf) onLine(outBuf)
        if (errBuf) onLine(errBuf)
      }
      resolve({ code, stdout, stderr })
    })
  })
}

/** Recursively count files and total bytes under `dir` (missing dir → zero). */
export function scanDir(dir: string): { files: number; bytes: number } {
  let files = 0
  let bytes = 0
  const walk = (d: string) => {
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(d, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) {
        walk(p)
      } else if (e.isFile()) {
        files++
        try {
          bytes += fs.statSync(p).size
        } catch {
          /* raced deletion — ignore */
        }
      }
    }
  }
  walk(dir)
  return { files, bytes }
}

/** SHA-256 of a file, streamed so multi-GB archives don't buffer in memory.
 *  An aborted `signal` destroys the stream (rejects) — checksumming a huge
 *  archive can take minutes, and cancel must work there too. */
export function sha256OfFile(file: string, signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256')
    const stream = fs.createReadStream(file)
    const onAbort = () => stream.destroy(new Error('Cancelled'))
    if (signal?.aborted) onAbort()
    else signal?.addEventListener('abort', onAbort, { once: true })
    stream.on('data', (d) => hash.update(d))
    stream.on('error', (e) => { signal?.removeEventListener('abort', onAbort); reject(e) })
    stream.on('end', () => { signal?.removeEventListener('abort', onAbort); resolve(hash.digest('hex')) })
  })
}
