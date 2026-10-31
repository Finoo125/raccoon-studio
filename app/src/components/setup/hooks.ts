'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Hardware } from '@/lib/hardware'
import type { ModelsOnDisk } from '@/lib/models/on-disk'
import type { Transfer } from '@/lib/models/transfers'
import type { StarterFile } from '@/lib/models/starter'
import { NO_HARDWARE } from '@/lib/models/starter'
import { fetchTransfers, fileKey, startDownloads, summarize } from '@/lib/models/download-client'
import { engineRendering, restartComfyUI, waitForEngine } from '@/lib/comfyui/restart'

/** The graphics memory a person picked by hand ("Not right?") — wins over detection, per browser. */
const VRAM_OVERRIDE_KEY = 'raccoon-studio:vram-override'

export function useHardware() {
  const [detected, setDetected] = useState<Hardware | null>(null)
  const [override, setOverride] = useState<number | null>(null)
  useEffect(() => {
    try {
      const v = Number(localStorage.getItem(VRAM_OVERRIDE_KEY))
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time read of a per-browser choice
      if (v > 0) setOverride(v)
    } catch { /* unavailable */ }
    fetch('/api/hardware', { cache: 'no-store' })
      .then((r) => r.json() as Promise<Hardware>)
      .then(setDetected)
      .catch(() => setDetected(NO_HARDWARE))
  }, [])
  const pickVram = useCallback((gb: number | null) => {
    setOverride(gb)
    try {
      if (gb) localStorage.setItem(VRAM_OVERRIDE_KEY, String(gb))
      else localStorage.removeItem(VRAM_OVERRIDE_KEY)
    } catch { /* unavailable */ }
  }, [])
  const hw = detected && (override ? { ...detected, vramGb: override } : detected)
  return { hw, detected, override, pickVram }
}

export function useOnDisk() {
  const [state, setState] = useState<ModelsOnDisk | null>(null)
  const reload = useCallback(() => {
    fetch('/api/models/on-disk', { cache: 'no-store' })
      .then((r) => r.json() as Promise<ModelsOnDisk>)
      .then(setState)
      .catch(() => setState({ known: false, files: [], hasImageModel: false }))
  }, [])
  useEffect(() => { reload() }, [reload])
  // Null until known — and for good when the scan cannot see the models (no
  // COMFYUI_MODELS_DIR, a hand-written extra_model_paths.yaml): nothing may then read as missing.
  const onDisk = useMemo(() => (state?.known ? new Set(state.files) : null), [state])
  /** The scan answered and cannot see the models folder (not merely still loading). */
  const unknown = state !== null && !state.known
  return { onDisk, unknown, hasImageModel: state?.hasImageModel ?? false, reload }
}

export type DownloadPhase = 'idle' | 'downloading' | 'waiting' | 'restarting' | 'done' | 'error'

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

/**
 * Starts downloads, follows them, and when new files landed restarts the
 * engine and waits for it — ComfyUI only scans its model folders at startup,
 * so without the restart a finished download still reads as missing.
 */
export function useFileDownloads() {
  const [phase, setPhase] = useState<DownloadPhase>('idle')
  const [keys, setKeys] = useState<string[]>([])
  const [transfers, setTransfers] = useState<Transfer[]>([])
  const [error, setError] = useState<string | null>(null)
  // The error came after the downloads, from the restart: pressing Download again would find every
  // file present and end without one, so the page offers "Restart the engine" instead.
  const [restartFailed, setRestartFailed] = useState(false)

  const restart = useCallback(async () => {
    setError(null)
    setRestartFailed(false)
    // Never restart the engine in the middle of someone's render: wait it out.
    if (await engineRendering()) {
      setPhase('waiting')
      while (await engineRendering()) await new Promise((r) => setTimeout(r, 2000))
    }
    setPhase('restarting')
    try {
      if (!(await restartComfyUI())) throw new Error('The engine could not be restarted — use Stop and Start on the status light at the top right.')
      await waitForEngine()
      setPhase('done')
    } catch (e) {
      setError(message(e))
      setRestartFailed(true)
      setPhase('error')
    }
  }, [])

  const start = useCallback(async (files: StarterFile[]) => {
    setError(null)
    setRestartFailed(false)
    try {
      setKeys(await startDownloads(files))
      setPhase('downloading')
    } catch (e) {
      setError(message(e))
      setPhase('error')
    }
  }, [])

  /** Picks up downloads still running from an earlier visit (a reload mid-download). */
  const resume = useCallback(async (files: StarterFile[]) => {
    const wanted = new Set(files.map(fileKey))
    const running = (await fetchTransfers().catch(() => [] as Transfer[]))
      .filter((t) => t.status === 'running' && wanted.has(t.key))
      .map((t) => t.key)
    if (running.length) {
      setKeys(running)
      setPhase('downloading')
    }
  }, [])

  useEffect(() => {
    if (phase !== 'downloading') return
    let busy = false
    const tick = async () => {
      if (busy) return
      busy = true
      try {
        const list = await fetchTransfers()
        setTransfers(list)
        const s = summarize(list, keys)
        if (s.failed.length) {
          setError(s.failed.map((t) => `${t.name}: ${t.error ?? t.status}`).join('; '))
          setPhase('error')
        } else if (s.done) {
          if (s.wroteAny) await restart()
          else setPhase('done')
        }
      } catch { /* a missed poll is retried on the next tick */ } finally {
        busy = false
      }
    }
    const timer = setInterval(() => void tick(), 1000)
    void tick()
    return () => clearInterval(timer)
  }, [phase, keys, restart])

  return { phase, error, restartFailed, summary: summarize(transfers, keys), transfers, start, resume, restart }
}
