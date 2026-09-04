'use client'

import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { FastForward } from 'lucide-react'
import { useStudioStore } from '@/lib/generation/studio-store'
import { continuationPrefill } from '@/lib/generation/useContinueVideo'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog'

/**
 * How many takes of the next few seconds to render. Mirrors the form's own
 * Seed hunt row so the two controls can never offer different counts — this
 * dialog writes straight into that state.
 */
const COUNTS = [0, 2, 3, 4] as const

/**
 * The "how many takes?" step between a Continue button and the video form.
 *
 * Mounted **once**, in the studio layout, and driven by `continueTarget` in the
 * store — there are three Continue buttons (canvas, video inspector, gallery
 * inspector) living in three different shells, and one dialog beats three
 * copies of the same question. `ConfirmDialog` is not reused because this is a
 * four-way pick, not a yes/no.
 */
export default function ContinueVideoDialog() {
  const video = useStudioStore((s) => s.continueTarget)
  const setContinueTarget = useStudioStore((s) => s.setContinueTarget)
  const setPrefill = useStudioStore((s) => s.setPrefill)
  const router = useRouter()

  const go = (huntCount: number) => {
    if (!video) return
    setPrefill(continuationPrefill(video, huntCount))
    setContinueTarget(null)
    router.push('/generate-videos')
    toast.success(
      huntCount === 0
        ? 'Continuing from this clip — edit the prompt, then Generate'
        : `Continuing from this clip — ${huntCount} takes to pick from. Edit the prompt, then Generate.`,
    )
  }

  return (
    <Dialog open={!!video} onOpenChange={(v) => !v && setContinueTarget(null)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FastForward className="h-4 w-4 text-primary" /> Continue this clip
          </DialogTitle>
          <DialogDescription>
            Render several cheap takes of the next few seconds and keep the one you like, or go
            straight to a single full-quality continuation.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-4 gap-2">
          {COUNTS.map((n) => (
            <Button
              key={n}
              variant={n === 0 ? 'outline' : 'default'}
              className="h-10 text-sm"
              onClick={() => go(n)}
            >
              {n === 0 ? 'Just one' : `${n} takes`}
            </Button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          Takes render distilled, so they look rougher than the keeper — judge the motion, not the
          detail. You choose the keeper&apos;s speed when you pick one.
        </p>
      </DialogContent>
    </Dialog>
  )
}
