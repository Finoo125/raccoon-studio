'use client'

import { MousePointer2, Crop, Layers, Scissors } from 'lucide-react'
import { cn } from '@/lib/utils'
import { usePhotoEditStore } from '@/lib/photo-edit/store'
import type { CanvasMode } from '@/lib/photo-edit/store'
import type { SectionId } from '@/lib/photo-edit/sections'

/**
 * Canvas modes, not panels. Adjustments all live in the one edit column now, so
 * the rail is down to the three things that actually change what a drag on the
 * image does — plus Edit, which is "no overlay".
 *
 * Each mode carries the section it belongs to, so picking a mode also opens the
 * matching controls; otherwise you would arm the crop overlay with its aspect
 * presets still collapsed somewhere below.
 */
const MODES: {
  id: CanvasMode
  label: string
  key: string
  section?: SectionId
  Icon: React.ComponentType<{ className?: string }>
}[] = [
  { id: 'edit', label: 'Edit', key: 'E', Icon: MousePointer2 },
  { id: 'crop', label: 'Crop', key: 'R', section: 'crop', Icon: Crop },
  { id: 'masks', label: 'Masks', key: 'M', section: 'masks', Icon: Layers },
  { id: 'slice', label: 'Slice', key: 'X', section: 'slice', Icon: Scissors },
]

export default function ToolRail() {
  const canvasMode = usePhotoEditStore((s) => s.canvasMode)
  const setCanvasMode = usePhotoEditStore((s) => s.setCanvasMode)
  const openSections = usePhotoEditStore((s) => s.openSections)
  const toggleSection = usePhotoEditStore((s) => s.toggleSection)

  const pick = (mode: typeof MODES[number]) => {
    setCanvasMode(mode.id)
    if (mode.section && !openSections.includes(mode.section)) toggleSection(mode.section)
  }

  return (
    <>
      {MODES.map((mode) => (
        <button
          key={mode.id}
          type="button"
          title={`${mode.label} (${mode.key})`}
          data-tool={mode.id}
          aria-pressed={canvasMode === mode.id}
          onClick={() => pick(mode)}
          className={cn(
            'flex w-full flex-col items-center gap-0.5 rounded-lg py-1.5 transition-colors',
            canvasMode === mode.id
              ? 'bg-primary/15 text-primary'
              : 'text-muted-foreground hover:bg-muted hover:text-foreground',
          )}
        >
          <mode.Icon className="h-4 w-4" />
          <span className="text-[9px] font-medium leading-none">{mode.label}</span>
        </button>
      ))}
    </>
  )
}
