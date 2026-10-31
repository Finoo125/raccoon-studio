'use client'

import { useState, type ReactNode } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import { Knob } from '../SwitchTile'

/** Help me write for someone the Prompt Helper is locked for: what it is, and where to get it. */
export function HelperLocked({ onClose }: { onClose: () => void }) {
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogTitle>✨ Help me write</DialogTitle>
        <DialogDescription>
          The Prompt Helper turns your idea into a great description for the model you picked. It is a supporter feature.
        </DialogDescription>
        <Button variant="outline" nativeButton={false} render={<Link href="/add-ons" />}>See Supporters</Button>
      </DialogContent>
    </Dialog>
  )
}

/**
 * The Prompt Helper's frame, shared by Generate Image and Generate Video: a header
 * (title, chip, 🔞 18+ switch, the steps), the writing bar on top, the picture rows
 * scrolling below, and a pinned Cancel / Use footer. Closing with changes asks first.
 */
export default function HelperShell({ title, chip, nsfw, steps, bar, rows, useLabel, onUse, useDisabled = false, dirty, onClose,
  discardText = 'Your description in the Generate panel stays as it was.' }: {
  title: string
  chip?: ReactNode
  nsfw?: { on: boolean; toggle: () => void }
  steps: string[]
  /** The writing bar's two columns: the main one, then a 320 px side column. */
  bar: ReactNode
  rows: ReactNode
  useLabel: string
  onUse: () => void
  /** A write is running: Use would take the text from before it. */
  useDisabled?: boolean
  dirty: boolean
  onClose: () => void
  /** The discard question's second line: what stays as it was. */
  discardText?: string
}) {
  const [confirmClose, setConfirmClose] = useState(false)
  const requestClose = () => (dirty ? setConfirmClose(true) : onClose())

  return (
    <>
      <Dialog open onOpenChange={(o) => { if (!o) requestClose() }}>
        <DialogContent className="flex h-[90vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-7xl">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border px-4 py-3 pr-12">
            <DialogTitle className="text-base">{title}</DialogTitle>
            {chip && (
              <span className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
                {chip}
              </span>
            )}
            {nsfw && (
              <button type="button" role="switch" aria-checked={nsfw.on} aria-label="Show 18+ options"
                title={nsfw.on ? '18+ options are shown' : 'Show 18+ options (nudity, sexy outfits, sensual poses, acts)'}
                onClick={nsfw.toggle}
                className="ml-auto inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground hover:text-foreground">
                <Knob on={nsfw.on} /> 🔞 18+
              </button>
            )}
            <DialogDescription className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 text-xs">
              {steps.map((stepText, i) => (
                <span key={stepText} className="inline-flex items-center gap-1.5">
                  {i > 0 && <span aria-hidden="true">→</span>}
                  <span className="grid h-4 w-4 place-items-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">{i + 1}</span>
                  {stepText}
                </span>
              ))}
              <span className="ml-auto">Runs on your PC. Nothing is sent online.</span>
            </DialogDescription>
          </div>

          {/* The writing bar: never scrolls, whatever the picture list below does. */}
          <div className="grid shrink-0 gap-4 border-b border-border p-4 lg:grid-cols-[minmax(0,1fr)_320px]">
            {bar}
          </div>

          {/* Only the pictures scroll. */}
          <div className="min-h-0 flex-1 overflow-y-auto p-4" data-helper-picks>
            {rows}
          </div>

          {/* Pinned under the list: the button people want right after a write must never scroll away. */}
          <div className="flex shrink-0 justify-end gap-2 border-t border-border px-4 py-3">
            <Button type="button" variant="outline" className="min-w-28" onClick={requestClose}>Cancel</Button>
            <Button type="button" className="min-w-44" disabled={useDisabled} onClick={() => { onUse(); onClose() }}>
              {useLabel}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <ConfirmDialog open={confirmClose} onOpenChange={setConfirmClose} title="Discard your changes?"
        description={discardText} confirmLabel="Discard"
        cancelLabel="Keep editing" destructive onConfirm={onClose} />
    </>
  )
}
