'use client'

import { useSystemMonitor } from '@/lib/comfyui/system-monitor'

/** Bar fill color by load: green → amber → red. */
function colorFor(v: number): string {
  if (v >= 85) return 'var(--destructive)'
  if (v >= 60) return '#f59e0b'
  return '#22c55e'
}

function Meter({ label, value }: { label: string; value: number | null }) {
  const has = value !== null
  return (
    <div className="flex items-center gap-1.5 leading-none">
      <span className="w-9 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <div className="h-1.5 w-14 overflow-hidden rounded-full bg-muted">
        {has && (
          <div
            className="h-full rounded-full transition-[width,background-color] duration-500 ease-out"
            style={{ width: `${value}%`, backgroundColor: colorFor(value) }}
          />
        )}
      </div>
      <span className="w-8 text-right text-[10px] font-medium tabular-nums text-muted-foreground">
        {has ? `${value}%` : '—'}
      </span>
    </div>
  )
}

/**
 * Live CPU/RAM/VRAM meters for the top bar, fed by ComfyUI-Crystools over the
 * websocket. Renders an idle "—" state when ComfyUI/Crystools isn't streaming.
 */
export default function SystemMonitor({ className = '' }: { className?: string }) {
  const { cpu, ram, vram } = useSystemMonitor()
  return (
    <div className={`flex flex-col gap-0.5 ${className}`} title="System usage (CPU / RAM / VRAM)">
      <Meter label="CPU" value={cpu} />
      <Meter label="RAM" value={ram} />
      <Meter label="VRAM" value={vram} />
    </div>
  )
}
