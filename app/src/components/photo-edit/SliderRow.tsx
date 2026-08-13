'use client'

import { cn } from '@/lib/utils'
import { usePhotoEditStore } from '@/lib/photo-edit/store'
import { CONTROL_HINT } from '@/lib/photo-edit/sections'

interface SliderRowProps {
  label: string
  value: number
  min?: number
  max?: number
  step?: number
  onChange: (v: number) => void
  onReset?: () => void
  /** Show the plain-English line under the label. Follows the section's own
   *  first-run hint, so dismissing "Got it" compacts the whole panel at once. */
  showHint?: boolean
}

export default function SliderRow({
  label,
  value,
  min = -100,
  max = 100,
  step = 1,
  onChange,
  onReset,
  showHint = false,
}: SliderRowProps) {
  // Ends the history-coalescing window so the next drag is its own undo step.
  const endGesture = usePhotoEditStore((s) => s.endGesture)
  // Looked up rather than passed: the same control means the same thing
  // wherever it appears, including inside a mask.
  const hint = CONTROL_HINT[label]

  return (
    // Double-click calls onReset on the row wrapper.
    <div
      className="group flex flex-col gap-1 py-1.5"
      onDoubleClick={() => onReset?.()}
      // Kept on the row even when the hint is showing, so the help survives
      // dismissing the section's tips — there is no UI to bring those back.
      title={[hint, onReset ? 'Double-click to reset' : null].filter(Boolean).join(' — ') || undefined}
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
      {hint && showHint && (
        <p className="text-[10px] leading-snug text-muted-foreground/70">{hint}</p>
      )}
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        onPointerUp={endGesture}
        onKeyUp={endGesture}
        onBlur={endGesture}
        aria-label={label}
        className="w-full cursor-pointer accent-primary"
        // Prevent double-click from resetting when user drags the thumb
        onDoubleClick={(e) => e.stopPropagation()}
      />
    </div>
  )
}
