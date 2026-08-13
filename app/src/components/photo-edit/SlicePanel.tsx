'use client'

import { useEffect, useRef } from 'react'
import { Check, FlipHorizontal2, Trash2, Undo2 } from 'lucide-react'
import { toast } from 'sonner'
import { usePhotoEditStore } from '@/lib/photo-edit/store'
import { Button } from '@/components/ui/button'
import type { Slice } from '@/lib/photo-edit/types'

export default function SlicePanel() {
  const slice = usePhotoEditStore((s) => s.editState.slice)
  const setSlice = usePhotoEditStore((s) => s.setSlice)
  const setCanvasMode = usePhotoEditStore((s) => s.setCanvasMode)
  const toggleSection = usePhotoEditStore((s) => s.toggleSection)

  // The cut as it was when this panel opened, so Cancel restores it instead of
  // clearing a slice the user had already committed on an earlier visit.
  const baseline = useRef<Slice | null>(null)
  useEffect(() => {
    baseline.current = usePhotoEditStore.getState().editState.slice
  }, [])

  const finish = () => {
    setCanvasMode('edit')
    if (usePhotoEditStore.getState().openSections.includes('slice')) toggleSection('slice')
  }

  const handleApply = () => {
    finish()
    toast.success(slice ? 'Cut applied — save as PNG to keep it transparent' : 'No cut to apply')
  }

  const handleCancel = () => {
    setSlice(baseline.current)
    finish()
  }

  return (
    <div className="flex flex-col gap-3">
      <ol className="list-decimal space-y-1 pl-4 text-xs text-muted-foreground">
        <li>Drag a straight line across the image.</li>
        <li>The shaded half is the one that goes — swap it if it picked wrong.</li>
        <li>Save as PNG to keep the cut edge transparent.</li>
      </ol>

      {slice && (
        <div className="flex gap-1.5">
          {/* Clicking the half you want also works, but only if you already know
              that; a button says it out loud. */}
          <button
            type="button"
            onClick={() => setSlice({ ...slice, keep: slice.keep === 'a' ? 'b' : 'a' })}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
          >
            <FlipHorizontal2 className="h-3.5 w-3.5" />
            Swap sides
          </button>
          <button
            type="button"
            onClick={() => setSlice(null)}
            className="flex items-center justify-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Clear
          </button>
        </div>
      )}

      {/* Same confirm pair as Crop, so both modal tools end the same way. */}
      <div className="flex gap-1.5">
        <Button variant="default" size="sm" className="flex-1" onClick={handleApply}>
          <Check className="h-3.5 w-3.5" />
          Apply cut
        </Button>
        <Button variant="outline" size="sm" onClick={handleCancel}>
          <Undo2 className="h-3.5 w-3.5" />
          Cancel
        </Button>
      </div>
    </div>
  )
}
