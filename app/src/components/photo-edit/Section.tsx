'use client'

import { ChevronRight, RotateCcw } from 'lucide-react'
import { usePhotoEditStore } from '@/lib/photo-edit/store'
import { sectionStatus, SECTION_HINT, SECTION_LABEL, SECTION_MODE, type SectionId } from '@/lib/photo-edit/sections'
import { cn } from '@/lib/utils'

/**
 * One collapsible block of the edit column.
 *
 * The header carries everything you need to decide whether to open it: the name,
 * a dot when it holds non-default values, and — when closed — a summary of what
 * those values are. That is the whole point of the layout: you should never have
 * to open a section to find out whether you changed anything in it.
 */
export default function Section({ id, children }: { id: SectionId; children: React.ReactNode }) {
  const open = usePhotoEditStore((s) => s.openSections.includes(id))
  const toggleSection = usePhotoEditStore((s) => s.toggleSection)
  const editState = usePhotoEditStore((s) => s.editState)
  const resetSection = usePhotoEditStore((s) => s.resetSection)
  const setCanvasMode = usePhotoEditStore((s) => s.setCanvasMode)
  const dismissedHints = usePhotoEditStore((s) => s.dismissedHints)
  const dismissHint = usePhotoEditStore((s) => s.dismissHint)

  const { modified, summary } = sectionStatus(id, editState)
  const mode = SECTION_MODE[id]

  const handleToggle = () => {
    toggleSection(id)
    // Opening Crop/Masks/Slice arms the canvas overlay they need; closing it
    // hands the canvas back, so the two can never disagree.
    if (mode) setCanvasMode(open ? 'edit' : mode)
  }

  return (
    <section className="border-b border-border/60">
      <div className="flex items-center gap-1 px-3 py-2">
        <button
          type="button"
          onClick={handleToggle}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
        >
          <ChevronRight
            className={cn('h-3 w-3 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')}
          />
          <span className={cn('text-xs font-medium', open ? 'text-foreground' : 'text-muted-foreground')}>
            {SECTION_LABEL[id]}
          </span>
          {modified && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-label="has edits" />}
          {!open && summary && (
            <span className="min-w-0 truncate text-[10px] text-muted-foreground/70">{summary}</span>
          )}
        </button>
        {modified && (
          <button
            type="button"
            title={`Reset ${SECTION_LABEL[id]}`}
            aria-label={`Reset ${SECTION_LABEL[id]}`}
            onClick={() => resetSection(id)}
            className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <RotateCcw className="h-3 w-3" />
          </button>
        )}
      </div>

      {open && (
        <div className="px-3 pb-3">
          {!dismissedHints.includes(id) && (
            <p className="mb-2 rounded-md bg-muted/40 px-2 py-1.5 text-[10px] leading-relaxed text-muted-foreground">
              {SECTION_HINT[id]}
              <button
                type="button"
                onClick={() => dismissHint(id)}
                className="ml-1 underline underline-offset-2 hover:text-foreground"
              >
                Got it
              </button>
            </p>
          )}
          {children}
        </div>
      )}
    </section>
  )
}
