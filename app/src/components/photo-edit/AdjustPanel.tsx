'use client'

import { usePhotoEditStore } from '@/lib/photo-edit/store'
import { ADJUSTMENT_KEYS } from '@/lib/photo-edit/types'
import SliderRow from './SliderRow'

/** Convert a camelCase key to a human-friendly label. */
function toLabel(key: string): string {
  // Insert space before uppercase letters: "highlights" → "Highlights", "flipH" → "Flip H"
  return key.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase())
}

export default function AdjustPanel() {
  const adjustments = usePhotoEditStore((s) => s.editState.adjustments)
  const setAdjustment = usePhotoEditStore((s) => s.setAdjustment)

  return (
    <div className="flex flex-col overflow-y-auto px-3 py-2">
      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        Adjustments
      </p>
      {ADJUSTMENT_KEYS.map((key) => (
        <SliderRow
          key={key}
          label={toLabel(key)}
          value={adjustments[key]}
          onChange={(v) => setAdjustment(key, v)}
          onReset={() => setAdjustment(key, 0)}
        />
      ))}
    </div>
  )
}
