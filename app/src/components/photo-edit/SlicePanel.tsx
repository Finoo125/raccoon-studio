'use client'

import { Scissors } from 'lucide-react'
import { usePhotoEditStore } from '@/lib/photo-edit/store'

export default function SlicePanel() {
  const slice = usePhotoEditStore((s) => s.editState.slice)
  const setSlice = usePhotoEditStore((s) => s.setSlice)

  return (
    <div className="flex flex-col gap-4 overflow-y-auto px-3 py-3">
      <div>
        <p className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          <Scissors className="h-3 w-3" /> Slice
        </p>
        <ol className="list-decimal space-y-1 pl-4 text-xs text-muted-foreground">
          <li>Drag a straight line across the image.</li>
          <li>Click the side you want to keep.</li>
          <li>The other side becomes transparent — save as PNG.</li>
        </ol>
      </div>

      {slice && (
        <button
          type="button"
          onClick={() => setSlice(null)}
          className="rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
        >
          Clear slice
        </button>
      )}
    </div>
  )
}
