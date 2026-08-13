'use client'

import { usePhotoEditStore } from '@/lib/photo-edit/store'
import { adjustmentLabel, groupKeys, type SectionId } from '@/lib/photo-edit/sections'
import SliderRow from './SliderRow'

/** The slider rows belonging to one adjustment section. */
export default function GroupSliders({ id }: { id: SectionId }) {
  const adjustments = usePhotoEditStore((s) => s.editState.adjustments)
  const setAdjustment = usePhotoEditStore((s) => s.setAdjustment)
  // Per-control help rides along with the section's own first-run hint.
  const showHint = usePhotoEditStore((s) => !s.dismissedHints.includes(id))

  return (
    <>
      {groupKeys(id).map((key) => (
        <SliderRow
          key={key}
          label={adjustmentLabel(key)}
          value={adjustments[key]}
          showHint={showHint}
          onChange={(v) => setAdjustment(key, v)}
          onReset={() => setAdjustment(key, 0)}
        />
      ))}
    </>
  )
}
