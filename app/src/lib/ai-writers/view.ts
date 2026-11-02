import type { SetupJob } from './setup-jobs'
import { belowTier, type Tier } from './tiers'
import type { ScanResult, WriterModel } from './types'

export type WriterApp = 'builtin' | 'ollama' | 'lmstudio' | 'server'

export interface WriterOption {
  id: string
  name: string
  detail: string
  /** The dropdown's group: where the writer runs. */
  group: string
  app: WriterApp
  /** Its program is switched off — Ollama and LM Studio start by themselves when used. */
  off: boolean
  tags: string[]
}

const sizeOf = (m: WriterModel) => (m.sizeGb ? `${m.sizeGb.toFixed(1)} GB` : '')
const hostOf = (address: string) => address.replace(/^https?:\/\//, '')

/** Every writer the scan found, in dropdown order. */
export function writerOptions(scan: ScanResult): WriterOption[] {
  const out: WriterOption[] = []
  if (scan.builtin.state === 'ready') {
    out.push({ id: 'builtin', name: 'Built-in writer', detail: 'Qwen3-VL 4B', group: 'Built into Raccoon Studio',
      app: 'builtin', off: !scan.comfyui, tags: ['Fastest'] })
  }
  const app = (models: WriterModel[], group: string, kind: 'ollama' | 'lmstudio', off: boolean) =>
    models.forEach((m) => out.push({ id: m.id, name: m.name, detail: sizeOf(m), group, app: kind, off, tags: m.tags }))
  if (scan.ollama.state !== 'missing') app(scan.ollama.models, 'Ollama', 'ollama', scan.ollama.state === 'off')
  if (scan.lmstudio.state !== 'missing') app(scan.lmstudio.models, 'LM Studio', 'lmstudio', scan.lmstudio.state === 'off')
  for (const s of scan.servers) {
    if (!s.reachable) continue
    for (const m of s.models) {
      const group = s.kind === 'Unsloth Studio' ? s.kind : `Server ${hostOf(s.address)}`
      out.push({ id: m.id, name: m.name, detail: group === s.kind ? '' : s.kind, group, app: 'server', off: false, tags: m.tags })
    }
  }
  return out
}

/**
 * The remembered writer while it is still there; else the first ready one; else
 * whatever exists. The fallback passes over `avoid` (models too small for the
 * job) while anything else is there; a writer the user chose is never avoided.
 */
export function pickWriter(chosen: string, options: readonly WriterOption[], avoid: readonly string[] = []): WriterOption | null {
  const fits = (o: WriterOption) => !avoid.includes(o.id)
  return options.find((o) => o.id === chosen) ?? options.find((o) => !o.off && fits(o)) ?? options.find((o) => !o.off)
    ?? options.find(fits) ?? options[0] ?? null
}

export interface ScanRow {
  key: 'gpu' | 'disk' | 'builtin' | 'ollama' | 'lmstudio' | 'servers'
  title: string
  state: 'ok' | 'warn' | 'none'
  detail: string
  action?: 'start-comfy' | 'start-ollama' | 'start-lmstudio' | 'add-address'
}

const count = (n: number) => `${n} model${n === 1 ? '' : 's'}`
const driveOf = (root: string) => root.replace(/[\\/]$/, '') || root

/** "What we found on your PC", one plain row per thing the setup looked for. */
export function scanRows(scan: ScanResult): ScanRow[] {
  const { gpu, disk, ollama, lmstudio } = scan
  const servers = scan.servers.map((s) => `${s.kind} at ${hostOf(s.address)} · ${
    !s.reachable ? 'not answering' : s.needsKey ? 'needs its API key'
      : s.kind === 'Unsloth Studio' && !s.models.length ? 'no model loaded (load one, or turn on Settings → API → Model auto-switch)'
        : count(s.models.length)}`)
  return [
    gpu
      ? { key: 'gpu', title: 'Graphics card', state: 'ok', detail: `${gpu.name} · ${gpu.vramGb} GB video memory` }
      : { key: 'gpu', title: 'Graphics card', state: 'none', detail: 'Couldn’t detect it — pick your card size below' },
    !disk
      ? { key: 'disk', title: 'Free space', state: 'none', detail: 'Couldn’t check' }
      : disk.freeGb < 10
        ? { key: 'disk', title: 'Free space', state: 'warn', detail: `Only ${disk.freeGb.toFixed(1)} GB free on ${driveOf(disk.path)}` }
        : { key: 'disk', title: 'Free space', state: 'ok', detail: `${disk.freeGb} GB free on ${driveOf(disk.path)}` },
    scan.builtin.state === 'missing'
      ? { key: 'builtin', title: 'Built-in writer', state: 'none', detail: 'Not downloaded yet (5 GB)' }
      : scan.comfyui
        ? { key: 'builtin', title: 'Built-in writer', state: 'ok', detail: 'Installed · Krea2’s text model, nothing else needed' }
        : { key: 'builtin', title: 'Built-in writer', state: 'warn', detail: 'Installed · ComfyUI is not running', action: 'start-comfy' },
    ollama.state === 'running'
      ? { key: 'ollama', title: 'Ollama', state: 'ok', detail: `Running · version ${ollama.version} · ${count(ollama.models.length)}` }
      : ollama.state === 'missing'
        ? { key: 'ollama', title: 'Ollama', state: 'none', detail: 'Not installed' }
        : ollama.canStart
          ? { key: 'ollama', title: 'Ollama', state: 'warn', detail: `Installed · switched off · ${count(ollama.models.length)}`, action: 'start-ollama' }
          : { key: 'ollama', title: 'Ollama', state: 'warn', detail: 'Not answering at its address on another computer' },
    lmstudio.state === 'running'
      ? { key: 'lmstudio', title: 'LM Studio', state: 'ok', detail: `Server running · ${count(lmstudio.models.length)}` }
      : lmstudio.state === 'off'
        ? { key: 'lmstudio', title: 'LM Studio', state: 'warn', detail: `Installed · switched off · ${count(lmstudio.models.length)}`, action: 'start-lmstudio' }
        : { key: 'lmstudio', title: 'LM Studio', state: 'none', detail: 'Not installed' },
    servers.length
      ? { key: 'servers', title: 'Other AI servers', state: scan.servers.some((s) => s.reachable && !s.needsKey) ? 'ok' : 'warn', detail: servers.join(' · '), action: 'add-address' }
      : { key: 'servers', title: 'Other AI servers', state: 'none', action: 'add-address',
          detail: 'llama.cpp, KoboldCpp, Jan, Unsloth Studio and similar: none running on the usual addresses' },
  ]
}

export type CardKind = 'loading' | 'none' | 'ready' | 'off' | 'comfy-off' | 'starting' | 'writing'

/** What the writer card in Help me write shows. */
export function cardKind(scan: ScanResult | null, picked: WriterOption | null,
  now: { starting?: WriterApp | 'comfy' | null; writing?: boolean }): CardKind {
  if (!scan) return 'loading'
  if (!picked) return 'none'
  if (now.writing) return 'writing'
  if (now.starting && (now.starting === picked.app || (now.starting === 'comfy' && picked.app === 'builtin'))) return 'starting'
  if (picked.app === 'builtin' && !scan.comfyui) return 'comfy-off'
  return picked.off ? 'off' : 'ready'
}

/**
 * Which one-click setups to offer: what is not on this PC yet — and Ollama also
 * when it is here but has no model to write with (installed by hand, never pulled),
 * or only models under `minTier` (the image helper's small-card 4b, for video).
 */
export function setupOffers(scan: ScanResult, minTier: Tier = 's'): { builtin: boolean; ollama: boolean } {
  const { ollama } = scan
  const small = belowTier(minTier)
  return {
    builtin: scan.builtin.state === 'missing',
    ollama: ollama.state === 'missing' || (ollama.canStart && ollama.models.every((m) => small.includes(m.id))),
  }
}

/** Ollama and LM Studio start themselves before a write; ComfyUI (the built-in writer) does not. */
export const startsByItself = (o: WriterOption) => o.off && (o.app === 'ollama' || o.app === 'lmstudio')

/**
 * The setup job a card shows: one still running (even from an earlier opening of
 * the dialog — setups outlive it), or a finished one the dialog followed.
 */
export function jobFor(jobs: readonly SetupJob[], kind: SetupJob['kind'], followed: ReadonlySet<string>): SetupJob | undefined {
  return jobs.find((j) => j.kind === kind && (j.status === 'running' || followed.has(kind)))
}
