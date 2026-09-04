'use client'

import { Film, ScanFace, ArrowRightToLine, ArrowLeftToLine } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import type { SendToVideoTarget } from '@/lib/generation/useSendToVideo'

/**
 * "Send to Generate Videos" is four different things, and the two buttons it
 * used to be could only say two of them. The model, the mode and the slot are
 * one decision — the slot is what selects H3's task (start alone is i2v,
 * start+end is FL2VA, end alone is L2VA) — so they are one list rather than
 * three dropdowns to combine.
 */
const CHOICES: Array<{
  target: SendToVideoTarget
  model: string
  title: string
  hint: string
  Icon: typeof Film
}> = [
  {
    target: 'source',
    model: 'LTX 2.3',
    title: 'Source image',
    hint: 'Animate this picture forward. The clip takes its resolution from it.',
    Icon: Film,
  },
  {
    target: 'h3-start',
    model: 'MiniMax H3',
    title: 'Start frame — i2v',
    hint: 'The clip opens on this picture and moves on from it.',
    Icon: ArrowRightToLine,
  },
  {
    target: 'h3-end',
    model: 'MiniMax H3',
    title: 'End frame — i2v',
    hint: 'The clip has to land on this picture. Add a start frame too and it travels between the two.',
    Icon: ArrowLeftToLine,
  },
  {
    target: 'reference',
    model: 'MiniMax H3',
    title: 'Reference — <Picture 1>',
    hint: 'Not animated. Donates a character, a place or a style to a clip written from the prompt.',
    Icon: ScanFace,
  },
]

export default function SendToVideoDialog({
  open,
  onOpenChange,
  onPick,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  onPick: (target: SendToVideoTarget) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Send to Generate Videos</DialogTitle>
          <DialogDescription>Which model, and which slot should hold this image?</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          {CHOICES.map(({ target, model, title, hint, Icon }) => (
            <button
              key={target}
              type="button"
              onClick={() => onPick(target)}
              className="flex w-full items-start gap-3 rounded-xl border border-border bg-card px-3 py-2.5 text-left transition-colors hover:border-primary/50 hover:bg-muted/50"
            >
              <Icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline gap-2">
                  <span className="text-sm font-semibold">{title}</span>
                  <span className="text-[11px] uppercase tracking-wide text-muted-foreground">{model}</span>
                </span>
                <span className="mt-0.5 block text-xs text-muted-foreground">{hint}</span>
              </span>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
