'use client'

import { cn } from '@/lib/utils'

interface SliderRowProps {
  label: string
  value: number
  min?: number
  max?: number
  step?: number
  onChange: (v: number) => void
  onReset?: () => void
}

export default function SliderRow({
  label,
  value,
  min = -100,
  max = 100,
  step = 1,
  onChange,
  onReset,
}: SliderRowProps) {
  return (
    // Double-click calls onReset on the row wrapper.
    <div
      className="group flex flex-col gap-1 py-1.5"
      onDoubleClick={() => onReset?.()}
      title={onReset ? 'Double-click to reset' : undefined}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span
          className={cn(
            'font-mono text-xs tabular-nums',
            value !== 0 ? 'text-foreground' : 'text-muted-foreground',
          )}
        >
          {value > 0 ? `+${value}` : value}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={label}
        className="w-full cursor-pointer accent-primary"
        // Prevent double-click from resetting when user drags the thumb
        onDoubleClick={(e) => e.stopPropagation()}
      />
    </div>
  )
}
