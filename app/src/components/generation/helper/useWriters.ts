'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import type { ScanResult } from '@/lib/ai-writers/types'
import { belowTier, type Tier } from '@/lib/ai-writers/tiers'
import { pickWriter, writerOptions, type WriterApp } from '@/lib/ai-writers/view'

const NSFW_KEY = 'raccoon.promptHelper.nsfw'
const readNsfw = () => { try { return localStorage.getItem(NSFW_KEY) === '1' } catch { return false } }
const saveNsfw = (on: boolean) => { try { localStorage.setItem(NSFW_KEY, on ? '1' : '0') } catch { /* private window */ } }

/** 18+ topics and racy picks: off until the user switches them on; remembered per browser. */
export function useNsfwSwitch(): [boolean, (on: boolean) => void] {
  const [nsfw, setNsfw] = useState(readNsfw)
  return [nsfw, (on: boolean) => { setNsfw(on); saveNsfw(on) }]
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Every AI writer on this PC (built-in, Ollama, LM Studio, servers), the state of
 * its program, and the one that writes: `chosen` while it is still there, else
 * the first ready one — one at `minTier` or above while there is one. Scans once
 * `enabled` (the helper is unlocked for this user), never before. A fallback pick
 * is shown, never saved: a caller that stores the writer stores `engine`.
 */
export function useWriters({ chosen, excludeBuiltin, enabled, minTier = 's' }: {
  chosen: string
  excludeBuiltin?: boolean
  enabled: boolean
  /** The fallback passes over the setup's models below this tier (video: 9b or more) — see pickWriter. */
  minTier?: Tier
}) {
  const [scan, setScan] = useState<ScanResult | null>(null)
  const [starting, setStarting] = useState<WriterApp | 'comfy' | null>(null)
  const [setupOpen, setSetupOpen] = useState(false)

  const rescan = async (): Promise<ScanResult | null> => {
    try {
      const res = await fetch('/api/ai-writers/scan', { cache: 'no-store' })
      if (!res.ok) return null
      const next = (await res.json()) as ScanResult
      setScan(next)
      return next
    } catch {
      return null
    }
  }

  useEffect(() => {
    if (!enabled) return
    void (async () => {
      try {
        const res = await fetch('/api/ai-writers/scan', { cache: 'no-store' })
        if (res.ok) setScan((await res.json()) as ScanResult)
      } catch { /* the card offers the setup */ }
    })()
  }, [enabled])

  const all = scan ? writerOptions(scan) : []
  const options = excludeBuiltin ? all.filter((o) => o.app !== 'builtin') : all
  const picked = pickWriter(chosen, options, belowTier(minTier))
  const engine = picked?.id ?? ''

  /** "Start now" / "Start ComfyUI": the app comes up, then the card turns green. */
  const start = async (app: 'ollama' | 'lmstudio' | 'comfy') => {
    setStarting(app)
    try {
      if (app === 'comfy') {
        const res = await fetch('/api/comfyui-control/start', { method: 'POST' })
        if (!res.ok && res.status !== 409) {
          toast.error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? 'ComfyUI did not start')
          return
        }
        for (let i = 0; i < 80; i++) {
          await sleep(3000)
          if ((await rescan())?.comfyui) return
        }
        toast.error('ComfyUI didn’t start. Start it from the top bar, then try again.')
        return
      }
      const res = await fetch('/api/ai-writers/start', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ app }),
      })
      if (!res.ok) toast.error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? 'It did not start')
      await rescan()
    } finally {
      setStarting(null)
    }
  }

  return { scan, rescan, options, picked, engine, starting, start, setupOpen, setSetupOpen }
}
