'use client'

import { SlidersHorizontal, Palette, Crop, RotateCw, Scissors } from 'lucide-react'
import { cn } from '@/lib/utils'
import { usePhotoEditStore } from '@/lib/photo-edit/store'

type Tool = 'adjust' | 'filters' | 'crop' | 'geometry' | 'slice'

const TOOLS: { id: Tool; label: string; Icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'adjust', label: 'Adjust', Icon: SlidersHorizontal },
  { id: 'filters', label: 'Filters', Icon: Palette },
  { id: 'crop', label: 'Crop', Icon: Crop },
  { id: 'geometry', label: 'Geometry', Icon: RotateCw },
  { id: 'slice', label: 'Slice', Icon: Scissors },
]

export default function ToolRail() {
  const activeTool = usePhotoEditStore((s) => s.activeTool)
  const setActiveTool = usePhotoEditStore((s) => s.setActiveTool)

  return (
    <>
      {TOOLS.map(({ id, label, Icon }) => (
        <button
          key={id}
          type="button"
          title={label}
          aria-label={label}
          aria-pressed={activeTool === id}
          onClick={() => setActiveTool(id)}
          className={cn(
            'flex h-9 w-9 items-center justify-center rounded-lg transition-colors',
            activeTool === id
              ? 'bg-primary/15 text-primary'
              : 'text-muted-foreground hover:bg-muted hover:text-foreground',
          )}
        >
          <Icon className="h-4 w-4" />
        </button>
      ))}
    </>
  )
}
