import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/** Runs a program and hands back its stdout. Injectable so tests never spawn. */
export type Runner = (cmd: string, args: string[], timeoutMs: number) => Promise<string>

export const runFile: Runner = (cmd, args, timeoutMs) => new Promise((resolve, reject) => {
  execFile(cmd, args, { timeout: timeoutMs, windowsHide: true }, (err, stdout) => (err ? reject(err) : resolve(String(stdout))))
})

/** Gives up on a promise after `ms` — a hung probe must not hold the whole scan. */
export function within<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([p.catch(() => fallback), new Promise<T>((r) => setTimeout(() => r(fallback), ms))])
}

const round1 = (n: number) => Math.round(n * 10) / 10

/** The graphics card: ComfyUI's own report when it is up, else nvidia-smi, else unknown. */
export async function detectGpu(comfyUrl: string, opts: { fetcher?: typeof fetch; run?: Runner; timeoutMs?: number } = {}):
  Promise<{ name: string; vramGb: number } | null> {
  const { fetcher = fetch, run = runFile, timeoutMs = 1500 } = opts
  try {
    const res = await fetcher(`${comfyUrl}/system_stats`, { signal: AbortSignal.timeout(timeoutMs), cache: 'no-store' })
    if (res.ok) {
      const dev = ((await res.json()) as { devices?: { name?: string; vram_total?: number }[] }).devices?.[0]
      if (dev?.name && dev.vram_total) {
        // "cuda:0 NVIDIA GeForce RTX 5090 : cudaMallocAsync" → "NVIDIA GeForce RTX 5090"
        const name = dev.name.replace(/^\w+:\d+\s+/, '').replace(/\s+:\s.*$/, '')
        return { name, vramGb: round1(dev.vram_total / 1024 ** 3) }
      }
    }
  } catch { /* ComfyUI is down — ask the driver */ }
  const out = await within(run('nvidia-smi', ['--query-gpu=name,memory.total', '--format=csv,noheader,nounits'], timeoutMs), timeoutMs, '')
  const [name, mib] = out.split(/\r?\n/)[0]?.split(',').map((s) => s.trim()) ?? []
  return name && Number(mib) > 0 ? { name, vramGb: round1(Number(mib) / 1024) } : null
}

/** What the first-start setup needs to know about this computer. `null` = could not tell. */
export interface Hardware {
  gpuName: string | null
  /** As the driver reports it — an "8 GB" card reads ~7.99. Compare with a tolerance. */
  vramGb: number | null
  ramGb: number | null
  freeDiskGb: number | null
}

/** Card (ComfyUI's report, else nvidia-smi), RAM (this machine — the app runs on it) and free space under `modelsDir`. */
export async function detectHardware(
  comfyUrl: string,
  modelsDir: string,
  opts: { fetcher?: typeof fetch; run?: Runner; timeoutMs?: number; totalMem?: () => number } = {},
): Promise<Hardware> {
  const [gpu, disk] = await Promise.all([
    detectGpu(comfyUrl, opts),
    modelsDir ? freeGb(modelsDir) : Promise.resolve(null),
  ])
  return {
    gpuName: gpu?.name ?? null,
    vramGb: gpu?.vramGb ?? null,
    ramGb: round1((opts.totalMem ?? os.totalmem)() / 1024 ** 3),
    freeDiskGb: disk,
  }
}

/** Free space on the drive holding `dir` (or its nearest existing parent), in GB. */
export async function freeGb(dir: string): Promise<number | null> {
  let d = path.resolve(dir)
  while (!fs.existsSync(d)) {
    const up = path.dirname(d)
    if (up === d) return null
    d = up
  }
  try {
    const s = await fs.promises.statfs(d)
    return round1((s.bavail * s.bsize) / 1e9)
  } catch {
    return null
  }
}
