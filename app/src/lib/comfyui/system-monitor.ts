'use client'

import { useEffect, useState } from 'react'
import { useQueueStore } from './queue'
import { useConnectionStore } from './connection'
import { ComfyUIWebSocket } from './websocket'
import type { WSMessage } from '@/types/comfyui'

export interface SystemStats {
  /** 0–100, or null when unavailable. */
  cpu: number | null
  ram: number | null
  vram: number | null
}

const EMPTY: SystemStats = { cpu: null, ram: null, vram: null }

/** Clamp a Crystools percentage to 0–100, or null if missing/unavailable (-1). */
function pct(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null
  return Math.min(100, Math.round(value))
}

/**
 * Map a `crystools.monitor` websocket payload to CPU/RAM/VRAM percentages.
 * VRAM is the first GPU's `vram_used_percent`. Pure — unit tested.
 */
export function parseMonitor(data: unknown): SystemStats {
  if (typeof data !== 'object' || data === null) return EMPTY
  const d = data as { cpu_utilization?: unknown; ram_used_percent?: unknown; gpus?: unknown }
  const gpus = Array.isArray(d.gpus) ? d.gpus : []
  const gpu0 = gpus[0] as { vram_used_percent?: unknown } | undefined
  return {
    cpu: pct(d.cpu_utilization),
    ram: pct(d.ram_used_percent),
    vram: gpu0 ? pct(gpu0.vram_used_percent) : null,
  }
}

/**
 * Subscribes to ComfyUI-Crystools' `crystools.monitor` event over a dedicated
 * websocket and returns live CPU/RAM/VRAM usage. All-null while ComfyUI is
 * offline or Crystools isn't emitting; the socket auto-reconnects.
 */
export function useSystemMonitor(): SystemStats {
  const clientId = useQueueStore((s) => s.clientId)
  const wsBase = useConnectionStore((s) => s.wsBase)
  const [stats, setStats] = useState<SystemStats>(EMPTY)

  useEffect(() => {
    // Crystools ships with its monitor off (rate 0) and resets on restart, so ask
    // it to start streaming. Fire-and-forget: if Crystools is absent the PATCH
    // 404/405s and the meters simply stay idle.
    fetch('/api/comfyui/crystools/monitor', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rate: 1 }),
    }).catch(() => {})

    const ws = new ComfyUIWebSocket(`${clientId}-monitor`, wsBase)
    ws.connect()
    const off = ws.on((msg: WSMessage) => {
      // crystools.monitor isn't part of the generation WSMessage union; read it loosely.
      const m = msg as unknown as { type?: string; data?: unknown }
      if (m.type === 'crystools.monitor') setStats(parseMonitor(m.data))
    })
    return () => {
      off()
      ws.disconnect()
      setStats(EMPTY)
    }
  }, [clientId, wsBase])

  return stats
}
